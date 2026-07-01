#!/bin/bash
# Bob Shell ACP Adapter - Executable Wrapper
# This script ensures the adapter runs with Node.js

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Use the full path to node
NODE_PATH="/opt/homebrew/bin/node"

# Fallback to system node if Volta node doesn't exist
if [ ! -f "$NODE_PATH" ]; then
  NODE_PATH="node"
fi

# Run the adapter with Node.js
exec "$NODE_PATH" "$SCRIPT_DIR/dist/index.js" "$@"
