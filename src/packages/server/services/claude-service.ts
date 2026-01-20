/**
 * Claude Service
 * Manages Claude Code runner and command execution
 */

import { ClaudeRunner, StandardEvent } from '../claude/index.js';
import { parseContextOutput } from '../claude/backend.js';
import { getSessionActivityStatus } from '../claude/session-loader.js';
import type { CustomAgentDefinition } from '../claude/types.js';
import * as agentService from './agent-service.js';
import * as supervisorService from './supervisor-service.js';
import * as customClassService from './custom-class-service.js';
import * as skillService from './skill-service.js';
import { loadRunningProcesses, isProcessRunning } from '../data/index.js';
import { logger } from '../utils/logger.js';
import type { ContextStats } from '../../shared/types.js';

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

// Track agents that are currently running /context to avoid infinite loops
const pendingContextRefresh = new Set<string>();

// Command started callback (set by websocket handler)
let commandStartedCallback: ((agentId: string, command: string) => void) | null = null;

export function setCommandStartedCallback(callback: (agentId: string, command: string) => void): void {
  commandStartedCallback = callback;
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

/**
 * Shutdown the Claude service
 * @param killProcesses - If true, kill all running Claude processes.
 *                        If false (default), processes continue running independently.
 *                        Set to true for clean shutdown, false for commander restart/crash recovery.
 */
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
      if (agent.status !== 'working') {
        log.log(`🟢 [${agent.name}] status: ${agent.status} → working (init event)`);
      }
      agentService.updateAgent(agentId, { status: 'working' });
      break;

    case 'tool_start':
      log.log(` Agent ${agentId} tool_start: toolName=${event.toolName}`);
      if (agent.status !== 'working') {
        log.log(`🟢 [${agent.name}] status: ${agent.status} → working (tool_start)`);
      }
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
      // Update tokens and context usage
      log.log(` Agent ${agentId} received step_complete event, tokens:`, event.tokens, 'modelUsage:', event.modelUsage);

      // Calculate actual context window usage from cache tokens
      // The context window contains: cached system prompt + conversation history + new input + output
      // cacheRead = tokens read from cache (system prompt, conversation history)
      // cacheCreation = new tokens being added to cache
      // input = new user input tokens (often 0 when using cache)
      // output = response tokens
      let contextUsed = agent.contextUsed || 0;
      let contextLimit = agent.contextLimit || 200000;

      if (event.modelUsage) {
        // Use modelUsage data which has the most accurate context window info
        const cacheRead = event.modelUsage.cacheReadInputTokens || 0;
        const cacheCreation = event.modelUsage.cacheCreationInputTokens || 0;
        const inputTokens = event.modelUsage.inputTokens || 0;
        const outputTokens = event.modelUsage.outputTokens || 0;
        const contextWindow = event.modelUsage.contextWindow || 200000;

        // Context used = everything in the context window
        // This is the actual snapshot of what's loaded, not accumulated over time
        contextUsed = cacheRead + cacheCreation + inputTokens + outputTokens;
        contextLimit = contextWindow;

        log.log(` Agent ${agentId} context calculation from modelUsage: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, input=${inputTokens}, output=${outputTokens}, contextUsed=${contextUsed}, contextLimit=${contextLimit}`);
      } else if (event.tokens) {
        // Fallback: use tokens data
        const cacheRead = event.tokens.cacheRead || 0;
        const cacheCreation = event.tokens.cacheCreation || 0;
        const inputTokens = event.tokens.input || 0;
        const outputTokens = event.tokens.output || 0;

        // Context used = everything in the context window
        contextUsed = cacheRead + cacheCreation + inputTokens + outputTokens;

        log.log(` Agent ${agentId} context calculation from tokens: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, input=${inputTokens}, output=${outputTokens}, contextUsed=${contextUsed}`);
      }

      // Update tokensUsed as cumulative (for cost tracking), contextUsed as snapshot
      const newTokensUsed = (agent.tokensUsed || 0) + (event.tokens?.input || 0) + (event.tokens?.output || 0);

      agentService.updateAgent(agentId, {
        tokensUsed: newTokensUsed,
        contextUsed,
        contextLimit,
        // Note: contextStats is populated separately via /context command parsing
      });

      // Set to idle
      log.log(`🔴 [${agent.name}] status: ${agent.status} → idle (step_complete)`);
      const updated = agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
      });
      log.log(` Agent ${agentId} after update: status=${updated?.status}, contextUsed=${updated?.contextUsed}, contextLimit=${updated?.contextLimit}`);

      // Auto-refresh context stats after turn completion (with delay to ensure idle state)
      // Skip if:
      // - This agent is already doing a /context refresh (to avoid infinite loop)
      // - The last assigned task was a /context command (user already ran it)
      const lastTask = agent.lastAssignedTask?.trim() || '';
      const isContextCommand = lastTask === '/context' || lastTask === '/cost' || lastTask === '/compact';

      if (agent.sessionId && !pendingContextRefresh.has(agentId) && !isContextCommand) {
        setTimeout(() => {
          const currentAgent = agentService.getAgent(agentId);
          if (currentAgent?.status === 'idle' && !pendingContextRefresh.has(agentId)) {
            log.log(` Auto-refreshing context stats for ${agent.name} after turn completion`);
            pendingContextRefresh.add(agentId);
            import('./claude-service.js').then(({ sendCommand }) => {
              sendCommand(agentId, '/context')
                .catch(err => {
                  log.error(` Failed to auto-refresh context for ${agent.name}:`, err);
                })
                .finally(() => {
                  // Clear the flag after a delay to allow the response to be processed
                  setTimeout(() => pendingContextRefresh.delete(agentId), 2000);
                });
            });
          }
        }, 500);
      }
      break;

    case 'error':
      log.log(`❌ [${agent.name}] status: ${agent.status} → error`);
      agentService.updateAgent(agentId, { status: 'error' });
      break;

    case 'context_stats':
      // Parse /context command output and update agent's context stats
      if (event.contextStatsRaw) {
        log.log(` Agent ${agentId} received context_stats event`);
        const contextStats = parseContextOutput(event.contextStatsRaw);
        if (contextStats) {
          log.log(` Agent ${agentId} parsed context stats: model=${contextStats.model}, used=${contextStats.usedPercent}%`);
          agentService.updateAgent(agentId, {
            contextStats,
            contextUsed: contextStats.totalTokens,
            contextLimit: contextStats.contextWindow,
          });
        } else {
          log.log(` Agent ${agentId} failed to parse context stats`);
        }
      }
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
  const agent = agentService.getAgent(agentId);
  const agentName = agent?.name || agentId;
  const prevStatus = agent?.status || 'unknown';

  log.log(`${success ? '✅' : '🔴'} [${agentName}] status: ${prevStatus} → idle (process ${success ? 'completed' : 'failed'})`);

  // Process completed, set to idle
  agentService.updateAgent(agentId, {
    status: 'idle',
    currentTask: undefined,
    currentTool: undefined,
  });

  emit('complete', agentId, success);
}

