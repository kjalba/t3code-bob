/**
 * Map Bob Shell events to ACP session/update notifications
 * Updated to match actual Bob Shell format and support thinking tags
 */

import {BobShellEvent} from './output-parser.js';
import {logger} from '../transport/logger.js';
import {Plan, PlanEntry, PlanEntryStatus, SessionUpdate, ToolCall, ToolKind} from "@agentclientprotocol/sdk";
import {ChatMode, SessionEventMapping} from "../acp/types.js";
import {SessionManager} from "../session/session-manager.js";

const COMPONENT = 'event-mapper';

export class EventMapper {
    private inThinkingBlock: boolean = false;
    private sessionManager: SessionManager | null = null;

    /**
     * Set the session manager for turn counter access
     */
    setSessionManager(sessionManager: SessionManager): void {
        this.sessionManager = sessionManager;
    }

    /**
     * Map a Bob Shell event to an ACP session update
     */
    mapEvent(event: BobShellEvent, sessionId: string): SessionEventMapping {
        logger.debug(COMPONENT, 'Mapping Bob Shell event to ACP update', {
            sessionId,
            type: event.type,
            event: event
        }, sessionId);

        let update: SessionEventMapping = null;

        switch (event.type) {
            case 'init':
                // Init events don't need to be sent to client
                return null;

            case 'message':
                update = this.mapMessageEvent(event, sessionId);
                break;

            case 'tool_use':
                update = this.mapToolUseEvent(event, sessionId);
                break;

            case 'tool_result':
                update = this.mapToolResultEvent(event, sessionId);
                break;

            case 'result':
                // Result events signal completion, don't map to updates
                return null;

            default:
                logger.warn(COMPONENT, 'Unknown event type', {
                    sessionId,
                    type: (event as any).type
                }, sessionId);
                return null;
        }

        if (update) {
            const updates = Array.isArray(update) ? update : [update];
            updates.forEach(value =>
                logger.debug(COMPONENT, 'Generated ACP update for IntelliJ', {
                    sessionId,
                    updateType: value.sessionUpdate,
                    update: value
                }, sessionId)
            );
        }

        return update;
    }

    /**
     * Reset thinking state (call when session ends)
     */
    resetThinkingState(): void {
        this.inThinkingBlock = false;
    }

    private mapMessageEvent(event: {
        type: 'message';
        role: string;
        content: string;
        delta?: boolean
    }, sessionId: string): SessionEventMapping {
        // Only map assistant messages
        if (event.role !== 'assistant') {
            return null;
        }

        // Parse thinking tags from content
        const updates = this.parseThinkingTags(event.content, sessionId);

        if (updates.length > 0) {
            return updates;
        }

        return null;
    }

    /**
     * Parse content for <thinking> tags and extract thinking vs regular content
     * Handles streaming where tags may come in separate chunks
     */
    private parseThinkingTags(content: string, sessionId: string): SessionUpdate[] {
        const updates: SessionUpdate[] = [];
        let remaining = content;

        while (remaining.length > 0) {
            if (this.inThinkingBlock) {
                const closeTagIndex = remaining.indexOf('</thinking>');
                if (closeTagIndex === -1) {
                    updates.push({
                        sessionUpdate: 'agent_thought_chunk',
                        content: {
                            type: 'text',
                            text: remaining
                        },
                    });
                    logger.debug(COMPONENT, 'Streaming thinking chunk', {
                        sessionId,
                        length: remaining.length,
                    }, sessionId);
                    break;
                }

                const thinkingContent = remaining.substring(0, closeTagIndex);
                if (thinkingContent) {
                    updates.push({
                        sessionUpdate: 'agent_thought_chunk',
                        content: {
                            type: 'text',
                            text: thinkingContent
                        },
                    });
                }

                this.inThinkingBlock = false;
                remaining = remaining.substring(closeTagIndex + '</thinking>'.length);
                continue;
            }

            const openTagIndex = remaining.indexOf('<thinking>');
            if (openTagIndex === -1) {
                const filteredContent = this.filterToolMessages(remaining);
                if (filteredContent) {
                    updates.push({
                        sessionUpdate: 'agent_message_chunk',
                        content: {
                            type: 'text',
                            text: filteredContent,
                        },
                    });
                }
                break;
            }

            const beforeTag = remaining.substring(0, openTagIndex);
            const filteredBeforeTag = this.filterToolMessages(beforeTag);
            if (filteredBeforeTag) {
                updates.push({
                    sessionUpdate: 'agent_message_chunk',
                    content: {
                        type: 'text',
                        text: filteredBeforeTag,
                    },
                });
            }

            this.inThinkingBlock = true;
            remaining = remaining.substring(openTagIndex + '<thinking>'.length);
        }

        return updates;
    }

