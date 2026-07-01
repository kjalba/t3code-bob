# Bob Shell ACP Adapter

An [Agent Client Protocol (ACP)](https://agentclientprotocol.com/get-started/introduction) adapter that enables [Bob Shell](https://internal.bob.ibm.com/docs/shell) to integrate with ACP Clients.

> [!WARNING]
> This is a Proof of Concept (POC) implementation and is not intended for production use.   
>  
> This is a community-driven effort and is not officially supported or affiliated with the Bob team.

## Overview

This adapter translates ACP JSON-RPC messages over stdin/stdout into Bob Shell invocations and streams results back to ACP Clients. It acts as a bridge between ACP Clients and Bob Shell's powerful coding capabilities.

```
┌─────────────────────────┐
│      ACP Client         │
└───────────┬─────────────┘
            │ ACP over stdio (JSON-RPC)
            │
┌───────────▼─────────────┐
│    bobshell-acp         │
│  ┌──────────────────┐   │
│  │ JSON-RPC Handler │   │
│  └────────┬─────────┘   │
│  ┌────────▼─────────┐   │
│  │ Session Manager  │   │
│  └────────┬─────────┘   │
│  ┌────────▼─────────┐   │
│  │  Bob Shell Bridge│   │
│  └────────┬─────────┘   │
└───────────┼─────────────┘
            │ spawn process
            │
┌───────────▼─────────────┐
│      Bob Shell CLI      │
│  bob --output-format    │
│      stream-json        │
└─────────────────────────┘
```

## Features

- ✅ Core ACP protocol support for ACP Client integration
- ✅ Multiple turn types: thinking, tool calls, tool results, and messages
- ✅ Session management with isolated working directories
- ✅ Session persistence and resumption - Conversations persist across prompts
- ✅ Real-time streaming of Bob Shell output
- ✅ Support for all Bob Shell modes (code, plan, advanced, ask)
- ✅ Automatic MCP server configuration from ACP Client
- ✅ Secure path validation and sandboxing
- ✅ Process lifecycle management and cancellation
- ✅ Comprehensive error handling and logging

## Prerequisites

- Node.js >= 18.0.0 (Bob Shell requires Node.js version 22.25.0 or later)
- Bob Shell installed and accessible in PATH
- ACP Client with custom agent support (e.g., IntelliJ IDEA 2025.3.3 or later)

## Installation

```bash
# Clone the repository
git clone <this repository>
cd bob-acp-adapter

# Install dependencies
npm install

# Build the adapter
npm run build

# Make the wrapper script executable
chmod +x bobshell-acp.sh
```

> [!NOTE]
> If `npm install` fails with `npm ERR! code E401` / `Incorrect or missing password`, use:
> ```bash
> npm install --package-lock=false --registry=https://registry.npmjs.org/
> ```

## Configuration

### bobshell-acp.sh

Add your node path to the executable wrapper `bobshell-acp.sh`
```bash
# Use the full path to node
NODE_PATH="<YOUR-NODE-PATH>"
```

### ACP Client Setup (IntelliJ IDEA Example)

1. Open IntelliJ IDEA
2. Go to **AI Chat → Add Custom Agent**
3. This creates `~/.jetbrains/acp.json`
4. Edit the file to add Bob Shell:

```json
{
  "default_mcp_settings": {
    "use_custom_mcp": true,
    "use_idea_mcp": true
  },
  "agent_servers": {
    "Bob Shell": {
      "command": "/absolute/path/to/bobshell-acp/bobshell-acp.sh",
      "args": [],
      "env": {
        "BOB_PATH": "/absolute/path/to/bobshell",
        "BOB_LOG_LEVEL": "info"
      }
    }
  }
}
```

### Environment Variables

Configure the adapter using these environment variables:

- `BOB_PATH`: Path to Bob Shell executable (default: `bob` in PATH)
- `BOB_LOG_LEVEL`: Log level - `error`, `warn`, `info`, `debug` (default: `info`)
- `BOB_LOG_FILE`: Path to log file for persistent logging (optional, e.g., `~/bob-acp.log`)
- `BOB_TIMEOUT`: Process timeout in seconds (default: `300`)
- `BOB_MAX_OUTPUT_SIZE`: Max output size per update in bytes (default: `1048576`)
- `BOB_DEFAULT_MODE`: Default chat mode (default: `code`)

## Usage

### From ACP Client (IntelliJ IDEA Example)

1. Open the AI Chat panel
2. Select "IBM BOB" from the agent dropdown
3. Start chatting!

Example prompts:
- "Summarize this project"
- "Fix the failing tests in auth.ts"
- "Refactor this function to use async/await"
- "Add error handling to the API endpoints"

## Development

```bash
# Run in development mode with auto-reload
npm run dev

# Build for production
npm run build

# Clean build artifacts
npm run clean
```

## Architecture

### Core Modules

1. **Transport Layer** (`src/transport/`)
   - Handles stdin/stdout JSON-RPC communication
   - Strict logging to stderr only
   - Message validation and parsing

2. **ACP Protocol Handler** (`src/acp/`)
   - Implements ACP methods: `initialize`, `session/new`, `session/prompt`, `session/cancel`
   - Method dispatching and error handling
   - Type definitions for ACP protocol

3. **Session Manager** (`src/session/`)
   - Tracks active sessions
   - Manages session state (cwd, history, mode)
   - Process lifecycle management

4. **Bob Shell Bridge** (`src/bridge/`)
   - Spawns and manages Bob Shell processes
   - Parses stream-json output
   - Maps Bob Shell events to ACP notifications

5. **Security Module** (`src/security/`)
   - Path validation and sanitization
   - Working directory enforcement
   - Environment variable filtering

## ACP Protocol Support

### Implemented Methods

- ✅ `initialize` - Protocol negotiation
- ✅ `session/new` - Create new session
- ✅ `session/set_mode` - Switch session mode
- ✅ `session/prompt` - Execute prompt
- ✅ `session/cancel` - Cancel running prompt

### Notifications

- ✅ `session/update` - Stream progress and results with multiple turn types:
  - `agent_message_chunk` - Regular text responses
  - `agent_thought_chunk` - Bob's reasoning process (from `<thinking>` tags)
  - `tool_call` - Tool execution requests
  - `tool_call_update` - Tool execution results and updates
  - `plan` - Todo list updates (from `update_todo_list` tool)
  - `current_mode_update` - Mode switch notifications

### Supported Tools and ACP Mapping

The adapter maps Bob Shell tools to ACP tool kinds and formats their parameters appropriately:

#### File Operations
- **`read_file`** → `kind: 'read'`
  - Includes file path in `locations`
  - Title: "Read file: {path}"

- **`list_files`** → `kind: 'read'`
  - Includes directory path in `locations`
  - Title: "List files: {path}"
  - Raw parameters included for filtering options

- **`write_to_file`** → `kind: 'edit'`
  - Includes file path in `locations`
  - Title: "Write to file: {path}"
  - Full diff sent in `tool_call_update`

#### Code Editing
- **`apply_diff`** → `kind: 'edit'`
  - Parses Bob's Search/Replace format into ACP Diff format
  - Includes file path in `locations`
  - Content includes structured diff with `oldText` and `newText`
  - Title: "Edit file: {path}"

- **`search_and_replace`** → `kind: 'edit'`
  - Includes file path in `locations`
  - Title: "Edit file: {path}"
  - Unified diff parsed from tool result and sent in `tool_call_update`

#### Command Execution
- **`execute_command`** → `kind: 'execute'`
  - Title: Command string
  - Content includes terminal output with unique `terminalId`
  - Includes `cwd` in `rawInput` and `_meta.terminal_info`
  - Tool result sends two updates:
    1. `terminal_output_delta` with command output
    2. `terminal_exit` with exit code and completion status

#### Special Tools
- **`switch_mode`** → `kind: 'switch_mode'`
  - Sends two updates:
    1. Tool call with status "in_progress"
    2. `current_mode_update` with new mode ID
  - Title: "Switch mode to {mode}"

- **`update_todo_list`** → Mapped to `plan` update
  - Parses markdown checklist format
  - Converts `[ ]` to `in_progress` status
  - Converts `[x]` to `completed` status
  - Sends as `sessionUpdate: 'plan'` with structured entries

- **`attempt_completion`** → Sent as `agent_message_chunk`
  - Result parameter extracted and sent as regular message
  - Allows ACP Client to display completion naturally
  - Tool result is not sent (already displayed as message)

#### Other Tools
- All other Bob Shell tools → `kind: 'other'`
  - Basic title and parameters included
  - Standard tool_call/tool_call_update flow

### Future Enhancements

- ⏳ `session/load` - Load historical sessions from disk
- ⏳ Slash commands

### Capability Notes

- `initialize` currently advertises `loadSession: false`.
- `initialize` currently advertises `mcpCapabilities.http: false` and `mcpCapabilities.sse: false`.
- The adapter still accepts/stores HTTP/SSE MCP server definitions in `.bob/mcp.json` for Bob Shell to consume.

## Session Persistence

The adapter maintains conversation continuity by mapping ACP session IDs to Bob Shell session indices:

- **First prompt**: Creates a new Bob Shell session (index 1, 2, 3, etc.)
- **Follow-up prompts**: Automatically resume the existing Bob Shell session
- **Session mapping**: Stored in `.bob/bob-acp-sessions.json` per project
- **Persistence**: Sessions survive IntelliJ restarts and continue where you left off

### How It Works

1. IntelliJ creates an ACP session with a UUID (e.g., `sess_507ec3dc-...`)
2. On the first prompt, the adapter:
   - Gets the next available Bob Shell session index for the project
   - Creates a mapping: `sess_507ec3dc-... → 1`
   - Runs: `bob "your prompt" --output-format stream-json ...`
3. On subsequent prompts in the same session:
   - Looks up the Bob Shell session index (1)
   - Runs: `bob --resume 1 --prompt "your prompt" --output-format stream-json ...`

This ensures full conversation context is maintained across all interactions within a session.

## Limitations

Due to the nature of the ACP protocol and this POC implementation, the following interactions are **currently not possible** without direct access to the code:

- **Approval Requests**: Bob Shell cannot request user approval for sensitive operations (e.g., file deletions, system commands)
- **Interactive Prompts**: Multi-step interactions requiring user confirmation are not supported
- **Follow-up Questions**: Bob Shell cannot ask clarifying questions mid-execution
- **User Input During Execution**: Any tool or operation requiring runtime user input will fail

These limitations exist because the ACP protocol operates in a request-response model without support for mid-execution user interaction. Future enhancements may address these constraints through protocol extensions or alternative interaction patterns.

## MCP Server Integration

The adapter now automatically configures MCP servers sent by ACP Clients. When an ACP Client creates a new session with MCP server configurations, the adapter:

1. **Receives MCP server configs** from IntelliJ in the `session/new` request
2. **Writes `.bob/mcp.json`** in the project's working directory
3. **Ensures config exists** before each prompt (handles race conditions)
4. **Bob Shell reads the config** and manages MCP servers itself

### How It Works

When an ACP Client sends a `session/new` request with MCP servers like this:

```json
{
  "method": "session/new",
  "params": {
    "cwd": "/path/to/project",
    "mcpServers": [
      {
        "type": "stdio",
        "name": "idea",
        "command": "/path/to/java",
        "args": ["-classpath", "..."],
        "env": [
          {"name": "IJ_MCP_SERVER_PROJECT_PATH", "value": "/path/to/project"},
          {"name": "IJ_MCP_SERVER_PORT", "value": "64442"},
          {"name": "IJ_MCP_AUTH_TOKEN", "value": "token"}
        ]
      }
    ]
  }
}
```

The adapter automatically creates `.bob/mcp.json`:

```json
{
  "mcpServers": {
    "idea": {
      "command": "/path/to/java",
      "args": ["-classpath", "..."],
      "env": {
        "IJ_MCP_SERVER_PROJECT_PATH": "/path/to/project",
        "IJ_MCP_SERVER_PORT": "64442",
        "IJ_MCP_AUTH_TOKEN": "token"
      }
    }
  }
}
```

### Supported MCP Config Inputs

The adapter can persist all MCP transport config inputs to `.bob/mcp.json`:

- **STDIO**: Local processes (most common from IntelliJ)
- **SSE**: Server-Sent Events for remote servers
- **HTTP**: HTTP endpoints for streamable connections

### How It Works

1. **Session Creation** (`session/new`):
   - Adapter receives MCP server configs from ACP Client
   - Writes `.bob/mcp.json` in the project directory
   - Session is created with MCP server info stored

2. **Before Each Prompt** (`session/prompt`):
   - Adapter ensures `.bob/mcp.json` exists (handles race conditions)
   - Re-writes config if needed to guarantee it's present
   - Bob Shell is spawned

3. **Bob Shell Execution**:
   - Bob Shell reads `.bob/mcp.json` on startup
   - Bob Shell manages MCP server connections itself
   - MCP tools become available to Bob Shell

### Configuration Priority

Bob Shell uses this priority order for MCP configurations:

1. **Project-level** (`.bob/mcp.json` in project directory) - Created by this adapter
2. **Global** (`~/.bob/mcp_settings.json`) - User's personal settings

When an ACP Client provides MCP servers, they take precedence for that session.

- ⏳ Advanced diff formatting

## Security

The adapter implements several security measures:

- **Path Validation**: All paths are validated and normalized
- **Working Directory Enforcement**: Operations are restricted to session cwd
- **Environment Sanitization**: Only allowlisted env vars are passed to Bob Shell
- **Process Timeouts**: Prevents runaway processes
- **Output Size Limits**: Caps individual update sizes
- **Secret Redaction**: Sensitive data is filtered from logs

## Troubleshooting

### Adapter doesn't appear in ACP Client

1. Check that `acp.json` has the correct path to the adapter
2. Verify the adapter is executable: `chmod +x bobshell-acp.sh`
3. Check stderr logs for startup errors

### No output from Bob Shell

1. Verify Bob Shell is installed: `bob --version`
2. Check `BOB_PATH` environment variable
3. Test Bob Shell directly: `bob "test prompt" --output-format stream-json`
4. Check stderr logs for process spawn errors

### Stdout corruption errors

This usually means something is writing to stdout besides JSON-RPC messages:
1. Check that all logging goes to stderr
2. Verify no console.log statements in code
3. Check Bob Shell isn't printing banners

### Process timeouts

1. Increase `BOB_TIMEOUT` environment variable
2. Check if Bob Shell is hanging on a prompt
3. Review stderr logs for Bob Shell errors

## Logging

All logs are written to stderr in JSON format. You can also enable file logging to capture all parameters and prompts from IntelliJ.

### Basic Logging (stderr only)

```json
{
  "timestamp": "2026-03-09T18:00:00.000Z",
  "level": "INFO",
  "component": "session-manager",
  "sessionId": "sess_123",
  "message": "Session created",
  "cwd": "/path/to/project"
}
```

Set `BOB_LOG_LEVEL=debug` for verbose logging.

### File Logging

To capture all parameters and prompts from ACP Clients to a file:

```bash
export BOB_LOG_FILE=~/bob-acp.log
export BOB_LOG_LEVEL=DEBUG
```

Or configure in `acp.json`:

```json
{
  "agent_servers": {
    "Bob Shell": {
      "command": "/path/to/bobshell-acp.sh",
      "env": {
        "BOB_LOG_FILE": "/path/to/bob-acp.log",
        "BOB_LOG_LEVEL": "DEBUG"
      }
    }
  }
}
```

The log file will contain:
- All startup parameters and environment details
- Every JSON-RPC request from ACP Clients with full parameters
- All prompts sent from ACP Clients with complete text
- Session lifecycle events
- Bob Shell execution details

See [LOGGING.md](./LOGGING.md) for detailed logging documentation and examples.

## Turn Types

The adapter supports multiple ACP turn types to provide rich, structured output from Bob Shell:

- **Thinking Content**: Bob's internal reasoning extracted from `<thinking>` tags
- **Tool Calls**: When Bob uses tools like `read_file`, `execute_command`, etc.
- **Tool Results**: Results from tool executions
- **Message Chunks**: Regular conversational responses

This allows ACP Clients to display different types of content appropriately (e.g., collapsible thinking sections, tool execution indicators).

See [TURN_TYPES.md](./TURN_TYPES.md) for detailed documentation on turn types.