function handleError(agentId: string, error: string): void {
  const agent = agentService.getAgent(agentId);
  const agentName = agent?.name || agentId;
  const prevStatus = agent?.status || 'unknown';

  log.error(`❌ [${agentName}] status: ${prevStatus} → error: ${error}`);
  agentService.updateAgent(agentId, { status: 'error' });
  emit('error', agentId, error);
}

// ============================================================================
// Command Execution
// ============================================================================

// Custom agent config type
interface CustomAgentConfig {
  name: string;
  definition: CustomAgentDefinition;
}

// Internal function to actually execute a command
// forceNewSession: when true, don't resume existing session (for boss team questions)
// customAgent: optional custom agent config for --agents flag (used for custom class instructions)
async function executeCommand(agentId: string, command: string, systemPrompt?: string, forceNewSession?: boolean, customAgent?: CustomAgentConfig): Promise<void> {
  if (!runner) {
    throw new Error('ClaudeService not initialized');
  }

  const agent = agentService.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  log.log(` Executing command for ${agentId}: ${command.substring(0, 50)}...`);
  if (forceNewSession) {
    log.log(` Force new session mode - not resuming existing session`);
  }
  if (customAgent) {
    log.log(` Using custom agent "${customAgent.name}" for this session`);
  }

  // Notify that command is starting (so client can show user prompt in conversation)
  notifyCommandStarted(agentId, command);

  const prevStatus = agent.status;
  log.log(`🟢 [${agent.name}] status: ${prevStatus} → working (command started)`);

  // Don't update lastAssignedTask for system messages (like auto-resume) to avoid recursive loops
  const isSystemMessage = command.startsWith('[System:');
  const updateData: Partial<Parameters<typeof agentService.updateAgent>[1]> = {
    status: 'working' as const,
    currentTask: command.substring(0, 100),
  };
  if (!isSystemMessage) {
    updateData.lastAssignedTask = command;
    updateData.lastAssignedTaskTime = Date.now();
  }

  const updated = agentService.updateAgent(agentId, updateData);

  await runner.run({
    agentId,
    prompt: command,
    workingDir: agent.cwd,
    sessionId: agent.sessionId,
    model: agent.model,
    useChrome: agent.useChrome,
    permissionMode: agent.permissionMode,
    systemPrompt,
    customAgent,
    forceNewSession,
  });
}

