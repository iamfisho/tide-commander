// Agent Classes
export type AgentClass = 'scout' | 'builder' | 'debugger' | 'architect' | 'warrior' | 'support';

export const AGENT_CLASSES: Record<AgentClass, { icon: string; color: string; description: string }> = {
  scout: { icon: '🔍', color: '#4a9eff', description: 'Codebase exploration, file discovery' },
  builder: { icon: '🔨', color: '#ff9e4a', description: 'Feature implementation, writing code' },
  debugger: { icon: '🐛', color: '#ff4a4a', description: 'Bug hunting, fixing issues' },
  architect: { icon: '📐', color: '#9e4aff', description: 'Planning, design decisions' },
  warrior: { icon: '⚔️', color: '#ff4a9e', description: 'Aggressive refactoring, migrations' },
  support: { icon: '💚', color: '#4aff9e', description: 'Documentation, tests, cleanup' },
};

// Agent Status
export type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'offline';

// Agent State
export interface Agent {
  id: string;
  name: string;
  class: AgentClass;
  status: AgentStatus;

  // Position on battlefield (3D coordinates)
  position: { x: number; y: number; z: number };

  // Claude Code session
  sessionId?: string;
  tmuxSession: string;
  cwd: string;
  useChrome?: boolean; // Start with --chrome flag

  // Resources
  tokensUsed: number;
  contextUsed: number;      // Current context window usage
  contextLimit: number;     // Model's context limit (default 200k)

  // Current task
  currentTask?: string;
  currentTool?: string;

  // Last assigned task - the original user prompt/task (persists even when idle)
  lastAssignedTask?: string;
  lastAssignedTaskTime?: number;

  // Task counter - number of user messages/commands sent to this agent
  taskCount: number;

  // Command queue - commands sent while agent is busy
  pendingCommands: string[];

  // Timestamps
  createdAt: number;
  lastActivity: number;
}

// Drawing tool types
export type DrawingTool = 'rectangle' | 'circle' | 'select' | null;

// Drawing area on the battlefield
export interface DrawingArea {
  id: string;
  name: string;
  type: 'rectangle' | 'circle';
  center: { x: number; z: number };
  width?: number;   // rectangle only
  height?: number;  // rectangle only
  radius?: number;  // circle only
  color: string;    // hex color
  assignedAgentIds: string[];
  directories: string[];  // Associated directory paths
}

// Claude Code Tools
export type ToolName =
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Bash'
  | 'Grep'
  | 'Glob'
  | 'WebFetch'
  | 'WebSearch'
  | 'Task'
  | 'TodoWrite'
  | 'AskUserQuestion'
  | 'NotebookEdit';

// Events from Claude Code hooks
export interface BaseEvent {
  id: string;
  timestamp: number;
  sessionId: string;
}