    /**
     * Filter out tool usage messages and deprecation warnings that Bob adds
     */
    private filterToolMessages(content: string): string {
        // Remove lines like "[using tool attempt_completion: Successfully completed | Cost: 0.01]"
        if (content.startsWith('[using tool')) {
            return ''
        }
        return content.replace(/The --prompt \(-p\) flag has been deprecated and will be removed in a future version\. Please use a positional argument for your prompt\. See bob-shell --help for more information\.\n?/g, '');
    }

    private mapToolUseEvent(event: {
        type: 'tool_use';
        tool_name: string;
        tool_id: string;
        parameters: Record<string, unknown>
    }, sessionId: string): SessionUpdate | SessionUpdate[] | null {
        // Generate unique tool ID using session manager
        const uniqueToolId = this.sessionManager
            ? this.sessionManager.generateUniqueToolId(sessionId, event.tool_id)
            : event.tool_id;

        // Track active tool call for result mapping
        const session = this.sessionManager?.getSession(sessionId);
        if (session) {
            session.activeToolCalls.set(uniqueToolId, event.tool_name);
            logger.debug(COMPONENT, 'Registered active tool call', {
                sessionId,
                toolCallId: uniqueToolId,
                toolName: event.tool_name,
                activeCount: session.activeToolCalls.size
            }, sessionId);
        }

        // attempt_completion is handled entirely in mapToolResultEvent as agent_message_chunk
        if (event.tool_name === 'attempt_completion') {
            return null;
        }

        // Special handling for update_todo_list - convert to plan update
        if (event.tool_name === 'update_todo_list' && event.parameters.todos) {
            return this.mapTodoListToPlan(String(event.parameters.todos));
        }

        if (event.tool_name === 'switch_mode' && event.parameters.mode) {
            const session = this.sessionManager?.getSession(sessionId);
            if (session) {
                session.mode = event.parameters.mode as ChatMode;
            }
            return this.mapModeSwitch(event.parameters.mode as string, uniqueToolId);
        }

        const toolName = event.tool_name;
        const toolKind = this.mapToolNameToKind(event.tool_name);

        const callParameters = this.extractToolParameters(toolName, event.parameters, uniqueToolId, sessionId);

        return {
            sessionUpdate: 'tool_call',
            kind: toolKind,
            toolCallId: uniqueToolId,
            status: 'in_progress',
            ...callParameters
        };
    }

    private mapToolNameToKind(toolName: string): ToolKind {
        switch (toolName) {
            case 'read_file':
            case 'list_files':
                return 'read'
            case 'execute_command':
                return 'execute';
            case 'apply_diff':
            case 'search_and_replace':
            case 'write_to_file':
                return 'edit';
            case 'switch_mode':
                return 'switch_mode';
            default:
                return 'other'
        }
    }

