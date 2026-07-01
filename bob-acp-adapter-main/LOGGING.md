# Bob Shell ACP Adapter - Logging Guide

This document explains how to enable and use logging to capture parameters and prompts from IntelliJ IDEA.

## Environment Variables

### BOB_LOG_LEVEL
Controls the verbosity of logging output.

**Values:**
- `ERROR` - Only errors
- `WARN` - Warnings and errors
- `INFO` - General information (default)
- `DEBUG` - Detailed debugging information

**Example:**
```bash
export BOB_LOG_LEVEL=DEBUG
```

### BOB_LOG_FILE
Specifies a file path where logs will be written in addition to stderr.

**Example:**
```bash
export BOB_LOG_FILE=~/bob-acp-adapter.log
```

Or use an absolute path:
```bash
export BOB_LOG_FILE=/tmp/bob-acp-adapter.log
```

## What Gets Logged

### Startup Parameters
When the adapter starts, it logs:
- Node.js version
- Platform and architecture
- Current working directory
- Command-line arguments (`process.argv`)
- Relevant environment variables

### Incoming Requests from IntelliJ
Every JSON-RPC request from IntelliJ is logged with:
- Method name
- Request ID
- Full parameters object
- Complete request structure

### Prompts from IntelliJ
When IntelliJ sends a prompt via `session/prompt`, the adapter logs:
- Session ID
- Prompt type (string or object)
- Full parameters
- Extracted prompt text
- Prompt preview (first 200 characters)

### Bob Shell Output (DEBUG level)
When `BOB_LOG_LEVEL=DEBUG`, the adapter logs all raw JSON from Bob Shell:
- Raw JSON lines as received from Bob Shell stdout
- Parsed event objects with full details
- Event type and structure
- ACP updates generated from Bob Shell events

This allows you to see:
- Exactly what Bob Shell is outputting
- How events are being parsed and mapped
- The complete flow from Bob Shell → Adapter → IntelliJ

## Usage Examples

### Basic Logging to File
```bash
# Set environment variables
export BOB_LOG_FILE=~/bob-acp.log
export BOB_LOG_LEVEL=INFO

# Run the adapter (IntelliJ will start it automatically)
# Or test manually:
node dist/index.js
```

### Debug Mode with File Logging
```bash
export BOB_LOG_FILE=~/bob-acp-debug.log
export BOB_LOG_LEVEL=DEBUG
```

### Configure in IntelliJ
Add these environment variables to your IntelliJ ACP configuration:

1. Open IntelliJ Settings
2. Navigate to the ACP/Bob configuration
3. Add environment variables:
   - `BOB_LOG_FILE=/path/to/your/logfile.log`
   - `BOB_LOG_LEVEL=DEBUG`

## Log Format

Logs are written in JSON format, one entry per line:

```json
{
  "timestamp": "2026-03-11T08:45:00.000Z",
  "level": "INFO",
  "component": "stdio-transport",
  "message": "Received JSON-RPC request from IntelliJ",
  "data": {
    "method": "session/prompt",
    "id": "req-123",
    "params": {
      "sessionId": "session-456",
      "prompt": "Explain this code"
    },
    "fullRequest": { ... }
  }
}
```

## Viewing Logs

### Real-time Monitoring
```bash
tail -f ~/bob-acp.log
```

### Pretty Print JSON Logs
```bash
tail -f ~/bob-acp.log | jq '.'
```

### Filter by Component
```bash
grep '"component":"session-prompt-handler"' ~/bob-acp.log | jq '.'
```

### Extract All Prompts
```bash
grep '"message":"Processing prompt text extracted from IntelliJ"' ~/bob-acp.log | jq '.data.promptText'
```

### View Bob Shell Raw JSON Output
```bash
grep '"message":"Raw JSON from Bob Shell"' ~/bob-acp.log | jq '.data.rawJson'
```

### View All Bob Shell Events
```bash
grep '"message":"Parsed Bob Shell event"' ~/bob-acp.log | jq '.data.event'
```

### View ACP Updates Sent to IntelliJ
```bash
grep '"message":"Generated ACP update for IntelliJ"' ~/bob-acp.log | jq '.data.update'
```

## Troubleshooting

### No Log File Created
- Check that the directory exists
- Verify write permissions
- Check stderr output for initialization errors

### Missing Prompts in Logs
- Ensure `BOB_LOG_LEVEL` is set to `INFO` or `DEBUG`
- Verify the adapter is actually receiving requests from IntelliJ
- Check that the log file path is correct

### Log File Too Large
The adapter appends to the log file. To rotate logs:
```bash
# Backup and clear the log
mv ~/bob-acp.log ~/bob-acp.log.backup
touch ~/bob-acp.log
```

## Security Note

Log files may contain sensitive information including:
- User prompts and code
- File paths
- Environment variables

**Recommendations:**
- Store log files in secure locations
- Rotate and clean up logs regularly
- Do not commit log files to version control
- Add `*.log` to `.gitignore`