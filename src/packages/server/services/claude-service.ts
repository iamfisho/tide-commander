/**
 * Claude Service
 * Manages Claude Code runner and command execution
 */

import { ClaudeRunner, StandardEvent } from '../claude/index.js';
import { getSessionActivityStatus } from '../claude/session-loader.js';
import * as agentService from './agent-service.js';
import * as supervisorService from './supervisor-service.js';
import { logger } from '../utils/logger.js';

const log = logger.claude;

// Event types emitted by Claude service
export interface ClaudeServiceEvents {
  event: (agentId: string, event: StandardEvent) => void;
  output: (agentId: string, text: string, isStreaming?: boolean) => void;
  complete: (agentId: string, success: boolean) => void;
  error: (agentId: string, error: string) => void;
}

// Event listeners
type EventListener<K extends keyof ClaudeServiceEvents> = ClaudeServiceEvents[K];
const eventListeners = new Map<keyof ClaudeServiceEvents, Set<EventListener<any>>>();

// Claude Runner instance
let runner: ClaudeRunner | null = null;

// Command queue per agent
const commandQueues = new Map<string, string[]>();

// Queue update callback (set by websocket handler)
let queueUpdateCallback: ((agentId: string, pendingCommands: string[]) => void) | null = null;

// Command started callback (set by websocket handler)
let commandStartedCallback: ((agentId: string, command: string) => void) | null = null;

export function setQueueUpdateCallback(callback: (agentId: string, pendingCommands: string[]) => void): void {
  queueUpdateCallback = callback;
}

export function setCommandStartedCallback(callback: (agentId: string, command: string) => void): void {
  commandStartedCallback = callback;
}

function notifyQueueUpdate(agentId: string): void {
  const queue = commandQueues.get(agentId) || [];
  if (queueUpdateCallback) {
    queueUpdateCallback(agentId, queue);
  }
}

function notifyCommandStarted(agentId: string, command: string): void {
  if (commandStartedCallback) {
    commandStartedCallback(agentId, command);
  }
}

// ============================================================================
// Initialization
// ============================================================================

// Interval for periodic status sync (30 seconds)
const STATUS_SYNC_INTERVAL = 30000;
let statusSyncTimer: NodeJS.Timeout | null = null;

export function init(): void {
  runner = new ClaudeRunner({
    onEvent: handleEvent,
    onOutput: handleOutput,
    onSessionId: handleSessionId,
    onComplete: handleComplete,
    onError: handleError,
  });

  // Start periodic status sync to catch processes that die unexpectedly
  if (statusSyncTimer) {
    clearInterval(statusSyncTimer);
  }
  statusSyncTimer = setInterval(() => {
    syncAllAgentStatus();
  }, STATUS_SYNC_INTERVAL);

  log.log(' Initialized with periodic status sync');
}

export async function shutdown(): Promise<void> {
  if (statusSyncTimer) {
    clearInterval(statusSyncTimer);
    statusSyncTimer = null;
  }
  if (runner) {
    await runner.stopAll();
  }
}

// ============================================================================
// Event System
// ============================================================================

export function on<K extends keyof ClaudeServiceEvents>(
  event: K,
  listener: ClaudeServiceEvents[K]
): void {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(listener);
}

export function off<K extends keyof ClaudeServiceEvents>(
  event: K,
  listener: ClaudeServiceEvents[K]
): void {
  eventListeners.get(event)?.delete(listener);
}

function emit<K extends keyof ClaudeServiceEvents>(
  event: K,
  ...args: Parameters<ClaudeServiceEvents[K]>
): void {
  const listeners = eventListeners.get(event);
  if (listeners) {
    listeners.forEach((listener) => (listener as Function)(...args));
  }
}

// ============================================================================
// Runner Callbacks
// ============================================================================

