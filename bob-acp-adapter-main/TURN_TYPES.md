# ACP Turn Types Support

This document explains the different turn types supported by the Bob Shell ACP adapter for ACP Client integration.

## Overview

The adapter now supports multiple turn types as [defined](https://agentclientprotocol.com/protocol/prompt-turn) by the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/introduction), allowing IntelliJ to display different types of content from Bob's responses in appropriate UI components.

## Supported Turn Types (Session Update)

[Specification](https://agentclientprotocol.com/protocol/schema#sessionupdate)

### 1. Agent Message Chunks (`agent_message_chunk`)

Regular text content from Bob's responses.

**ACP Format:**
```json
{
  "sessionUpdate": "agent_message_chunk",
  "content": {
    "type": "text",
    "text": "Here's the solution to your problem..."
  }
}
```

**Usage:** Standard conversational responses, explanations, and code snippets.

### 2. Thinking Content (`agent_thought_chunk`)

Bob's internal reasoning process, extracted from `<thinking>` tags in the output.

**ACP Format:**
```json
{
  "sessionUpdate": "agent_thought_chunk",
  "content": {
    "type": "text",
    "text": "Let me analyze the requirements... The user wants to..."
  }
}
```

**Bob Output Example:**
```
<thinking>
Let me analyze the code structure first.
The main issue is in the authentication flow.
I should check the token validation logic.
</thinking>

Based on my analysis, here's what needs to be fixed...
```

**ACP Client Display:** The thinking content can be displayed in a collapsible section or with different styling to distinguish it from the main response.

### 3. Tool Calls (`tool_call`)

When Bob uses a tool (like reading a file, executing a command, etc.).

**ACP Format:**
```json
{
  "sessionUpdate": "tool_call",
  "kind": "read",
  "toolCallId": "call_abc123",
  "status": "in_progress",
  "title": "Read file: src/app.ts",
  "locations": [
    {
      "path": "src/app.ts"
    }
  ]
}
```

**Tool Kinds:**
- `read` - File reading operations (read_file, list_files)
- `edit` - File editing operations (write_to_file, apply_diff, search_and_replace)
- `execute` - Command execution (execute_command)
- `switch_mode` - Mode switching (switch_mode)
- `other` - Other tools

**Usage:** Indicates Bob is performing an action using one of its available tools.

### 4. Tool Results (`tool_call_update`)

The result of a tool execution.

**ACP Format:**
```json
{
  "sessionUpdate": "tool_call_update",
  "toolCallId": "call_abc123",
  "status": "completed",
  "content": [
    {
      "type": "content",
      "content": {
        "type": "text",
        "text": "File contents: ..."
      }
    }
  ],
  "rawOutput": "File contents: ..."
}
```

**Status Values:**
- `completed` - Tool executed successfully
- `failed` - Tool execution failed

**Special Cases:**

**Execute Command:** Sends two updates:
1. Terminal output delta with command output
2. Terminal exit with exit code and completion status

```json
// Update 1: Output
{
  "sessionUpdate": "tool_call_update",
  "toolCallId": "call_abc123",
  "_meta": {
    "terminal_output_delta": {
      "data": "command output...",
      "terminal_id": "call_abc123"
    }
  }
}

// Update 2: Exit
{
  "sessionUpdate": "tool_call_update",
  "toolCallId": "call_abc123",
  "status": "completed",
  "rawOutput": {
    "formatted_output": "command output...",
    "exit_code": 0
  },
  "_meta": {
    "terminal_exit": {
      "exit_code": 0,
      "signal": null,
      "terminal_id": "call_abc123"
    }
  }
}
```

**Diff Operations:** For search_and_replace and apply_diff, includes structured diff:
```json
{
  "sessionUpdate": "tool_call_update",
  "toolCallId": "call_abc123",
  "status": "completed",
  "content": [
    {
      "type": "diff",
      "path": "src/app.ts",
      "oldText": "old content...",
      "newText": "new content..."
    }
  ]
}
```

**Usage:** Shows the outcome of tool executions, which can be successful results or errors.

### 5. Plan Updates (`plan`)

Todo list updates from Bob's `update_todo_list` tool.

**ACP Format:**
```json
{
  "sessionUpdate": "plan",
  "entries": [
    {
      "content": "Analyze requirements",
      "status": "completed",
      "priority": "medium"
    },
    {
      "content": "Implement core logic",
      "status": "in_progress",
      "priority": "medium"
    },
    {
      "content": "Write tests",
      "status": "in_progress",
      "priority": "medium"
    }
  ]
}
```

**Status Mapping:**
- `[x]` in Bob's markdown → `completed`
- `[ ]` in Bob's markdown → `in_progress`

**Usage:** Allows ACP Clients to display Bob's task progress in a structured way.

### 6. Mode Updates (`current_mode_update`)

Notification when Bob switches modes.

**ACP Format:**
```json
{
  "sessionUpdate": "current_mode_update",
  "currentModeId": "plan"
}
```

**Supported Modes:**
- `code` - Code implementation mode
- `plan` - Planning mode
- `advanced` - Advanced mode with more capabilities
- `ask` - Question answering mode

**Usage:** Informs the ACP Client of Bob's current operating mode.

### 7. Completion Handling

Bob uses the `attempt_completion` tool to signal task completion. The adapter handles this specially:

**Implementation:**
- The `result` parameter from `attempt_completion` is sent as a regular `agent_message_chunk`
- No special completion turn type is used
- The tool_result is not sent (to avoid duplication)

**Example:**
```json
// Bob sends: attempt_completion with result
// Adapter converts to:
{
  "sessionUpdate": "agent_message_chunk",
  "content": {
    "type": "text",
    "text": "Task completed successfully!"
  }
}
```

**ACP Client Handling:** Clients can detect completion by monitoring for the `attempt_completion` tool call or by analyzing the message content.

## Implementation Details

### Thinking Tag Parsing

The adapter automatically parses `<thinking>` tags from Bob's output:

1. **Opening Tag Detection:** When `<thinking>` is encountered, the adapter starts buffering content
2. **Content Accumulation:** All content between tags is accumulated
3. **Closing Tag Detection:** When `</thinking>` is found, the buffered content is sent as a `thinking` update
4. **Regular Content:** Content outside thinking tags is sent as regular `agent_message_chunk` updates

### State Management

The event mapper maintains state for:
- `inThinkingBlock`: Boolean flag indicating if currently inside thinking tags
- Active tool calls: Maps tool call IDs to tool names for result correlation
- Session manager: Tracks session state, mode, and generates unique tool IDs
- State is reset on session completion or error

### Streaming Behavior

The adapter handles streaming content correctly:
- **Thinking tags can span multiple message chunks** - The parser accumulates content across delta messages
- **Content is properly buffered** until closing tags are found
- **Regular content is streamed immediately** (after filtering)
- **Tool calls and results** are sent as discrete events
- **Tool usage messages are filtered** - Lines like `[using tool attempt_completion: ...]` are removed

### Content Filtering

The adapter automatically filters out Bob's internal messages:
- `[using tool <name>: <status> | Cost: <amount>]` - Removed from output
- These are Bob's internal logging messages and not meant for end users
- Ensures clean, user-friendly output in IntelliJ

## Example Flow

```
Bob Output Stream:
─────────────────────────────────────────────────────────
{"type":"message","role":"assistant","content":"<thinking>"}
{"type":"message","role":"assistant","content":"I need to analyze"}
{"type":"message","role":"assistant","content":" the code first"}
{"type":"message","role":"assistant","content":"</thinking>"}
{"type":"message","role":"assistant","content":"Here's the fix:"}
{"type":"tool_use","tool_name":"apply_diff","tool_id":"t1",...}
{"type":"tool_result","tool_id":"t1","status":"success",...}
{"type":"tool_use","tool_name":"attempt_completion","tool_id":"t2","parameters":{"result":"Done!"}}
{"type":"tool_result","tool_id":"t2","status":"success","output":"Done!"}

ACP Updates Sent to ACP Client:
─────────────────────────────────────────────────────────
1. agent_thought_chunk: "I need to analyze the code first"
2. agent_message_chunk: "Here's the fix:"
3. tool_call: apply_diff with kind='edit', locations, and diff content
4. tool_call_update: success result with structured diff
5. agent_message_chunk: "Done!" (from attempt_completion result parameter)
```

### Special Handling: `attempt_completion`

Bob uses the `attempt_completion` tool to signal the final result. The adapter handles this specially:

1. When `tool_use` with `tool_name: "attempt_completion"` is received
2. The `result` parameter is extracted and sent as an `agent_message_chunk` (not a special completion type)
3. The tool_result is NOT sent to avoid duplication
4. This allows the completion message to appear naturally in the conversation flow

**Example:**
```json
// Bob sends:
{"type":"tool_use","tool_name":"attempt_completion","parameters":{"result":"Task completed successfully!"}}

// Adapter converts to:
{
  "sessionUpdate": "agent_message_chunk",
  "content": {
    "type": "text",
    "text": "Task completed successfully!"
  }
}
```

**ACP Client Handling:**
- Receives completion as a regular message
- Can detect completion by monitoring tool calls or message content
- No special UI treatment required (though clients may choose to add it)

## Benefits

### For Users
- **Transparency:** See Bob's reasoning process
- **Context:** Understand why Bob made certain decisions
- **Tool Visibility:** Track what actions Bob is taking
- **Better UX:** Different content types can be styled appropriately in ACP Clients

### For Developers
- **Debugging:** Easier to understand Bob's decision-making
- **Monitoring:** Track tool usage and success rates
- **Extensibility:** Easy to add new turn types in the future

## Configuration

No additional configuration is required. The turn type parsing is automatic and always enabled.

To see thinking content in logs:
```bash
export BOB_LOG_LEVEL=DEBUG
export BOB_LOG_FILE=~/bob-acp.log
```

## Future Enhancements

Potential future turn types:
- `diff`: Structured code diffs
- `progress`: Long-running operation progress
- `error`: Structured error information
- `suggestion`: Code suggestions with metadata
- `citation`: Source references and citations

## Technical Notes

### Performance
- Thinking tag parsing adds minimal overhead
- Buffering is memory-efficient (only active thinking content is buffered)
- State is properly cleaned up after each session

### Compatibility
- Backward compatible with Bob Shell versions that don't use thinking tags
- IntelliJ versions that don't support thinking turn type will receive it as a regular update
- Tool calls work with all Bob Shell modes (code, plan, advanced, ask)

## Troubleshooting

### Thinking Content Not Appearing
1. Verify Bob is actually outputting `<thinking>` tags
2. Check log level is INFO or DEBUG
3. Ensure ACP Client supports the `agent_thought_chunk` turn type

### Incomplete Thinking Content
- The adapter buffers content until closing tag is found
- If Bob's output is interrupted, buffered content may be lost
- Check logs for "Extracted thinking content" messages

### Tool Calls Not Showing
1. Verify Bob Shell is using tools (check with `--output-format stream-json`)
2. Ensure tool events are being parsed correctly (check logs)
3. Verify ACP Client is handling tool_call updates

### Plan Updates Not Appearing
1. Verify Bob is using the `update_todo_list` tool
2. Check that the todo list is in markdown checklist format
3. Ensure ACP Client supports the `plan` turn type
