# Tide Commander - RTS/MOBA Claude Code Agents Commander

## Vision
A strategic command interface where Claude Code agents are represented as characters/units on a battlefield-style map. Users can deploy, position, and command multiple agents with an RTS/MOBA aesthetic - think StarCraft meets AI orchestration.

---

## Core Concepts

### 1. The Battlefield
- 2D isometric or top-down grid map
- Multiple "zones" representing different project areas/tasks
- Fog of war aesthetic for unexecuted areas
- Terrain types that could represent different task domains

### 2. Units (Agents)
Each Claude Code instance is represented as a character with:
- **Visual Avatar**: Unique character sprite with class identity
- **Health/Energy Bar**: Token usage / context window
- **Status Indicators**: Idle, Working, Waiting, Error
- **Position on Map**: Can be moved to different "zones"
- **Selection Ring**: When selected for commanding

### 3. Agent Classes (Specializations)
Different "classes" that pre-configure agents for specific tasks:

| Class | Icon | Specialty | System Prompt Focus |
|-------|------|-----------|---------------------|
| **Scout** | 🔍 | Codebase exploration, file discovery | Read, Grep, Glob heavy |
| **Builder** | 🔨 | Feature implementation, writing code | Write, Edit focused |
| **Debugger** | 🐛 | Bug hunting, fixing issues | Bash, Read, diagnostic |
| **Architect** | 📐 | Planning, design decisions | Task (Plan agent) |
| **Warrior** | ⚔️ | Aggressive refactoring, migrations | Edit, Write, Bash |
| **Support** | 💚 | Documentation, tests, cleanup | Write, TodoWrite |

### 4. Command Interface
- **Command Bar**: Text input to give orders (prompts) to selected unit(s)
- **Ability Buttons**: Quick actions (Run tests, Git status, etc.)
- **Group Selection**: Select multiple units for batch commands
- **Rally Points**: Set default spawn location for new units

---

## Technical Architecture

### Stack
```
Frontend:         Phaser.js or PixiJS (2D game engine)
                  + React/Preact for UI panels
                  + TypeScript

Backend:          Node.js + WebSocket server
                  + tmux session management

Integration:      Claude Code CLI via stdin/stdout
                  + Hook system for event capture

Styling:          Tailwind CSS + custom pixel art theme
```

### Directory Structure
```
tide-commander/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
│
├── src/
│   ├── main.ts                 # Entry point
│   ├── game/                   # Game engine layer
│   │   ├── Game.ts             # Main game class
│   │   ├── scenes/
│   │   │   ├── BattlefieldScene.ts
│   │   │   └── LoadingScene.ts
│   │   ├── entities/
│   │   │   ├── Agent.ts        # Agent unit class
│   │   │   ├── AgentSprite.ts  # Visual representation
│   │   │   └── Zone.ts         # Map zones
│   │   ├── systems/
│   │   │   ├── SelectionSystem.ts
│   │   │   ├── MovementSystem.ts
│   │   │   └── CommandSystem.ts
│   │   └── ui/
│   │       ├── CommandBar.ts
│   │       ├── UnitPanel.ts
│   │       └── Minimap.ts
│   │
│   ├── core/                   # Claude Code integration
│   │   ├── AgentManager.ts     # Manages all agent instances
│   │   ├── ClaudeProcess.ts    # Spawns/manages CLI processes
│   │   ├── EventBridge.ts      # Translates Claude events to game events
│   │   └── SessionStore.ts     # Persists agent sessions
│   │
│   ├── server/                 # Backend
│   │   ├── index.ts            # WebSocket + HTTP server
│   │   ├── TmuxManager.ts      # tmux session handling
│   │   └── HookHandler.ts      # Claude Code hook processing
│   │
│   ├── shared/                 # Shared types
│   │   ├── types.ts
│   │   ├── events.ts
│   │   └── constants.ts
│   │
│   └── assets/                 # Game assets
│       ├── sprites/
│       ├── sounds/
│       └── maps/
│
├── hooks/                      # Claude Code hooks
│   ├── tide-hook.sh
│   └── install.sh
│
└── public/
    └── assets/
```

---

## Implementation Phases

### Phase 1: Foundation (Core Infrastructure)
1. **Project Setup**
   - Initialize npm project with TypeScript, Vite
   - Configure build pipeline
   - Set up development server with hot reload

2. **Backend Server**
   - WebSocket server for real-time communication
   - HTTP endpoints for agent management
   - tmux integration for process management

3. **Claude Code Integration**
   - Process spawner (adapt from obsidian plugin pattern)
   - Event parsing and normalization
   - Session management

4. **Hook System**
   - Install script for Claude Code hooks
   - Event capture and forwarding to server

### Phase 2: Game Engine Layer
1. **Scene Setup**
   - Initialize Phaser.js/PixiJS
   - Create battlefield scene with grid
   - Implement camera controls (pan, zoom)

2. **Agent Entities**
   - Agent sprite class with animations
   - Status indicators (health bar style)
   - Selection system (click, drag-select, hotkeys)

3. **Map/Zones**
   - Grid-based zone system
   - Zone types and visual representation
   - Pathfinding for agent movement

### Phase 3: Command Interface
1. **Command Bar**
   - Text input with autocomplete
   - Command history (up/down arrows)
   - Multi-agent targeting

2. **Unit Panel**
   - Selected unit(s) info display
   - Status, current task, token usage
   - Quick action buttons

3. **Activity Feed**
   - Real-time event log
   - Filter by agent/event type
   - Clickable to focus on agent