function handleEvent(agentId: string, event: StandardEvent): void {
  const agent = agentService.getAgent(agentId);
  if (!agent) {
    log.log(` handleEvent: agent ${agentId} not found, ignoring event ${event.type}`);
    return;
  }

  log.log(` handleEvent: agent=${agentId}, event.type=${event.type}, current status=${agent.status}`);

  switch (event.type) {
    case 'init':
      agentService.updateAgent(agentId, { status: 'working' });
      break;

    case 'tool_start':
      agentService.updateAgent(agentId, {
        status: 'working',
        currentTool: event.toolName,
      });
      break;

    case 'tool_result':
      agentService.updateAgent(agentId, { currentTool: undefined });
      break;

    case 'step_complete':
      // step_complete (result event) signals Claude finished processing this turn
      // Update tokens and set status to idle
      log.log(` Agent ${agentId} received step_complete event, tokens:`, event.tokens);
      if (event.tokens) {
        const newTokens =
          (agent.tokensUsed || 0) + event.tokens.input + event.tokens.output;
        // contextUsed is the total context window size
        // This includes: input_tokens + cache_creation_input_tokens + cache_read_input_tokens
        // This represents the full conversation context being used
        const contextUsed =
          event.tokens.input +
          (event.tokens.cacheCreation || 0) +
          (event.tokens.cacheRead || 0);
        log.log(` Agent ${agentId} step_complete: input=${event.tokens.input}, output=${event.tokens.output}, cacheCreation=${event.tokens.cacheCreation}, cacheRead=${event.tokens.cacheRead}, contextUsed=${contextUsed}, cost=${event.cost}, setting to idle`);
        const updated = agentService.updateAgent(agentId, {
          tokensUsed: newTokens,
          contextUsed: contextUsed,
          status: 'idle',
          currentTask: undefined,
          currentTool: undefined,
        });
        log.log(` Agent ${agentId} after update: status=${updated?.status}, contextUsed=${updated?.contextUsed}`);
      } else {
        log.log(` Agent ${agentId} step_complete but no tokens, setting to idle anyway`);
        const updated = agentService.updateAgent(agentId, {
          status: 'idle',
          currentTask: undefined,
          currentTool: undefined,
        });
        log.log(` Agent ${agentId} after update (no tokens): status=${updated?.status}`);
      }
      break;

    case 'error':
      agentService.updateAgent(agentId, { status: 'error' });
      break;
  }

  // Generate human-readable narrative for supervisor
  supervisorService.generateNarrative(agentId, event);

  emit('event', agentId, event);
}

function handleOutput(agentId: string, text: string, isStreaming?: boolean): void {
  emit('output', agentId, text, isStreaming);
}

function handleSessionId(agentId: string, sessionId: string): void {
  log.log(` Agent ${agentId} got session ID: ${sessionId}`);
  agentService.updateAgent(agentId, { sessionId });
}

function handleComplete(agentId: string, success: boolean): void {
  log.log(` Agent ${agentId} completed, success: ${success}`);

  // Process completed, set to idle
  agentService.updateAgent(agentId, {
    status: 'idle',
    currentTask: undefined,
    currentTool: undefined,
  });

  emit('complete', agentId, success);
}

function handleError(agentId: string, error: string): void {
  log.error(` Agent ${agentId} error:`, error);
  agentService.updateAgent(agentId, { status: 'error' });
  emit('error', agentId, error);
}

// ============================================================================
// Command Execution
// ============================================================================

// Internal function to actually execute a command
async function executeCommand(agentId: string, command: string): Promise<void> {
  if (!runner) {
    throw new Error('ClaudeService not initialized');
  }

  const agent = agentService.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  log.log(` Executing command for ${agentId}: ${command.substring(0, 50)}...`);

  // Notify that command is starting (so client can show user prompt in conversation)
  notifyCommandStarted(agentId, command);

  const updated = agentService.updateAgent(agentId, {
    status: 'working',
    currentTask: command.substring(0, 100),
    lastAssignedTask: command, // Store full command for supervisor context
    lastAssignedTaskTime: Date.now(),
  });
  log.log(` Agent ${agentId} status updated to 'working', updated agent:`, updated?.status);

  await runner.run({
    agentId,
    prompt: command,
    workingDir: agent.cwd,
    sessionId: agent.sessionId,
    useChrome: agent.useChrome,
  });
}