export interface PreToolUseEvent extends BaseEvent {
  type: 'pre_tool_use';
  tool: ToolName;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export interface PostToolUseEvent extends BaseEvent {
  type: 'post_tool_use';
  tool: ToolName;
  toolUseId: string;
  duration?: number;
}

export interface StopEvent extends BaseEvent {
  type: 'stop';
}

export interface UserPromptEvent extends BaseEvent {
  type: 'user_prompt';
  prompt: string;
}

export type ClaudeEvent = PreToolUseEvent | PostToolUseEvent | StopEvent | UserPromptEvent;

// WebSocket Messages
export interface WSMessage {
  type: string;
  payload?: unknown;
}

// Server -> Client messages
export interface AgentsUpdateMessage extends WSMessage {
  type: 'agents_update';
  payload: Agent[];
}

export interface AgentCreatedMessage extends WSMessage {
  type: 'agent_created';
  payload: Agent;
}

export interface AgentUpdatedMessage extends WSMessage {
  type: 'agent_updated';
  payload: Agent;
}

export interface AgentDeletedMessage extends WSMessage {
  type: 'agent_deleted';
  payload: { id: string };
}

export interface EventMessage extends WSMessage {
  type: 'event';
  payload: ClaudeEvent & { agentId: string };
}

export interface ActivityMessage extends WSMessage {
  type: 'activity';
  payload: {
    agentId: string;
    agentName: string;
    message: string;
    timestamp: number;
  };
}

// Streaming output from Claude
export interface OutputMessage extends WSMessage {
  type: 'output';
  payload: {
    agentId: string;
    text: string;
    isStreaming: boolean;
    timestamp: number;
  };
}

// Client -> Server messages
export interface SpawnAgentMessage extends WSMessage {
  type: 'spawn_agent';
  payload: {
    name: string;
    class: AgentClass;
    cwd: string;
    position?: { x: number; y: number; z: number };
    sessionId?: string;
    useChrome?: boolean;
  };
}

export interface SendCommandMessage extends WSMessage {
  type: 'send_command';
  payload: {
    agentId: string;
    command: string;
  };
}

export interface MoveAgentMessage extends WSMessage {
  type: 'move_agent';
  payload: {
    agentId: string;
    position: { x: number; y: number; z: number };
  };
}

export interface KillAgentMessage extends WSMessage {
  type: 'kill_agent';
  payload: {
    agentId: string;
  };
}

// Stop current operation (but keep agent alive)
export interface StopAgentMessage extends WSMessage {
  type: 'stop_agent';
  payload: {
    agentId: string;
  };
}

export interface CreateDirectoryMessage extends WSMessage {
  type: 'create_directory';
  payload: {
    path: string;
    name: string;
    class: AgentClass;
  };
}

// Remove agent from UI and persistence (keeps Claude session running)
export interface RemoveAgentMessage extends WSMessage {
  type: 'remove_agent';
  payload: {
    agentId: string;
  };
}

// Rename agent
export interface RenameAgentMessage extends WSMessage {
  type: 'rename_agent';
  payload: {
    agentId: string;
    name: string;
  };
}

export interface ErrorMessage extends WSMessage {
  type: 'error';
  payload: { message: string };
}

// Queue update message - sent when pending commands change
export interface QueueUpdateMessage extends WSMessage {
  type: 'queue_update';
  payload: {
    agentId: string;
    pendingCommands: string[];
  };
}

// Command started message - sent when a command begins execution
export interface CommandStartedMessage extends WSMessage {
  type: 'command_started';
  payload: {
    agentId: string;
    command: string;
  };
}

// Directory not found error - prompts user to create directory
export interface DirectoryNotFoundMessage extends WSMessage {
  type: 'directory_not_found';
  payload: {
    path: string;
    name: string;
    class: AgentClass;
  };
}

// ============================================================================
// Areas Types
// ============================================================================

// Areas sync message (Server -> Client) - sent on connect and when areas change
export interface AreasUpdateMessage extends WSMessage {
  type: 'areas_update';
  payload: DrawingArea[];
}

// Sync areas message (Client -> Server) - sent when client modifies areas
export interface SyncAreasMessage extends WSMessage {
  type: 'sync_areas';
  payload: DrawingArea[];
}

// ============================================================================
// Supervisor Types
// ============================================================================

// Activity narrative - human-readable description of agent work
export interface ActivityNarrative {
  id: string;
  agentId: string;
  timestamp: number;
  type: 'tool_use' | 'task_start' | 'task_complete' | 'error' | 'thinking' | 'output';
  narrative: string;
  toolName?: string;
}

// Agent status summary for supervisor
export interface AgentStatusSummary {
  id: string;
  name: string;
  class: AgentClass;
  status: AgentStatus;
  currentTask?: string;
  lastAssignedTask?: string;
  lastAssignedTaskTime?: number;
  recentNarratives: ActivityNarrative[];
  tokensUsed: number;
  contextUsed: number;
  lastActivityTime: number;
}

// Agent analysis from Claude
export interface AgentAnalysis {
  agentId: string;
  agentName: string;
  statusDescription: string;
  progress: 'on_track' | 'stalled' | 'blocked' | 'completed' | 'idle';
  recentWorkSummary: string;
  concerns?: string[];
}

// Supervisor report from Claude
export interface SupervisorReport {
  id: string;
  timestamp: number;
  agentSummaries: AgentAnalysis[];
  overallStatus: 'healthy' | 'attention_needed' | 'critical';
  insights: string[];
  recommendations: string[];
  rawResponse?: string;
}

// Supervisor configuration
export interface SupervisorConfig {
  enabled: boolean;
  intervalMs: number;
  maxNarrativesPerAgent: number;
  customPrompt?: string;
}

// Agent supervisor history entry - a snapshot of supervisor's analysis for a specific agent
export interface AgentSupervisorHistoryEntry {
  id: string;
  timestamp: number;
  reportId: string;  // ID of the full SupervisorReport this came from
  analysis: AgentAnalysis;
}

// Agent supervisor history - all supervisor analyses for a specific agent
export interface AgentSupervisorHistory {
  agentId: string;
  entries: AgentSupervisorHistoryEntry[];
}

// Supervisor WebSocket messages (Server -> Client)
export interface SupervisorReportMessage extends WSMessage {
  type: 'supervisor_report';
  payload: SupervisorReport;
}

export interface SupervisorStatusMessage extends WSMessage {
  type: 'supervisor_status';
  payload: {
    enabled: boolean;
    lastReportTime: number | null;
    nextReportTime: number | null;
  };
}

export interface NarrativeUpdateMessage extends WSMessage {
  type: 'narrative_update';
  payload: {
    agentId: string;
    narrative: ActivityNarrative;
  };
}

export interface AgentSupervisorHistoryMessage extends WSMessage {
  type: 'agent_supervisor_history';
  payload: AgentSupervisorHistory;
}

// Supervisor WebSocket messages (Client -> Server)
export interface SetSupervisorConfigMessage extends WSMessage {
  type: 'set_supervisor_config';
  payload: Partial<SupervisorConfig>;
}

export interface RequestSupervisorReportMessage extends WSMessage {
  type: 'request_supervisor_report';
  payload: Record<string, never>;
}

export interface RequestAgentSupervisorHistoryMessage extends WSMessage {
  type: 'request_agent_supervisor_history';
  payload: {
    agentId: string;
  };
}

export type ServerMessage =
  | AgentsUpdateMessage
  | AgentCreatedMessage
  | AgentUpdatedMessage
  | AgentDeletedMessage
  | EventMessage
  | ActivityMessage
  | OutputMessage
  | ErrorMessage
  | DirectoryNotFoundMessage
  | QueueUpdateMessage
  | CommandStartedMessage
  | SupervisorReportMessage
  | SupervisorStatusMessage
  | NarrativeUpdateMessage
  | AgentSupervisorHistoryMessage
  | AreasUpdateMessage;

export type ClientMessage =
  | SpawnAgentMessage
  | SendCommandMessage
  | MoveAgentMessage
  | KillAgentMessage
  | StopAgentMessage
  | CreateDirectoryMessage
  | RemoveAgentMessage
  | RenameAgentMessage
  | SetSupervisorConfigMessage
  | RequestSupervisorReportMessage
  | RequestAgentSupervisorHistoryMessage
  | SyncAreasMessage;
