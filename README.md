# Tide Commander

RTS/MOBA-style Claude Code agents commander. Deploy, position, and command multiple Claude Code instances on a strategic battlefield.

## Features

- **3D Battlefield** - Visual command center with Three.js
- **Agent Classes** - Scout, Builder, Debugger, Architect, Warrior, Support
- **RTS Controls** - Click to select, right-click to move, number keys for quick selection
- **Real-time Activity Feed** - Watch your agents work in real-time
- **Multi-Agent Management** - Spawn and control multiple Claude Code instances
- **Session Persistence** - Agents resume their Claude Code sessions across restarts

## Prerequisites

- Node.js 18+
- Claude Code CLI (`claude` command available in PATH)

## Installation

```bash
# Install dependencies
npm install

# Start the application
npm run dev
```

Then open http://localhost:5173 in your browser.

## How It Works

### Overview

Tide Commander provides a visual interface for managing multiple Claude Code CLI instances simultaneously. Each "agent" you spawn is a real Claude Code process running in the background, and you can send commands to them and watch their output in real-time.

### Core Components

**1. Frontend (React + Three.js)**
- 3D battlefield where agents are visualized as characters
- WebSocket connection to receive real-time updates
- Command input for sending tasks to agents
- Activity feed showing what each agent is doing

**2. Backend (Node.js + Express)**
- REST API for agent CRUD operations
- WebSocket server for real-time event streaming
- Process manager that spawns and controls Claude CLI instances

**3. Claude CLI Integration**
- Each agent runs `claude` with `--output-format stream-json`
- Events (tool usage, text output, errors) are parsed from stdout
- Commands are sent via stdin in stream-json format
- Sessions are persisted in `~/.claude/projects/` and can be resumed

### Agent Lifecycle

```
1. User clicks "+ New Agent"
   └─> Server creates agent record with unique ID

2. User sends a command
   └─> Server spawns: claude --print --verbose --output-format stream-json --input-format stream-json
   └─> Command sent via stdin as JSON
   └─> Agent status: "working"

3. Claude processes the command
   └─> stdout emits JSON events (tool_use, text, result, etc.)
   └─> Server parses events and broadcasts via WebSocket
   └─> Frontend updates agent status and activity feed

4. Claude finishes
   └─> "result" event received with token usage
   └─> Agent status: "idle"
   └─> Process stays alive for follow-up commands

5. User sends another command
   └─> Sent directly to existing process stdin
   └─> Session context preserved
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
├─────────────────────────────────────────────────────────────────┤
│  React App                                                       │
│    ├── SceneManager (Three.js) - 3D visualization               │
│    ├── AgentBar - agent selection                               │
│    ├── CommandInput - send commands                             │
│    ├── ClaudeOutputPanel - conversation history                 │
│    └── ActivityFeed - real-time events                          │
└────────────────────────┬────────────────────────────────────────┘
                         │ WebSocket + REST API
┌────────────────────────▼────────────────────────────────────────┐
│                         BACKEND                                  │
├─────────────────────────────────────────────────────────────────┤
│  Express Server (:5174)                                          │
│    ├── /api/agents - CRUD for agents                            │
│    ├── /api/files - file browser for working directories        │
│    └── WebSocket - broadcasts events to all clients             │
│                                                                  │
│  Services                                                        │
│    ├── AgentService - manages agent state                       │
│    ├── ClaudeService - orchestrates Claude processes            │
│    └── ClaudeRunner - spawns/manages CLI processes              │
└────────────────────────┬────────────────────────────────────────┘
                         │ stdin/stdout (JSON)
┌────────────────────────▼────────────────────────────────────────┐
│                    CLAUDE CODE CLI                               │
├─────────────────────────────────────────────────────────────────┤
│  Multiple independent processes                                  │
│    ├── Agent 1: claude --output-format stream-json ...          │
│    ├── Agent 2: claude --output-format stream-json ...          │
│    └── Agent N: claude --output-format stream-json ...          │
│                                                                  │
│  Session files: ~/.claude/projects/<encoded-path>/<session>.jsonl│
└─────────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/server/claude/runner.ts` | Spawns Claude CLI processes, handles stdin/stdout |
| `src/server/claude/backend.ts` | Builds CLI args, parses JSON events |
| `src/server/services/claude-service.ts` | High-level agent command orchestration |
| `src/server/services/agent-service.ts` | Agent state management and persistence |
| `src/App.tsx` | Main React app, WebSocket connection |
| `src/scene/SceneManager.ts` | Three.js 3D scene setup |

## Usage

1. Open http://localhost:5173 in your browser
2. Click **+ New Agent** to deploy an agent
3. Choose a name, class, and working directory
4. Select an agent by clicking on it (or press 1-9)
5. Enter commands in the command bar
6. Watch the agent work in real-time via the activity feed
7. Right-click on the battlefield to move selected agents (visual only)

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| 1-9 | Select agent by index |
| Escape | Deselect / Close modal |
| Alt+N | Spawn new agent |
| Enter | Send command (when input focused) |

## Agent Classes

Classes are cosmetic labels to help organize your agents:

| Class | Icon | Suggested Use |
|-------|------|---------------|
| Scout | 🔍 | Codebase exploration, finding files |
| Builder | 🔨 | Feature implementation |
| Debugger | 🐛 | Bug hunting and fixing |
| Architect | 📐 | Planning, design, architecture |
| Warrior | ⚔️ | Refactoring, code cleanup |
| Support | 💚 | Documentation, tests |

## Architecture

```
┌─────────────────────────────────────────┐
│           Browser (Three.js)            │
│  - 3D battlefield visualization         │
│  - Agent selection & movement           │
│  - Command interface                    │
└─────────────────┬───────────────────────┘
                  │ WebSocket
┌─────────────────▼───────────────────────┐
│           Node.js Server                │
│  - Agent lifecycle management           │
│  - Claude CLI process management        │
│  - Event broadcasting                   │
└─────────────────┬───────────────────────┘
                  │ stdin/stdout (stream-json)
┌─────────────────▼───────────────────────┐
│         Claude Code Instances           │
│  - Each agent = Claude CLI process      │
│  - Events streamed via JSON output      │
└─────────────────────────────────────────┘
```

## Development

```bash
# Run client only (Vite dev server on :5173)
npm run dev:client

# Run server only (Express + WebSocket on :5174)
npm run dev:server

# Run both concurrently
npm run dev

# Build for production
npm run build
```

## Troubleshooting

**Agent stuck in "working" status**
- The Claude process may have died unexpectedly
- Refresh the page - status sync runs on reconnect
- Check server logs for errors

**"Claude Code CLI not found"**
- Ensure `claude` is in your PATH
- Run `which claude` to verify installation

**WebSocket disconnects**
- Check that the server is running on port 5174
- Look for CORS or firewall issues

## License

MIT
