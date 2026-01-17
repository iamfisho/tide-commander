import type { Agent, ServerMessage, ClientMessage } from '../../shared/types';
import { store } from '../store';

let ws: WebSocket | null = null;
let connectionPromise: Promise<void> | null = null;
let isConnecting = false;
let onToast: ((type: 'error' | 'success' | 'warning' | 'info', title: string, message: string) => void) | null = null;
let onAgentCreated: ((agent: Agent) => void) | null = null;
let onAgentUpdated: ((agent: Agent, positionChanged: boolean) => void) | null = null;
let onAgentDeleted: ((agentId: string) => void) | null = null;
let onAgentsSync: ((agents: Agent[]) => void) | null = null;
let onSpawnError: (() => void) | null = null;
let onSpawnSuccess: (() => void) | null = null;
let onToolUse: ((agentId: string, toolName: string, toolInput?: Record<string, unknown>) => void) | null = null;
let onDirectoryNotFound: ((path: string) => void) | null = null;

export function setCallbacks(callbacks: {
  onToast?: typeof onToast;
  onAgentCreated?: typeof onAgentCreated;
  onAgentUpdated?: typeof onAgentUpdated;
  onAgentDeleted?: typeof onAgentDeleted;
  onAgentsSync?: typeof onAgentsSync;
  onSpawnError?: typeof onSpawnError;
  onSpawnSuccess?: typeof onSpawnSuccess;
  onToolUse?: typeof onToolUse;
  onDirectoryNotFound?: typeof onDirectoryNotFound;
}): void {
  if (callbacks.onToast) onToast = callbacks.onToast;
  if (callbacks.onAgentCreated) onAgentCreated = callbacks.onAgentCreated;
  if (callbacks.onAgentUpdated) onAgentUpdated = callbacks.onAgentUpdated;
  if (callbacks.onAgentDeleted) onAgentDeleted = callbacks.onAgentDeleted;
  if (callbacks.onAgentsSync) onAgentsSync = callbacks.onAgentsSync;
  if (callbacks.onSpawnError) onSpawnError = callbacks.onSpawnError;
  if (callbacks.onSpawnSuccess) onSpawnSuccess = callbacks.onSpawnSuccess;
  if (callbacks.onToolUse) onToolUse = callbacks.onToolUse;
  if (callbacks.onDirectoryNotFound) onDirectoryNotFound = callbacks.onDirectoryNotFound;
}

export function connect(): void {
  // Prevent duplicate connection attempts
  if (isConnecting || (ws && ws.readyState === WebSocket.CONNECTING)) {
    console.log('[Tide] Connection already in progress, skipping');
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('[Tide] Already connected, skipping');
    return;
  }

  isConnecting = true;
  const wsUrl = `ws://${window.location.hostname}:5174/ws`;
  console.log('[Tide] Connecting to', wsUrl);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[Tide] Connected');
    isConnecting = false;
    store.setConnected(true);
    // Start status polling as fallback for missed WebSocket updates
    store.startStatusPolling();
    onToast?.('success', 'Connected', 'Connected to Tide Commander server');
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as ServerMessage;
      handleServerMessage(message);
    } catch (err) {
      console.error('[Tide] Failed to parse message:', err);
    }
  };

  ws.onclose = () => {
    console.log('[Tide] Disconnected, reconnecting...');
    isConnecting = false;
    ws = null;
    store.setConnected(false);
    store.stopStatusPolling();
    onToast?.('warning', 'Disconnected', 'Connection lost. Reconnecting...');
    setTimeout(connect, 2000);
  };

  ws.onerror = (err) => {
    console.error('[Tide] WebSocket error:', err);
    isConnecting = false;
  };

  // Set up store to use this connection
  store.setSendMessage(sendMessage);
}