// Public function to send a command - sends directly to running process if busy
// This allows users to send messages while Claude is working - Claude will see them in stdin
// systemPrompt is only used when starting a new process (not for messages to running process)
// forceNewSession: when true, don't resume existing session (for boss team questions with context)
// customAgent: optional custom agent config for --agents flag (used for custom class instructions)
export async function sendCommand(agentId: string, command: string, systemPrompt?: string, forceNewSession?: boolean, customAgent?: CustomAgentConfig): Promise<void> {
  if (!runner) {
    throw new Error('ClaudeService not initialized');
  }

  const agent = agentService.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Check if agent is currently busy (has a running process)
  // If busy, send the message directly to the running process via stdin
  // Claude will process it as part of its current turn - no interruption needed
  // Note: customAgent config only applies when starting a new process
  if (runner.isRunning(agentId) && !forceNewSession) {
    log.log(` Agent ${agentId} is busy, sending message directly to running process...`);

    // Send directly to the running process via stdin
    const sent = runner.sendMessage(agentId, command);
    if (sent) {
      log.log(` Sent message to running process for ${agentId}: ${command.substring(0, 50)}...`);
      notifyCommandStarted(agentId, command);
      // Don't update lastAssignedTask for system messages (like auto-resume)
      const isSystemMessage = command.startsWith('[System:');
      const updateData: Record<string, unknown> = {
        taskCount: (agent.taskCount || 0) + 1,
      };
      if (!isSystemMessage) {
        updateData.lastAssignedTask = command;
        updateData.lastAssignedTaskTime = Date.now();
      }
      agentService.updateAgent(agentId, updateData);
      return;
    }
    // If sending failed (process died), fall through to start new process
    log.log(` Failed to send to running process, starting new process for ${agentId}`);
  }

  // Increment task counter for this agent
  agentService.updateAgent(agentId, { taskCount: (agent.taskCount || 0) + 1 });

  // Agent is idle, sending failed, or we need special options - execute with new process
  await executeCommand(agentId, command, systemPrompt, forceNewSession, customAgent);
}

export async function stopAgent(agentId: string): Promise<void> {
  const agent = agentService.getAgent(agentId);
  const agentName = agent?.name || agentId;
  const prevStatus = agent?.status || 'unknown';

  log.log(`🛑 [STOP REQUEST] Agent ${agentName} (${agentId}): Stop requested, current status=${prevStatus}`);

  if (!runner) {
    log.log(`🛑 [STOP REQUEST] Agent ${agentName}: Runner not initialized, cannot stop`);
    return;
  }

  await runner.stop(agentId);
  log.log(`🛑 [STOP REQUEST] Agent ${agentName}: Stop sequence initiated`);
}

export function isAgentRunning(agentId: string): boolean {
  return runner?.isRunning(agentId) ?? false;
}

/**
 * Check if there's an orphaned Claude process for this agent
 * Uses ONLY PID tracking - not general process discovery
 * (Process discovery is too aggressive and matches unrelated Claude sessions)
 */