    private extractToolParameters(toolName: string, parameters: Record<string, unknown>, toolCallId: string, sessionId: string): Partial<ToolCall> & {
        title: string
    } {
        switch (toolName) {
            case 'read_file':
                return {
                    title: "Read file: " + parameters.file_path,
                    locations: [
                        {
                            path: parameters.absolute_path as string
                        }
                    ]
                };
            case 'list_files':
                return {
                    title: 'List files: ' + parameters.dir_path,
                    locations: [
                        {
                            path: parameters.dir_path as string
                        }
                    ],
                    rawInput: parameters
                }
            case 'execute_command':
                return this.extractExecuteCommandParameters(parameters, toolCallId, sessionId);
            case 'apply_diff':
                return this.extractApplyDiffParameters(parameters);
            case 'search_and_replace':
                return this.extractSearchAndReplaceParameters(parameters);
            case 'write_to_file':
                return this.extractWriteToFileParameters(parameters);
            case 'switch_mode':
                return {
                    title: "Switch mode: " + parameters.mode,
                }
            default:
                return {title: "Other"};
        }


    }

    /**
     * Extract parameters for execute_command tool
     * Formats to match ACP reference format with terminal content and _meta fields
     */
    private extractExecuteCommandParameters(parameters: Record<string, unknown>, toolCallId: string, sessionId: string): Partial<ToolCall> & { title: string } {
        const command = parameters.command as string;

        // Get cwd from session if available, otherwise use process.cwd()
        const session = this.sessionManager?.getSession(sessionId);
        const cwd = session?.cwd || process.cwd();

        return {
            title: command,
            content: [
                {
                    type: 'terminal',
                    terminalId: toolCallId
                }
            ],
            rawInput: {
                command: command,
                cwd: cwd
            },
            _meta: {
                terminal_info: {
                    cwd: cwd,
                    terminal_id: toolCallId
                }
            }
        };
    }

    /**
     * Extract parameters for apply_diff tool
     * Parses Bob's diff format (Search/Replace blocks) into ACP's Diff format
     */
    private extractApplyDiffParameters(parameters: Record<string, unknown>): Partial<ToolCall> & { title: string } {
        const filePath = parameters.file_path as string;
        const diffContent = parameters.diff as string;

        // Parse the Bob diff format to extract old/new content
        const {oldText, newText} = this.parseBobDiff(diffContent);

        return {
            title: `Edit file: ${filePath}`,
            locations: [
                {
                    path: filePath
                }
            ],
            content: [
                {
                    type: 'diff',
                    path: filePath,
                    oldText: oldText,
                    newText: newText
                }
            ]
        };
    }