// Public function to send a command - sends directly to running process or starts new one
export async function sendCommand(agentId: string, command: string): Promise<void> {
  if (!runner) {
    throw new Error('ClaudeService not initialized');
  }

  const agent = agentService.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Increment task counter for this agent
  agentService.updateAgent(agentId, { taskCount: (agent.taskCount || 0) + 1 });

  // If agent has a running process, send message directly to it
  if (runner.isRunning(agentId)) {
    const sent = runner.sendMessage(agentId, command);
    if (sent) {
      log.log(` Sent message directly to running process for ${agentId}: ${command.substring(0, 50)}...`);
      // Notify that command started (for UI feedback)
      notifyCommandStarted(agentId, command);
      return;
    }
    // If sending failed, fall through to start new process
    log.log(` Failed to send to running process, starting new one for ${agentId}`);
  }

  // Agent is idle or sending failed, execute with new process
  await executeCommand(agentId, command);
}

export async function stopAgent(agentId: string): Promise<void> {
  if (!runner) return;
  await runner.stop(agentId);
  // Clear the queue when agent is stopped
  commandQueues.delete(agentId);
  notifyQueueUpdate(agentId);
}

export function isAgentRunning(agentId: string): boolean {
  return runner?.isRunning(agentId) ?? false;
}

export function getPendingCommands(agentId: string): string[] {
  return commandQueues.get(agentId) || [];
}

export function clearPendingCommands(agentId: string): void {
  commandQueues.delete(agentId);
  notifyQueueUpdate(agentId);
}

/**
 * Sync agent status with actual process state and session activity
 * Called on startup and client reconnection to ensure UI shows correct status
 *
 * The rules are:
 * 1. If we're tracking the process -> trust the current status
 * 2. If agent shows 'working' but no tracked process AND session is not active -> set to idle
 * 3. If agent shows 'idle' but session is RECENTLY active (< 30s) with pending work -> set to working
 *    (This handles server restart while Claude was processing)
 */
export async function syncAgentStatus(agentId: string): Promise<void> {
  const agent = agentService.getAgent(agentId);
  if (!agent) return;

  // Check 1: Is our runner tracking this process?
  const isTrackedProcess = runner?.isRunning(agentId) ?? false;

  // If we're tracking the process, trust the current status - no need to sync
  if (isTrackedProcess) {
    return;
  }

  // Check 2: Session file activity - is there recent pending work?
  let isRecentlyActive = false;
  let hasPendingWork = false;

  if (agent.sessionId && agent.cwd) {
    try {
      // Use 30 second threshold - if Claude was actively working, session would be very recent
      const activity = await getSessionActivityStatus(agent.cwd, agent.sessionId, 30);
      if (activity) {
        isRecentlyActive = activity.isActive; // Modified within 30s AND has pending work
        hasPendingWork = activity.hasPendingWork;
      }
    } catch {
      // Ignore errors
    }
  }

  // Case 1: Agent shows 'working' but no tracked process and not recently active -> set to idle
  if (agent.status === 'working' && !isRecentlyActive) {
    log.log(` Agent ${agent.name} status sync: was 'working' but no process and not recently active, setting to 'idle'`);
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
    });
  }
  // Case 2: Agent shows 'idle' but session is recently active with pending work -> set to working
  // This handles server restart while Claude was processing
  else if (agent.status === 'idle' && isRecentlyActive) {
    log.log(` Agent ${agent.name} status sync: was 'idle' but session recently active with pending work, setting to 'working'`);
    agentService.updateAgent(agentId, {
      status: 'working',
      currentTask: 'Processing...',
    });
  }
}

/**
 * Sync all agents' status with actual process state and session activity
 */
export async function syncAllAgentStatus(): Promise<void> {
  const agents = agentService.getAllAgents();
  await Promise.all(agents.map(agent => syncAgentStatus(agent.id)));
  log.log(` Synced status for ${agents.length} agents`);
}
