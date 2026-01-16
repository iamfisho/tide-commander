#!/bin/bash
# Tide Commander - Claude Code Hook Script
# This script captures Claude Code events and forwards them to the Tide Commander server

set -e

# Configuration
TIDE_SERVER="${TIDE_SERVER:-http://localhost:5174}"
TIDE_DATA_DIR="${HOME}/.tide-commander"
EVENTS_FILE="${TIDE_DATA_DIR}/events.jsonl"

# Ensure data directory exists
mkdir -p "${TIDE_DATA_DIR}"

# Read event from stdin
EVENT=$(cat)

# Parse event type and data
EVENT_TYPE=$(echo "$EVENT" | jq -r '.event // .type // "unknown"')

# Generate unique event ID
EVENT_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || echo "$$-$(date +%s%N)")

# Get session ID from event or environment
SESSION_ID=$(echo "$EVENT" | jq -r '.session_id // empty')
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
fi

# Get timestamp
TIMESTAMP=$(date +%s%3N)

# Transform event to Tide format
case "$EVENT_TYPE" in
  "PreToolUse"|"pre_tool_use")
    TOOL=$(echo "$EVENT" | jq -r '.tool_name // .tool // "unknown"')
    TOOL_INPUT=$(echo "$EVENT" | jq -c '.tool_input // .input // {}')
    TOOL_USE_ID=$(echo "$EVENT" | jq -r '.tool_use_id // empty')

    TIDE_EVENT=$(jq -n \
      --arg id "$EVENT_ID" \
      --arg type "pre_tool_use" \
      --arg sessionId "$SESSION_ID" \
      --arg tool "$TOOL" \
      --argjson toolInput "$TOOL_INPUT" \
      --arg toolUseId "$TOOL_USE_ID" \
      --argjson timestamp "$TIMESTAMP" \
      '{
        id: $id,
        type: $type,
        sessionId: $sessionId,
        tool: $tool,
        toolInput: $toolInput,
        toolUseId: $toolUseId,
        timestamp: $timestamp
      }')
    ;;

  "PostToolUse"|"post_tool_use")
    TOOL=$(echo "$EVENT" | jq -r '.tool_name // .tool // "unknown"')
    TOOL_USE_ID=$(echo "$EVENT" | jq -r '.tool_use_id // empty')

    TIDE_EVENT=$(jq -n \
      --arg id "$EVENT_ID" \
      --arg type "post_tool_use" \
      --arg sessionId "$SESSION_ID" \
      --arg tool "$TOOL" \
      --arg toolUseId "$TOOL_USE_ID" \
      --argjson timestamp "$TIMESTAMP" \
      '{
        id: $id,
        type: $type,
        sessionId: $sessionId,
        tool: $tool,
        toolUseId: $toolUseId,
        timestamp: $timestamp
      }')
    ;;

  "Stop"|"stop")
    TIDE_EVENT=$(jq -n \
      --arg id "$EVENT_ID" \
      --arg type "stop" \
      --arg sessionId "$SESSION_ID" \
      --argjson timestamp "$TIMESTAMP" \
      '{
        id: $id,
        type: $type,
        sessionId: $sessionId,
        timestamp: $timestamp
      }')
    ;;

  "UserPromptSubmit"|"user_prompt_submit")
    PROMPT=$(echo "$EVENT" | jq -r '.prompt // .message // ""')

    TIDE_EVENT=$(jq -n \
      --arg id "$EVENT_ID" \
      --arg type "user_prompt" \
      --arg sessionId "$SESSION_ID" \
      --arg prompt "$PROMPT" \
      --argjson timestamp "$TIMESTAMP" \
      '{
        id: $id,
        type: $type,
        sessionId: $sessionId,
        prompt: $prompt,
        timestamp: $timestamp
      }')
    ;;

  *)
    # Unknown event type, log but don't forward
    echo "[Tide Hook] Unknown event type: $EVENT_TYPE" >> "${TIDE_DATA_DIR}/hook.log"
    exit 0
    ;;
esac

# Append to events file
echo "$TIDE_EVENT" >> "$EVENTS_FILE"

# Forward to server (async, don't wait)
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "$TIDE_EVENT" \
  "${TIDE_SERVER}/api/event" > /dev/null 2>&1 &

exit 0