### Phase 4: RTS Features
1. **Agent Classes**
   - Class selection on spawn
   - Class-specific abilities/shortcuts
   - Visual differentiation

2. **Group Management**
   - Control groups (Ctrl+1-9 to assign, 1-9 to select)
   - Group commands
   - Formation positioning

3. **Resource System**
   - Token tracking per agent and global
   - Cost estimation for operations
   - "Supply" limit (max concurrent agents)

### Phase 5: Polish & UX
1. **Visual Effects**
   - Agent animations (idle, working, moving)
   - Particle effects for events
   - Screen shake for errors

2. **Sound Design**
   - Unit acknowledgment sounds
   - Event notification sounds
   - Ambient battlefield sounds

3. **Minimap**
   - Overview of all agents
   - Click to navigate
   - Activity indicators

---

## Key Features Detail

### Agent Lifecycle
```
[Spawn] → [Idle] ←→ [Working] → [Waiting] → [Idle]
                         ↓
                      [Error]
```

### Event Flow
```
User Command → WebSocket → Server → Claude Process (tmux)
                                          ↓
                                    Claude Code CLI
                                          ↓
                                    Hook Events
                                          ↓
                               Hook Script → Server
                                          ↓
                               WebSocket → Game Client
                                          ↓
                               Update Agent State & UI
```

### Selection & Commands
- **Left Click**: Select single agent
- **Shift+Click**: Add to selection
- **Drag Box**: Select multiple agents
- **Right Click on Zone**: Move selected agents
- **Enter**: Focus command bar
- **Ctrl+1-9**: Assign control group
- **1-9**: Recall control group

### Agent Context Menu (Right Click on Agent)
- View Terminal Output
- Send to Zone...
- Change Class
- Restart Agent
- Kill Agent

---

## Data Models

### Agent State
```typescript
interface Agent {
  id: string;
  name: string;
  class: AgentClass;
  status: 'idle' | 'working' | 'waiting' | 'error' | 'offline';

  // Position on map
  position: { x: number; y: number };
  zone?: string;

  // Claude Code session
  sessionId?: string;
  tmuxSession: string;
  cwd: string;

  // Resources
  tokensUsed: number;
  contextWindowUsed: number;

  // Current task
  currentTask?: string;
  currentTool?: string;

  // Timestamps
  createdAt: number;
  lastActivity: number;
}
```

### Zone
```typescript
interface Zone {
  id: string;
  name: string;
  type: 'project' | 'task' | 'research' | 'deploy';
  bounds: { x: number; y: number; width: number; height: number };
  color: string;
  cwd?: string;  // Working directory for agents in this zone
}
```

### Game Event
```typescript
interface GameEvent {
  type: 'agent_spawn' | 'agent_move' | 'agent_status' |
        'tool_use' | 'task_complete' | 'error';
  agentId: string;
  timestamp: number;
  data: Record<string, unknown>;
}
```

---

## UI Layout
```
┌─────────────────────────────────────────────────────────────────┐
│  [Tide Commander]                      [Tokens: 50K] [Agents: 3] │
├─────────────────────────────────────────┬───────────────────────┤
│                                         │  ┌─ Unit Panel ─────┐ │
│                                         │  │ Scout-1 [🔍]     │ │
│           B A T T L E F I E L D         │  │ Status: Working  │ │
│                                         │  │ Task: Exploring  │ │
│    [Zone: Backend]    [Zone: Frontend]  │  │ Tokens: 12,340   │ │
│       🔍                    🔨          │  │                  │ │
│      Scout-1              Builder-1     │  │ [Stop] [Restart] │ │
│                                         │  └──────────────────┘ │
│              [Zone: Tests]              │                       │
│                  🐛                     │  ┌─ Activity Feed ──┐ │
│               Debugger-1                │  │ 14:32 Scout: Read│ │
│                                         │  │ 14:33 Builder:   │ │
│                                         │  │       Edit file  │ │
│    ┌──────────┐                         │  │ 14:34 Debugger:  │ │
│    │ Minimap  │                         │  │       Bash test  │ │
│    └──────────┘                         │  └──────────────────┘ │
├─────────────────────────────────────────┴───────────────────────┤
│  [>] Enter command for selected unit(s)...           [Classes ▼]│
│  ────────────────────────────────────────────────────           │
│  [Run Tests] [Git Status] [Build] [Deploy]      [+ New Agent]   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Inspiration Sources

### From agent-commander (Vibecraft)
- tmux session management pattern
- Hook system for event capture
- WebSocket real-time communication
- Multi-session tracking architecture
- Git status integration
- Token tracking per session

### From obsidian-claude-code-plugin
- Process spawning with proper environment
- Streaming JSON protocol handling
- Backend abstraction pattern
- Session persistence with file system
- UTF-8 safe streaming
- Platform-aware shell integration

### RTS/MOBA Inspirations
- StarCraft: Control groups, minimap, unit selection
- Age of Empires: Worker management, resource tracking
- League of Legends: Character classes, ability cooldowns
- Factorio: Automation, parallel workers, efficiency

---

## Future Enhancements (Post-MVP)
- **Fog of War**: Unexplored areas of codebase
- **Agent Leveling**: Agents get "better" at certain tasks
- **Achievements**: Unlock new agent classes
- **Replay System**: Watch past sessions
- **Team Composition**: Recommended agent setups
- **Auto-Deploy**: Automatic agent spawning based on task type
- **Agent Communication**: Agents can "talk" to each other
- **Battle Mode**: Race conditions, resource competition
