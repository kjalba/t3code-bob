/**
 * Handle ACP session/new method
 */

import {JsonRpcRequest, JsonRpcResponse,} from '../types.js';
import {SessionManager} from '../../session/session-manager.js';
import {pathValidator} from '../../security/path-validator.js';
import {logger} from '../../transport/logger.js';
import {InvalidParamsError} from '../../utils/errors.js';
import {writeMcpConfig} from '../../utils/mcp-config-writer.js';
import {NewSessionRequest, NewSessionResponse} from "@agentclientprotocol/sdk";

const COMPONENT = 'session-new-handler';

export async function handleSessionNew(
    request: JsonRpcRequest,
    sessionManager: SessionManager
): Promise<JsonRpcResponse> {
    const params = request.params as NewSessionRequest;

    // Validate required parameters
    if (!params?.cwd) {
        throw new InvalidParamsError('Missing required parameter: cwd');
    }

    // Validate and sanitize cwd
    const validatedCwd = pathValidator.validateCwd(params.cwd);

    // Write MCP configuration if servers are provided
    if (params.mcpServers && params.mcpServers.length > 0) {
        try {
            await writeMcpConfig(validatedCwd, params.mcpServers);
            logger.info(COMPONENT, 'MCP servers configured from IntelliJ', {
                cwd: validatedCwd,
                serverCount: params.mcpServers.length,
                serverNames: params.mcpServers.map(s => s.name),
            });
        } catch (error) {
            logger.error(COMPONENT, 'Failed to write MCP configuration', {
                cwd: validatedCwd,
                error: String(error),
            });
            // Don't fail the session creation, just log the error
        }
    }

    // Create session (bobSessionId is unknown until Bob emits init event on first prompt)
    const session = sessionManager.createSession(
        validatedCwd,
        'code',
        params.mcpServers || [],
        null // bobSessionId - assigned from Bob init event
    );

    logger.info(COMPONENT, 'Session created', {
        sessionId: session.id,
        cwd: session.cwd,
        mode: session.mode,
        mcpServerCount: session.mcpServers.length,
        bobSessionId: 'pending',
    }, session.id);

    const result: NewSessionResponse = {
        sessionId: session.id,
        modes: {
            currentModeId: 'code',
            availableModes: [
                {
                    id: 'code',
                    name: 'Code',
                    description: 'Code mode',
                },
                {
                    id: 'ask',
                    name: 'Ask',
                    description: 'Ask mode',
                },
                {
                    id: 'plan',
                    name: 'Plan',
                    description: 'Plan mode',
                },
                {
                    id: 'advanced',
                    name: 'Advanced',
                    description: 'Advanced mode',
                }

            ]
        }
    };

    return {
        jsonrpc: '2.0',
        id: request.id,
        result,
    };
}

// Made with Bob