function checkForOrphanedProcess(agentId: string): boolean {
  try {
    // Check our persisted PID records - this is agent-specific
    const savedProcesses = loadRunningProcesses();
    const savedProcess = savedProcesses.find((p: { agentId: string }) => p.agentId === agentId);
    if (savedProcess && isProcessRunning(savedProcess.pid)) {
      log.log(`🔍 Found orphaned process for ${agentId} via PID tracking (pid=${savedProcess.pid})`);
      return true;
    }

    // NOTE: We intentionally don't use general process discovery here
    // because it would match ANY Claude process running in the same directory,
    // including user's manual sessions, causing false positives

    return false;
  } catch (err) {
    log.error(`Error checking for orphaned process: ${err}`);
    return false;
  }
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
    log.log(`🔍 [${agent.name}] sync skipped - runner is tracking process (status=${agent.status})`);
    return;
  }

  // Check 2: Session file activity - is there recent pending work?
  let isRecentlyActive = false;

  if (agent.sessionId && agent.cwd) {
    try {
      // Use 30 second threshold - if Claude was actively working, session would be very recent
      const activity = await getSessionActivityStatus(agent.cwd, agent.sessionId, 30);
      if (activity) {
        isRecentlyActive = activity.isActive; // Modified within 30s AND has pending work
        log.log(`🔍 [${agent.name}] session activity: isActive=${activity.isActive}, lastMessage=${activity.lastMessageType}, hasPending=${activity.hasPendingWork}`);
      }
    } catch (err) {
      log.log(`🔍 [${agent.name}] session activity check failed:`, err);
    }
  }

  // Debug log
  log.log(`🔍 [${agent.name}] sync check: status=${agent.status}, tracked=${isTrackedProcess}, recentlyActive=${isRecentlyActive}`);

  // Case 1: Agent shows 'working' but no tracked process and not recently active -> set to idle
  if (agent.status === 'working' && !isRecentlyActive) {
    log.log(`🔴 [${agent.name}] status: working → idle (no process and not recently active)`);
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
    });
  }
  // Case 2: Agent shows 'idle' but session is recently active with pending work -> set to working
  // This handles server restart while Claude was processing
  else if (agent.status === 'idle' && isRecentlyActive) {
    log.log(`🟢 [${agent.name}] status: idle → working (session recently active with pending work)`);
    agentService.updateAgent(agentId, {
      status: 'working',
      currentTask: 'Processing...',
    });
  }
  // No change needed
  else {
    log.log(`✅ [${agent.name}] sync: no change needed (status=${agent.status})`);
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

/**
 * Auto-resume agents that were working before server restart
 * Uses Claude's session persistence to continue where they left off
 */
export async function autoResumeWorkingAgents(): Promise<void> {
  const agentsToResume = agentService.getAgentsToResume();

  if (agentsToResume.length === 0) {
    log.log(' No agents to auto-resume');
    return;
  }

  log.log(`🔄 Auto-resuming ${agentsToResume.length} agent(s) that were working before restart...`);

  for (const agentInfo of agentsToResume) {
    try {
      const agent = agentService.getAgent(agentInfo.id);
      if (!agent) {
        log.log(` Agent ${agentInfo.id} no longer exists, skipping auto-resume`);
        continue;
      }

      // Don't resume if agent is already running somehow
      if (runner?.isRunning(agentInfo.id)) {
        log.log(` Agent ${agentInfo.name} is already running, skipping auto-resume`);
        continue;
      }

      log.log(`🔄 Auto-resuming ${agentInfo.name}: continuing task "${agentInfo.lastTask}"`);

      // Build customAgentConfig for the agent's class (same logic as command-handler)
      // This ensures the agent gets its class instructions on auto-resume
      let customAgentConfig: CustomAgentConfig | undefined;
      if (agent.class && agent.class !== 'boss') {
        const classInstructions = customClassService.getClassInstructions(agent.class);
        const skillsContent = skillService.buildSkillPromptContent(agentInfo.id, agent.class);

        let combinedPrompt = '';
        if (classInstructions) {
          combinedPrompt += classInstructions;
        }
        if (skillsContent) {
          if (combinedPrompt) combinedPrompt += '\n\n';
          combinedPrompt += skillsContent;
        }

        if (combinedPrompt) {
          const customClass = customClassService.getCustomClass(agent.class);
          customAgentConfig = {
            name: customClass?.id || agent.class,
            definition: {
              description: customClass?.description || `Agent class: ${agent.class}`,
              prompt: combinedPrompt,
            },
          };
          log.log(`🔄 Auto-resume ${agentInfo.name}: built customAgentConfig with ${combinedPrompt.length} chars`);
        }
      }

      // Send a continuation message to Claude
      // Claude's session persistence will remember the context and continue
      const resumeMessage = `[System: The commander server was restarted while you were working. Please continue with your previous task. Your last assigned task was: "${agentInfo.lastTask}"]`;

      await sendCommand(agentInfo.id, resumeMessage, undefined, undefined, customAgentConfig);
      log.log(`✅ Auto-resumed ${agentInfo.name}`);

      // Small delay between agents to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      log.error(` Failed to auto-resume ${agentInfo.name}:`, err);
    }
  }

  // Clear the list after processing
  agentService.clearAgentsToResume();
  log.log(' Auto-resume complete');
}