function handleServerMessage(message: ServerMessage): void {
  switch (message.type) {
    case 'agents_update': {
      const agentList = message.payload as Agent[];
      console.log(`[Tide] Received ${agentList.length} agents:`, agentList.map(a => ({ name: a.name, sessionId: a.sessionId })));
      store.setAgents(agentList);
      onAgentsSync?.(agentList);
      // Load tool history after agents are synced
      store.loadToolHistory();
      break;
    }

    case 'agent_created': {
      const newAgent = message.payload as Agent;
      store.addAgent(newAgent);
      onAgentCreated?.(newAgent);
      onSpawnSuccess?.();
      onToast?.('success', 'Agent Deployed', `${newAgent.name} is ready for commands`);
      break;
    }

    case 'agent_updated': {
      const updatedAgent = message.payload as Agent;
      const state = store.getState();
      const previousAgent = state.agents.get(updatedAgent.id);

      console.log(`[Tide] Agent updated: ${updatedAgent.id} status=${updatedAgent.status} (was ${previousAgent?.status})`);

      const positionChanged = previousAgent
        ? previousAgent.position.x !== updatedAgent.position.x ||
          previousAgent.position.z !== updatedAgent.position.z
        : false;

      // Preserve client-side pendingCommands (managed separately via queue_update)
      if (previousAgent?.pendingCommands) {
        updatedAgent.pendingCommands = previousAgent.pendingCommands;
      }

      store.updateAgent(updatedAgent);
      onAgentUpdated?.(updatedAgent, positionChanged);
      break;
    }

    case 'agent_deleted': {
      const { id } = message.payload as { id: string };
      store.removeAgent(id);
      onAgentDeleted?.(id);
      break;
    }

    case 'activity': {
      const activity = message.payload as {
        agentId: string;
        agentName: string;
        message: string;
        timestamp: number;
      };
      store.addActivity(activity);
      break;
    }

    case 'event': {
      // Claude event - trigger visual effects and track tools
      const event = message.payload as {
        agentId: string;
        type: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
      };
      if (event.type === 'tool_start' && event.toolName) {
        onToolUse?.(event.agentId, event.toolName, event.toolInput);
        // Track tool execution with input
        store.addToolExecution(event.agentId, event.toolName, event.toolInput);
        // Track file changes from file-related tools
        if (event.toolInput) {
          const filePath = (event.toolInput.file_path || event.toolInput.path) as string | undefined;
          if (filePath) {
            if (event.toolName === 'Write') {
              store.addFileChange(event.agentId, 'created', filePath);
            } else if (event.toolName === 'Edit') {
              store.addFileChange(event.agentId, 'modified', filePath);
            } else if (event.toolName === 'Read') {
              store.addFileChange(event.agentId, 'read', filePath);
            }
          }
        }
      }
      break;
    }

    case 'output': {
      // Streaming output from Claude - goes to dedicated output store
      const output = message.payload as {
        agentId: string;
        text: string;
        isStreaming: boolean;
        timestamp: number;
      };
      store.addOutput(output.agentId, {
        text: output.text,
        isStreaming: output.isStreaming,
        timestamp: output.timestamp,
      });
      break;
    }

    case 'error': {
      const errorPayload = message.payload as { message: string };
      onToast?.('error', 'Error', errorPayload.message);
      onSpawnError?.();
      break;
    }

    case 'directory_not_found': {
      const { path } = message.payload as { path: string };
      onDirectoryNotFound?.(path);
      break;
    }

    case 'queue_update': {
      const { agentId, pendingCommands } = message.payload as {
        agentId: string;
        pendingCommands: string[];
      };
      store.updatePendingCommands(agentId, pendingCommands);
      break;
    }

    case 'command_started': {
      const { agentId, command } = message.payload as {
        agentId: string;
        command: string;
      };
      // Add user prompt to output when command actually starts executing
      store.addUserPromptToOutput(agentId, command);
      break;
    }

    case 'supervisor_report': {
      const report = message.payload as import('../../shared/types').SupervisorReport;
      store.setSupervisorReport(report);
      break;
    }

    case 'narrative_update': {
      const { agentId, narrative } = message.payload as {
        agentId: string;
        narrative: import('../../shared/types').ActivityNarrative;
      };
      store.addNarrative(agentId, narrative);
      break;
    }

    case 'supervisor_status': {
      const status = message.payload as {
        enabled: boolean;
        lastReportTime: number | null;
        nextReportTime: number | null;
      };
      store.setSupervisorStatus(status);
      break;
    }

    case 'agent_supervisor_history': {
      const history = message.payload as import('../../shared/types').AgentSupervisorHistory;
      store.setAgentSupervisorHistory(history);
      break;
    }

    case 'agent_analysis': {
      const { agentId, analysis } = message.payload as {
        agentId: string;
        analysis: import('../../shared/types').AgentAnalysis;
      };
      store.addAgentAnalysis(agentId, analysis);
      break;
    }

    case 'areas_update': {
      const areasArray = message.payload as import('../../shared/types').DrawingArea[];
      store.setAreasFromServer(areasArray);
      break;
    }
  }
}

export function sendMessage(message: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function getSocket(): WebSocket | null {
  return ws;
}