    /**
     * Parse Bob's diff format (Search/Replace blocks) to extract old and new content
     * Format: # Search: ||| <content> ||| # Replace with: ||| <content> |||
     * If the file is new (no search block), oldText will be null
     */
    private parseBobDiff(diffContent: string): { oldText: string | null; newText: string } {
        // Match the Search and Replace blocks
        const searchMatch = diffContent.match(/# Search: \|\|\|([\s\S]*?)\|\|\|/);
        const replaceMatch = diffContent.match(/# Replace with: \|\|\|([\s\S]*?)\|\|\|/);

        // If no search block found, this is a new file - oldText should be null
        const oldText = searchMatch ? searchMatch[1].trim() : null;
        const newText = replaceMatch ? replaceMatch[1].trim() : '';

        return {oldText, newText};
    }

    /**
     * Extract parameters for search_and_replace tool
     * At tool_use time, we only send basic info. The full diff will be sent at tool_result time.
     */
    private extractSearchAndReplaceParameters(parameters: Record<string, unknown>): Partial<ToolCall> & {
        title: string
    } {
        const filePath = parameters.file_path as string;

        return {
            title: `Edit file: ${filePath}`,
            locations: [
                {
                    path: filePath
                }
            ]
        };
    }

    /**
     * Extract parameters for write_to_file tool
     * At tool_use time, we only send basic info. The full diff will be sent at tool_result time.
     */
    private extractWriteToFileParameters(parameters: Record<string, unknown>): Partial<ToolCall> & { title: string } {
        const filePath = parameters.file_path as string;

        return {
            title: `Write to file: ${filePath}`,
            locations: [
                {
                    path: filePath
                }
            ]
        };
    }

    private mapToolResultEvent(event: {
        type: 'tool_result';
        tool_id: string;
        status: string;
        output: string
    }, sessionId: string): SessionUpdate | SessionUpdate[] | null {
        // Generate unique tool ID to match the tool_use event
        const uniqueToolId = this.sessionManager
            ? this.sessionManager.generateUniqueToolId(sessionId, event.tool_id)
            : event.tool_id;

        // Look up the tool name from active tool calls
        const session = this.sessionManager?.getSession(sessionId);
        const toolName = session?.activeToolCalls.get(uniqueToolId);

        logger.debug(COMPONENT, 'Processing tool result', {
            sessionId,
            toolCallId: uniqueToolId,
            toolName: toolName || 'unknown',
            status: event.status
        }, sessionId);

        // Handle attempt_completion with markdown admonition
        if (toolName === 'attempt_completion') {
            session?.activeToolCalls.delete(uniqueToolId);
            logger.debug(COMPONENT, 'Processing attempt_completion result', {
                sessionId,
                toolCallId: uniqueToolId,
                status: event.status
            }, sessionId);

            // Determine admonition type based on status
            const admonitionType = event.status === 'success' ? 'TIP' : 'CAUTION';
            const statusText = event.status === 'success' ? '**Task successful**' : '**Task failed**';

            // Prefix each line of output with "> "
            const prefixedOutput = event.output
                .split('\n')
                .map(line => `> ${line}`)
                .join('\n');

            // Wrap in markdown admonition with status line
            const wrappedOutput = `\n> [!${admonitionType}]\n> ${statusText}\n>\n${prefixedOutput}`;

            return {
                sessionUpdate: 'agent_message_chunk',
                content: {
                    type: 'text',
                    text: wrappedOutput,
                },
            };
        }

        // Check if this is an execute_command result - format with terminal output delta and exit
        if (toolName === 'execute_command') {
            const result = this.mapExecuteCommandResult(event, uniqueToolId);
            // Clean up the active tool call after processing
            session?.activeToolCalls.delete(uniqueToolId);
            logger.debug(COMPONENT, 'Cleaned up active tool call', {
                sessionId,
                toolCallId: uniqueToolId,
                remainingActive: session?.activeToolCalls.size || 0
            }, sessionId);
            return result;
        }

        // Check if this is a search_and_replace result with unified diff
        const diffContent = this.parseUnifiedDiff(event.output);
        if (diffContent) {
            // Clean up the active tool call
            session?.activeToolCalls.delete(uniqueToolId);
            return {
                sessionUpdate: 'tool_call_update',
                toolCallId: uniqueToolId,
                status: (event.status === 'error') ? "failed" : "completed",
                content: [diffContent]
            };
        }

        // Clean up the active tool call
        session?.activeToolCalls.delete(uniqueToolId);

        return {
            sessionUpdate: 'tool_call_update',
            toolCallId: uniqueToolId,
            content: [{type: "content", content: {type: "text", text: event.output}}],
            rawOutput: event.output,
            status: (event.status === 'error') ? "failed" : "completed",
        };
    }

    /**
     * Map execute_command tool result to ACP format with streaming output and terminal exit
     * Returns two updates: one for output delta, one for completion with exit info
     */
    private mapExecuteCommandResult(event: {
        type: 'tool_result';
        tool_id: string;
        status: string;
        output: string
    }, toolCallId: string): SessionUpdate[] {
        const exitCode = event.status === 'success' ? 0 : 1;

        return [
            // First update: terminal output delta
            {
                sessionUpdate: 'tool_call_update',
                toolCallId: toolCallId,
                _meta: {
                    terminal_output_delta: {
                        data: event.output,
                        terminal_id: toolCallId
                    }
                }
            },
            // Second update: completion with terminal exit info
            {
                sessionUpdate: 'tool_call_update',
                toolCallId: toolCallId,
                status: event.status === 'error' ? 'failed' : 'completed',
                rawOutput: {
                    formatted_output: event.output,
                    exit_code: exitCode
                },
                _meta: {
                    terminal_exit: {
                        exit_code: exitCode,
                        signal: null,
                        terminal_id: toolCallId
                    }
                }
            }
        ];
    }

    /**
     * Parse unified diff format from search_and_replace tool result
     * Returns a Diff object with full file content if parsing succeeds, null otherwise
     */
    private parseUnifiedDiff(output: string): { type: 'diff'; path: string; oldText: string; newText: string } | null {
        // Check if this looks like a unified diff (starts with "Index:" or contains diff markers)
        if (!output.includes('Index:') && !output.includes('---') && !output.includes('+++')) {
            return null;
        }

        try {
            // Extract file path from "Index: <path>" line
            const indexMatch = output.match(/^Index:\s+(.+)$/m);
            if (!indexMatch) {
                return null;
            }
            const filePath = indexMatch[1].trim();

            // Extract the diff content (lines starting with space, -, or +)
            const lines = output.split('\n');
            const oldLines: string[] = [];
            const newLines: string[] = [];

            let inDiffSection = false;
            for (const line of lines) {
                // Start processing after the @@ line
                if (line.startsWith('@@')) {
                    inDiffSection = true;
                    continue;
                }

                if (!inDiffSection) {
                    continue;
                }

                if (line.startsWith('-')) {
                    // Line removed from old version
                    oldLines.push(line.substring(1));
                } else if (line.startsWith('+')) {
                    // Line added to new version
                    newLines.push(line.substring(1));
                } else if (line.startsWith(' ')) {
                    // Context line (in both versions)
                    oldLines.push(line.substring(1));
                    newLines.push(line.substring(1));
                } else if (line.trim() === '') {
                    // Empty line
                    oldLines.push('');
                    newLines.push('');
                }
            }

            if (oldLines.length === 0 && newLines.length === 0) {
                return null;
            }

            return {
                type: 'diff',
                path: filePath,
                oldText: oldLines.join('\n'),
                newText: newLines.join('\n')
            };
        } catch (error) {
            logger.warn(COMPONENT, 'Failed to parse unified diff', {error});
            return null;
        }
    }

    /**
     * Map Bob's todo list format to ACP Plan
     * Parses markdown checklist format: [ ] (in progress), [x] (completed)
     * Bob only emits two states: unchecked tasks are in progress, checked tasks are completed
     */
    private mapTodoListToPlan(todos: string): SessionUpdate & Plan {
        const entries: PlanEntry[] = [];
        const lines = todos.trim().split('\n');

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            // Match markdown checkbox format: [ ] or [x]
            const match = trimmedLine.match(/^\[([x\s])\]\s+(.+)$/i);
            if (!match) continue;

            const statusChar = match[1].toLowerCase();
            const content = match[2].trim();

            // Bob uses [ ] for tasks in progress and [x] for completed tasks
            const status: PlanEntryStatus = statusChar === 'x' ? 'completed' : 'in_progress';

            entries.push({
                content,
                status,
                priority: 'medium' // Bob doesn't specify priority, default to medium
            });
        }

        logger.debug(COMPONENT, 'Mapped todo list to plan', {
            todoCount: entries.length,
            entries
        });

        return {
            sessionUpdate: 'plan',
            entries
        };
    }

    private mapModeSwitch(mode: string, toolCallId: string): SessionUpdate[] {
        return [
            {
                sessionUpdate: "tool_call",
                kind: "switch_mode",
                status: "in_progress",
                toolCallId,
                title: "Switch mode to " + mode
            },
            {
                sessionUpdate: "current_mode_update",
                currentModeId: mode
            }
        ];

    }
}

export const eventMapper = new EventMapper();

// Made with Bob
