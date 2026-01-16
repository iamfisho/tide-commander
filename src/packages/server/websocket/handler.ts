/**
 * WebSocket Handler
 * Real-time communication with clients
 */

import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as fs from 'fs';
import type { Agent, ClientMessage, ServerMessage, DrawingArea } from '../../shared/types.js';
import { agentService, claudeService, supervisorService } from '../services/index.js';
import { loadAreas, saveAreas } from '../data/index.js';

// Connected clients
const clients = new Set<WebSocket>();

// ============================================================================
// Broadcasting
// ============================================================================

export function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function sendActivity(agentId: string, message: string): void {
  const agent = agentService.getAgent(agentId);
  broadcast({
    type: 'activity',
    payload: {
      agentId,
      agentName: agent?.name || 'Unknown',
      message,
      timestamp: Date.now(),
    },
  });
}

// ============================================================================
// Message Handling
// ============================================================================

function handleClientMessage(ws: WebSocket, message: ClientMessage): void {
  console.log(`[WebSocket] Received: ${message.type}`);

  switch (message.type) {
    case 'spawn_agent':
      agentService
        .createAgent(
          message.payload.name,
          message.payload.class,
          message.payload.cwd,
          message.payload.position,
          message.payload.sessionId,
          message.payload.useChrome
        )
        .then((agent) => {
          broadcast({
            type: 'agent_created',
            payload: agent,
          });
          sendActivity(agent.id, `${agent.name} deployed`);
        })
        .catch((err) => {
          console.error('[WebSocket] Failed to spawn agent:', err);
          // Check if this is a directory not found error
          if (err.message?.includes('Directory does not exist')) {
            ws.send(
              JSON.stringify({
                type: 'directory_not_found',
                payload: {
                  path: message.payload.cwd,
                  name: message.payload.name,
                  class: message.payload.class,
                },
              })
            );
          } else {
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { message: err.message },
              })
            );
          }
        });
      break;

    case 'send_command':
      claudeService
        .sendCommand(message.payload.agentId, message.payload.command)
        .catch((err) => {
          console.error('[WebSocket] Failed to send command:', err);
          sendActivity(message.payload.agentId, `Error: ${err.message}`);
        });
      break;

    case 'move_agent':
      // Don't update lastActivity for position changes (false = don't update activity timer)
      agentService.updateAgent(message.payload.agentId, {
        position: message.payload.position,
      }, false);
      break;

    case 'kill_agent':
      claudeService.stopAgent(message.payload.agentId).then(() => {
        agentService.deleteAgent(message.payload.agentId);
      });
      break;

    case 'stop_agent':
      // Stop current operation but keep agent alive
      claudeService.stopAgent(message.payload.agentId).then(() => {
        agentService.updateAgent(message.payload.agentId, {
          status: 'idle',
          currentTask: undefined,
          currentTool: undefined,
        });
        sendActivity(message.payload.agentId, 'Operation cancelled');
      });
      break;

    case 'remove_agent':
      // Remove from persistence only (keeps Claude session running)
      agentService.deleteAgent(message.payload.agentId);
      break;

    case 'rename_agent':
      // Don't update lastActivity for name changes
      agentService.updateAgent(message.payload.agentId, {
        name: message.payload.name,
      }, false);
      break;

    case 'create_directory':
      try {
        // Create directory recursively
        fs.mkdirSync(message.payload.path, { recursive: true });
        console.log(`[WebSocket] Created directory: ${message.payload.path}`);

        // Now spawn the agent
        agentService
          .createAgent(
            message.payload.name,
            message.payload.class,
            message.payload.path
          )
          .then((agent) => {
            broadcast({
              type: 'agent_created',
              payload: agent,
            });
            sendActivity(agent.id, `${agent.name} deployed`);
          })
          .catch((err) => {
            console.error('[WebSocket] Failed to spawn agent after creating directory:', err);
            ws.send(
              JSON.stringify({
                type: 'error',
                payload: { message: err.message },
              })
            );
          });
      } catch (err: any) {
        console.error('[WebSocket] Failed to create directory:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: { message: `Failed to create directory: ${err.message}` },
          })
        );
      }
      break;

    case 'set_supervisor_config':
      supervisorService.setConfig(message.payload);
      break;

    case 'request_supervisor_report':
      console.log('[Supervisor] Report requested by frontend');
      supervisorService
        .generateReport()
        .then((report) => {
          ws.send(
            JSON.stringify({
              type: 'supervisor_report',
              payload: report,
            })
          );
        })
        .catch((err) => {
          console.error('[WebSocket] Supervisor report failed:', err);
          ws.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Supervisor report failed: ${err.message}` },
            })
          );
        });
      break;

    case 'request_agent_supervisor_history':
      {
        const history = supervisorService.getAgentSupervisorHistory(message.payload.agentId);
        ws.send(
          JSON.stringify({
            type: 'agent_supervisor_history',
            payload: history,
          })
        );
      }
      break;

    case 'sync_areas':
      // Save areas to persistent storage and broadcast to all clients
      saveAreas(message.payload);
      console.log(`[WebSocket] Saved ${message.payload.length} areas`);
      // Broadcast to all other clients
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'areas_update',
            payload: message.payload,
          }));
        }
      }
      break;
  }
}

// ============================================================================
// Tool Details Formatting
// ============================================================================

function formatToolDetails(
  toolName?: string,
  toolInput?: Record<string, unknown>
): string {
  if (!toolName) return 'Using unknown tool';

  // Get the key parameter for this tool type
  const param = toolInput ? getKeyParam(toolName, toolInput) : null;

  if (param) {
    return `${toolName}: ${param}`;
  }
  return `Using ${toolName}`;
}

function getKeyParam(
  toolName: string,
  input: Record<string, unknown>
): string | null {
  switch (toolName) {
    case 'WebSearch':
      return truncate(input.query as string, 50);
    case 'WebFetch':
      return truncate(input.url as string, 60);
    case 'Read':
    case 'Write':
    case 'Edit':
      const filePath = (input.file_path || input.path) as string;
      if (!filePath) return null;
      // Show just the filename for long paths
      if (filePath.length > 40) {
        const parts = filePath.split('/');
        return '.../' + parts.slice(-2).join('/');
      }
      return filePath;
    case 'Bash':
      const cmd = input.command as string;
      return cmd ? truncate(cmd, 60) : null;
    case 'Grep':
      return input.pattern ? `"${truncate(input.pattern as string, 40)}"` : null;
    case 'Glob':
      return truncate(input.pattern as string, 50);
    case 'Task':
      return truncate(input.description as string, 50);
    case 'TodoWrite':
      const todos = input.todos as unknown[];
      if (todos?.length) {
        return `${todos.length} item${todos.length > 1 ? 's' : ''}`;
      }
      return null;
    default:
      // Try to find any meaningful string parameter
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string' && value.length > 0 && value.length < 100) {
          return truncate(value, 50);
        }
      }
      return null;
  }
}

function truncate(str: string | undefined | null, maxLen: number): string | null {
  if (!str) return null;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// ============================================================================
// Service Event Handlers
// ============================================================================

function setupServiceListeners(): void {
  // Agent events
  agentService.subscribe((event, data) => {
    switch (event) {
      case 'created':
        // Already handled in handleClientMessage
        break;
      case 'updated':
        const updatedAgent = data as Agent;
        console.log(`[WebSocket] Broadcasting agent_updated: ${updatedAgent.id} name=${updatedAgent.name} status=${updatedAgent.status}, contextUsed=${updatedAgent.contextUsed}, tokensUsed=${updatedAgent.tokensUsed}, clients=${clients.size}`);
        broadcast({
          type: 'agent_updated',
          payload: updatedAgent,
        });
        break;
      case 'deleted':
        broadcast({
          type: 'agent_deleted',
          payload: { id: data as string },
        });
        sendActivity(data as string, 'Agent terminated');
        break;
    }
  });

  // Claude events
  claudeService.on('event', (agentId, event) => {
    // Send activity for important events
    if (event.type === 'init') {
      sendActivity(agentId, `Session initialized (${event.model})`);
    } else if (event.type === 'tool_start') {
      const details = formatToolDetails(event.toolName, event.toolInput);
      sendActivity(agentId, details);
    } else if (event.type === 'error') {
      sendActivity(agentId, `Error: ${event.errorMessage}`);
    }

    // Broadcast raw event
    broadcast({
      type: 'event',
      payload: { ...event, agentId } as any,
    });
  });

  claudeService.on('output', (agentId, text, isStreaming) => {
    broadcast({
      type: 'output' as any,
      payload: {
        agentId,
        text,
        isStreaming: isStreaming || false,
        timestamp: Date.now(),
      },
    });
  });

  claudeService.on('complete', (agentId, success) => {
    sendActivity(agentId, success ? 'Task completed' : 'Task failed');
  });

  claudeService.on('error', (agentId, error) => {
    sendActivity(agentId, `Error: ${error}`);
  });

  // Set up queue update callback
  claudeService.setQueueUpdateCallback((agentId, pendingCommands) => {
    broadcast({
      type: 'queue_update',
      payload: { agentId, pendingCommands },
    });
  });

  // Set up command started callback
  claudeService.setCommandStartedCallback((agentId, command) => {
    broadcast({
      type: 'command_started',
      payload: { agentId, command },
    });
  });

  // Supervisor events
  supervisorService.subscribe((event, data) => {
    switch (event) {
      case 'report':
        broadcast({
          type: 'supervisor_report',
          payload: data,
        } as ServerMessage);
        break;
      case 'narrative':
        broadcast({
          type: 'narrative_update',
          payload: data,
        } as ServerMessage);
        break;
      case 'config_changed':
        broadcast({
          type: 'supervisor_status',
          payload: supervisorService.getStatus(),
        } as ServerMessage);
        break;
    }
  });
}

// ============================================================================
// Initialization
// ============================================================================

export function init(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws) => {
    console.log('[WebSocket] Client connected');
    clients.add(ws);

    // Sync agent status with actual process state before sending to client
    // This only corrects 'working' -> 'idle' if the process is dead
    await claudeService.syncAllAgentStatus();

    // Send current state
    const agents = agentService.getAllAgents();
    console.log(`[WebSocket] Sending initial agents_update with ${agents.length} agents:`);
    for (const agent of agents) {
      console.log(`  - ${agent.name}: status=${agent.status}`);
    }

    ws.send(
      JSON.stringify({
        type: 'agents_update',
        payload: agents,
      })
    );

    // Send current areas
    const areas = loadAreas();
    console.log(`[WebSocket] Sending initial areas_update with ${areas.length} areas`);
    ws.send(
      JSON.stringify({
        type: 'areas_update',
        payload: areas,
      })
    );

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        handleClientMessage(ws, message);
      } catch (err) {
        console.error('[WebSocket] Invalid message:', err);
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected');
      clients.delete(ws);
    });
  });

  // Set up service event listeners
  setupServiceListeners();

  console.log('[WebSocket] Handler initialized');
  return wss;
}
