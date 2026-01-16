/**
 * Supervisor Service
 * Manages periodic analysis of agent activities via Claude Code
 * Generates human-readable activity narratives
 */

import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import * as agentService from './agent-service.js';
import type {
  ActivityNarrative,
  AgentStatusSummary,
  SupervisorReport,
  SupervisorConfig,
  AgentAnalysis,
  AgentSupervisorHistoryEntry,
  AgentSupervisorHistory,
} from '../../shared/types.js';
import type { StandardEvent } from '../claude/index.js';
import { ClaudeBackend, loadSession } from '../claude/index.js';
import {
  loadSupervisorHistory,
  saveSupervisorHistory,
  addSupervisorHistoryEntry,
  getAgentSupervisorHistory as getAgentHistoryFromStorage,
  deleteSupervisorHistory,
} from '../data/index.js';

// In-memory narrative storage per agent
const narratives = new Map<string, ActivityNarrative[]>();

// Supervisor history storage per agent (persisted to disk)
let supervisorHistory: Map<string, AgentSupervisorHistoryEntry[]> = new Map();

// Configuration
let config: SupervisorConfig = {
  enabled: true,
  intervalMs: 60000, // Not used for timer anymore, kept for compatibility
  maxNarrativesPerAgent: 20,
};

// Debounce for report generation (avoid generating too many reports in quick succession)
let reportDebounceTimer: NodeJS.Timeout | null = null;
const REPORT_DEBOUNCE_MS = 3000; // Wait 3 seconds after last event before generating

// Track if a report is currently being generated
let isGeneratingReport = false;

// Latest report
let latestReport: SupervisorReport | null = null;

// Event listeners
type SupervisorListener = (event: string, data: unknown) => void;
const listeners = new Set<SupervisorListener>();

// Claude backend for spawning processes
const claudeBackend = new ClaudeBackend();

// ============================================================================
// Initialization
// ============================================================================

export function init(): void {
  // Load persisted supervisor history
  supervisorHistory = loadSupervisorHistory();
  console.log('[SupervisorService] Initialized (event-driven mode, using Claude Code)');
  console.log(`[SupervisorService] Loaded history for ${supervisorHistory.size} agents`);
}

export function shutdown(): void {
  if (reportDebounceTimer) {
    clearTimeout(reportDebounceTimer);
    reportDebounceTimer = null;
  }
}

// ============================================================================
// Event System
// ============================================================================

export function subscribe(listener: SupervisorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, data: unknown): void {
  listeners.forEach((listener) => listener(event, data));
}

// ============================================================================
// Narrative Generation
// ============================================================================

/**
 * Generate a human-readable narrative from a Claude event
 */
export function generateNarrative(
  agentId: string,
  event: StandardEvent
): ActivityNarrative | null {
  const agent = agentService.getAgent(agentId);
  if (!agent) return null;

  let narrative: string | null = null;
  let type: ActivityNarrative['type'] = 'output';
  let toolName: string | undefined;

  switch (event.type) {
    case 'tool_start':
      type = 'tool_use';
      toolName = event.toolName;
      narrative = formatToolNarrative(event.toolName, event.toolInput);
      break;

    case 'text':
      if (event.text && event.text.length > 10) {
        type = 'output';
        narrative = `Responding: "${truncate(event.text, 100)}"`;
      }
      break;

    case 'thinking':
      if (event.text) {
        type = 'thinking';
        narrative = `Thinking: "${truncate(event.text, 80)}"`;
      }
      break;

    case 'error':
      type = 'error';
      narrative = `Error occurred: ${event.errorMessage || 'Unknown error'}`;
      break;

    case 'step_complete':
      type = 'task_complete';
      narrative = `Completed processing step (${event.tokens?.input || 0} input, ${event.tokens?.output || 0} output tokens)`;
      break;
  }

  if (!narrative) return null;

  const activityNarrative: ActivityNarrative = {
    id: generateId(),
    agentId,
    timestamp: Date.now(),
    type,
    narrative,
    toolName,
  };

  // Store narrative
  addNarrative(agentId, activityNarrative);

  // Emit for real-time updates
  emit('narrative', { agentId, narrative: activityNarrative });

  // Trigger report generation on significant events (task start or complete)
  if (event.type === 'init' || event.type === 'step_complete') {
    console.log(`[Supervisor] Event trigger: ${event.type} from agent ${agentId}`);
    scheduleReportGeneration();
  }

  return activityNarrative;
}

/**
 * Schedule a report generation with debouncing
 * This ensures we don't generate too many reports in quick succession
 */
function scheduleReportGeneration(): void {
  if (!config.enabled) {
    console.log('[Supervisor] Disabled, skipping scheduled report');
    return;
  }

  // Clear any existing timer
  if (reportDebounceTimer) {
    clearTimeout(reportDebounceTimer);
  }

  console.log(`[Supervisor] Scheduled report generation (${REPORT_DEBOUNCE_MS}ms debounce)`);

  // Schedule report generation after debounce period
  reportDebounceTimer = setTimeout(async () => {
    if (isGeneratingReport) {
      console.log('[Supervisor] Report already in progress, skipping scheduled');
      return;
    }

    // Check if we have any agents at all
    const agents = agentService.getAllAgents();
    if (agents.length === 0) {
      console.log('[Supervisor] No agents, skipping report');
      return;
    }

    try {
      console.log('[Supervisor] Debounce complete, generating report...');
      await generateReport();
    } catch (err) {
      console.error('[Supervisor] Report generation failed:', err);
    }
  }, REPORT_DEBOUNCE_MS);
}

function formatToolNarrative(
  toolName?: string,
  toolInput?: Record<string, unknown>
): string {
  if (!toolName) return 'Using unknown tool';

  switch (toolName) {
    case 'Read': {
      const readPath = toolInput?.file_path as string;
      return `Reading file "${getFileName(readPath)}" to understand its contents`;
    }

    case 'Write': {
      const writePath = toolInput?.file_path as string;
      return `Writing new content to "${getFileName(writePath)}"`;
    }

    case 'Edit': {
      const editPath = toolInput?.file_path as string;
      return `Making targeted edits to "${getFileName(editPath)}"`;
    }

    case 'Bash': {
      const cmd = toolInput?.command as string;
      return `Running command: ${truncate(cmd, 60)}`;
    }

    case 'Grep': {
      const pattern = toolInput?.pattern as string;
      return `Searching for pattern "${truncate(pattern, 40)}" in codebase`;
    }

    case 'Glob': {
      const globPattern = toolInput?.pattern as string;
      return `Finding files matching "${truncate(globPattern, 40)}"`;
    }

    case 'WebSearch': {
      const query = toolInput?.query as string;
      return `Searching the web for "${truncate(query, 50)}"`;
    }

    case 'WebFetch': {
      const url = toolInput?.url as string;
      return `Fetching content from ${truncate(url, 50)}`;
    }

    case 'Task': {
      const desc = toolInput?.description as string;
      return `Starting sub-task: "${truncate(desc, 60)}"`;
    }

    case 'TodoWrite': {
      const todos = toolInput?.todos as unknown[];
      return `Updating task list with ${todos?.length || 0} items`;
    }

    case 'AskUserQuestion': {
      return 'Asking user a question for clarification';
    }

    case 'NotebookEdit': {
      const notebookPath = toolInput?.notebook_path as string;
      return `Editing notebook "${getFileName(notebookPath)}"`;
    }

    default:
      return `Using ${toolName} tool`;
  }
}

// ============================================================================
// Narrative Storage
// ============================================================================

function addNarrative(agentId: string, narrative: ActivityNarrative): void {
  if (!narratives.has(agentId)) {
    narratives.set(agentId, []);
  }
  const agentNarratives = narratives.get(agentId)!;
  agentNarratives.unshift(narrative);

  // Trim to max
  if (agentNarratives.length > config.maxNarrativesPerAgent) {
    agentNarratives.pop();
  }
}

export function getNarratives(agentId: string): ActivityNarrative[] {
  return narratives.get(agentId) || [];
}

export function getAllNarratives(): Map<string, ActivityNarrative[]> {
  return new Map(narratives);
}

export function clearNarratives(agentId: string): void {
  narratives.delete(agentId);
}

// ============================================================================
// Report Generation
// ============================================================================

export async function generateReport(): Promise<SupervisorReport> {
  console.log('[Supervisor] generateReport() called');

  // If already generating, return the latest report (or wait for current one)
  if (isGeneratingReport) {
    console.log('[Supervisor] Report already in progress, returning latest');
    // Return latest report if available, otherwise return a pending status
    if (latestReport) {
      return latestReport;
    }
    // No report yet, return empty one
    return {
      id: generateId(),
      timestamp: Date.now(),
      agentSummaries: [],
      overallStatus: 'healthy',
      insights: ['Report generation in progress...'],
      recommendations: [],
    };
  }

  isGeneratingReport = true;
  console.log('[Supervisor] Starting report generation...');

  try {
    const agents = agentService.getAllAgents();

    if (agents.length === 0) {
      // Return empty report if no agents
      const emptyReport: SupervisorReport = {
        id: generateId(),
        timestamp: Date.now(),
        agentSummaries: [],
        overallStatus: 'healthy',
        insights: ['No agents currently active'],
        recommendations: [],
      };
      latestReport = emptyReport;
      emit('report', emptyReport);
      return emptyReport;
    }

    // Build agent summaries with session history
    const agentSummaries: AgentStatusSummary[] = await Promise.all(
      agents.map(async (agent) => {
        // Try to load recent session history if agent has a session
        let sessionNarratives: ActivityNarrative[] = [];
        if (agent.sessionId) {
          try {
            const history = await loadSession(agent.cwd, agent.sessionId, 20);
            if (history && history.messages.length > 0) {
              // Convert session messages to narratives
              sessionNarratives = history.messages.map((msg, index) => ({
                id: `session-${agent.sessionId}-${index}`,
                agentId: agent.id,
                timestamp: new Date(msg.timestamp).getTime(),
                type: msg.type === 'user' ? 'task_start' as const :
                      msg.type === 'tool_use' ? 'tool_use' as const :
                      msg.type === 'tool_result' ? 'output' as const : 'output' as const,
                narrative: msg.type === 'user' ? `User asked: "${truncate(msg.content, 150)}"` :
                          msg.type === 'assistant' ? `Responded: "${truncate(msg.content, 150)}"` :
                          msg.type === 'tool_use' ? `Used tool: ${msg.toolName}` :
                          `Tool result received`,
                toolName: msg.toolName,
              }));
            }
          } catch (err) {
            console.error(`[SupervisorService] Failed to load session for ${agent.name}:`, err);
          }
        }

        // Combine in-memory narratives with session history, preferring recent in-memory ones
        const inMemoryNarratives = getNarratives(agent.id).slice(0, 10);
        const allNarratives = inMemoryNarratives.length > 0
          ? inMemoryNarratives
          : sessionNarratives.slice(-10);

        return {
          id: agent.id,
          name: agent.name,
          class: agent.class,
          status: agent.status,
          currentTask: agent.currentTask,
          lastAssignedTask: agent.lastAssignedTask,
          lastAssignedTaskTime: agent.lastAssignedTaskTime,
          recentNarratives: allNarratives,
          tokensUsed: agent.tokensUsed,
          contextUsed: agent.contextUsed,
          lastActivityTime: agent.lastActivity,
        };
      })
    );

    // Call Claude for analysis
    const prompt = await buildSupervisorPrompt(agentSummaries);

    let response: string;
    try {
      response = await callClaudeForAnalysis(prompt);
    } catch (err) {
      console.error('[SupervisorService] Claude API call failed:', err);
      // Return fallback report (but still emit it to clients)
      const fallbackReport = createFallbackReport(agentSummaries);
      latestReport = fallbackReport;
      emit('report', fallbackReport);
      return fallbackReport;
    }

    // Parse response
    const report = parseClaudeResponse(response, agentSummaries);

    // Save history entries for each agent in the report
    saveReportToHistory(report);

    latestReport = report;
    console.log(`[Supervisor] ✓ Report generated successfully (${report.agentSummaries.length} agents analyzed)`);
    emit('report', report);

    return report;
  } finally {
    isGeneratingReport = false;
  }
}

function buildSupervisorPrompt(summaries: AgentStatusSummary[]): string {
  const customPrompt = config.customPrompt || DEFAULT_SUPERVISOR_PROMPT;

  const agentData = summaries.map((s) => {
    // Calculate time since task was assigned
    const taskAssignedSecondsAgo = s.lastAssignedTaskTime
      ? Math.round((Date.now() - s.lastAssignedTaskTime) / 1000)
      : null;

    return {
      id: s.id, // Include ID so we can match response back
      name: s.name,
      class: s.class,
      status: s.status,
      currentTask: s.currentTask || 'None',
      // Include the full assigned task so supervisor knows what the agent was asked to do
      assignedTask: s.lastAssignedTask
        ? truncate(s.lastAssignedTask, 500)
        : 'No task assigned yet',
      taskAssignedSecondsAgo,
      tokensUsed: s.tokensUsed,
      contextPercent: Math.round((s.contextUsed / 200000) * 100),
      timeSinceActivity: Math.round((Date.now() - s.lastActivityTime) / 1000),
      recentActivities: s.recentNarratives.map((n) => n.narrative).slice(0, 5),
    };
  });

  return customPrompt.replace('{{AGENT_DATA}}', JSON.stringify(agentData, null, 2));
}

const DEFAULT_SUPERVISOR_PROMPT = `You are a Supervisor AI monitoring a team of autonomous coding agents in the Tide Commander system. Your role is to analyze their activities and provide actionable insights.

## Current Agent Status
{{AGENT_DATA}}

## Analysis Guidelines

1. **Progress Assessment**: Determine if each agent is making meaningful progress toward their goals
2. **Bottleneck Detection**: Identify agents that appear stuck, confused, or spinning their wheels
3. **Coordination**: Note any potential conflicts or duplicated work between agents
4. **Resource Usage**: Flag agents with high context usage (>70%) who may need context clearing
5. **Idle Detection**: Note agents that have been idle for extended periods

## CRITICAL STATUS RULES
- If agent "status" field is "working", they are ACTIVELY working RIGHT NOW. Use present tense: "Working on...", "Editing...", "Implementing..."
- If agent "status" field is "idle", they have stopped. Show what they last worked on: "Idle - Last worked on [brief task description]"
- NEVER say "No current task" - always infer the task from "assignedTask" or "recentActivities"
- NEVER say "Just completed" or "Idle after" for agents with status="working" - they are still working!
- Look at "recentActivities" and "assignedTask" to understand what the agent is/was doing

## Response Format

Provide a JSON response with exactly this structure. IMPORTANT: Use the exact "id" and "name" values from the input data for each agent.
{
  "overallStatus": "healthy" | "attention_needed" | "critical",
  "agentAnalyses": [
    {
      "agentId": "copy the id from input",
      "agentName": "copy the name from input",
      "statusDescription": "If working: 'Working on [task]'. If idle: 'Idle - Last worked on [task from assignedTask or recentActivities]'",
      "progress": "on_track" | "stalled" | "blocked" | "completed" | "idle",
      "recentWorkSummary": "Brief summary of recent activities (2-3 sentences)",
      "concerns": ["Array of specific issues, if any"]
    }
  ],
  "insights": [
    "Key observations about overall team performance",
    "Patterns or trends noticed across agents"
  ],
  "recommendations": [
    "Specific actionable suggestions for improvement",
    "Priority items that need human attention"
  ]
}

Be concise but insightful. Focus on actionable information that helps the human operator manage the agent team effectively.

Respond ONLY with the JSON object, no markdown code fences or additional text.`;

/**
 * Call Claude Code to analyze agent activities
 * Spawns a one-shot Claude process with --print flag to get the response
 * Uses stdin input format for large prompts (avoids shell argument limits)
 */
async function callClaudeForAnalysis(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log('[SupervisorService] Spawning Claude Code for analysis...');

    const executable = claudeBackend.getExecutablePath();
    // Use --print flag for one-shot execution (no interactive mode)
    // Use --output-format stream-json to get structured output (requires --verbose)
    // Use --input-format stream-json to send prompt via stdin (avoids shell arg limits)
    // Use --no-session-persistence to make it ephemeral (don't save/restore context between calls)
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--no-session-persistence',
    ];

    console.log(`[SupervisorService] Command: ${executable} ${args.join(' ')}`);

    const childProcess = spawn(executable, args, {
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
      },
      shell: true,
    });

    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let textOutput = '';
    let hasError = false;

    // Handle stdout - collect text events
    childProcess.stdout?.on('data', (data: Buffer) => {
      buffer += decoder.write(data);

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          // Collect text from assistant messages
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                textOutput += block.text;
              }
            }
          }
          // Also collect from stream_event with content_block_delta
          if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
            if (event.event.delta?.type === 'text_delta' && event.event.delta.text) {
              textOutput += event.event.delta.text;
            }
          }
        } catch {
          // Not JSON, might be raw text
          console.log('[SupervisorService] Non-JSON line:', line.substring(0, 100));
        }
      }
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const text = decoder.write(data);
      console.error('[SupervisorService] stderr:', text);
      if (text.toLowerCase().includes('error')) {
        hasError = true;
      }
    });

    childProcess.on('close', (code) => {
      // Process remaining buffer
      const remaining = buffer + decoder.end();
      if (remaining.trim()) {
        try {
          const event = JSON.parse(remaining);
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                textOutput += block.text;
              }
            }
          }
        } catch {
          // Ignore
        }
      }

      console.log(`[SupervisorService] Claude Code exited with code ${code}, output length: ${textOutput.length}`);

      if (code !== 0 && textOutput.length === 0) {
        reject(new Error(`Claude Code exited with code ${code}`));
      } else if (!textOutput) {
        reject(new Error('No response from Claude Code'));
      } else {
        resolve(textOutput);
      }
    });

    childProcess.on('error', (err) => {
      console.error('[SupervisorService] Process spawn error:', err);
      reject(err);
    });

    // Send the prompt via stdin using stream-json format
    childProcess.on('spawn', () => {
      console.log('[SupervisorService] Process spawned, sending prompt via stdin...');
      const stdinMessage = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: prompt,
        },
      });
      childProcess.stdin?.write(stdinMessage + '\n');
      childProcess.stdin?.end(); // Close stdin to signal we're done
    });

    // Timeout after 120 seconds (can take a while for large analyses)
    setTimeout(() => {
      if (!childProcess.killed) {
        childProcess.kill('SIGTERM');
        reject(new Error('Claude Code timed out'));
      }
    }, 120000);
  });
}

function parseClaudeResponse(
  response: string,
  summaries: AgentStatusSummary[]
): SupervisorReport {
  try {
    // Try to extract JSON from the response (in case there's extra text)
    let jsonStr = response.trim();

    // Remove markdown code fences if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);

    // Map agentAnalyses to agentSummaries (the field name in our type)
    const agentAnalyses: AgentAnalysis[] = (parsed.agentAnalyses || []).map(
      (a: AgentAnalysis & { agentId?: string; agentName?: string }) => ({
        agentId: a.agentId || '',
        agentName: a.agentName || '',
        statusDescription: a.statusDescription || 'Unknown status',
        progress: a.progress || 'idle',
        recentWorkSummary: a.recentWorkSummary || 'No recent activity',
        concerns: a.concerns || [],
      })
    );

    // Match agent IDs from summaries by name (more reliable than index)
    agentAnalyses.forEach((analysis) => {
      if (!analysis.agentId) {
        // Find matching summary by name
        const matchingSummary = summaries.find(s => s.name === analysis.agentName);
        if (matchingSummary) {
          analysis.agentId = matchingSummary.id;
        }
      }
    });

    return {
      id: generateId(),
      timestamp: Date.now(),
      agentSummaries: agentAnalyses,
      overallStatus: parsed.overallStatus || 'healthy',
      insights: parsed.insights || [],
      recommendations: parsed.recommendations || [],
      rawResponse: response,
    };
  } catch (err) {
    console.error('[SupervisorService] Failed to parse Claude response:', err);
    console.error('[SupervisorService] Raw response:', response);

    // Return fallback report
    return createFallbackReport(summaries);
  }
}

function createFallbackReport(summaries: AgentStatusSummary[]): SupervisorReport {
  return {
    id: generateId(),
    timestamp: Date.now(),
    agentSummaries: summaries.map((s) => ({
      agentId: s.id,
      agentName: s.name,
      statusDescription: `${s.status} - ${s.currentTask || 'No current task'}`,
      progress: s.status === 'working' ? 'on_track' : 'idle',
      recentWorkSummary: s.recentNarratives[0]?.narrative || 'No recent activity',
    })),
    overallStatus: 'healthy',
    insights: ['Unable to generate detailed analysis - using basic status'],
    recommendations: [],
  };
}

// ============================================================================
// History Management
// ============================================================================

/**
 * Save a report's agent analyses to history
 */
function saveReportToHistory(report: SupervisorReport): void {
  for (const analysis of report.agentSummaries) {
    const entry: AgentSupervisorHistoryEntry = {
      id: generateId(),
      timestamp: report.timestamp,
      reportId: report.id,
      analysis,
    };

    addSupervisorHistoryEntry(supervisorHistory, analysis.agentId, entry);
  }

  // Persist to disk
  saveSupervisorHistory(supervisorHistory);
  console.log(`[SupervisorService] Saved history entries for ${report.agentSummaries.length} agents`);
}

/**
 * Get supervisor history for a specific agent
 */
export function getAgentSupervisorHistory(agentId: string): AgentSupervisorHistory {
  return getAgentHistoryFromStorage(supervisorHistory, agentId);
}

/**
 * Delete supervisor history for an agent (call when agent is deleted)
 */
export function deleteAgentHistory(agentId: string): void {
  deleteSupervisorHistory(supervisorHistory, agentId);
  saveSupervisorHistory(supervisorHistory);
  console.log(`[SupervisorService] Deleted history for agent ${agentId}`);
}

// ============================================================================
// Configuration
// ============================================================================

export function getConfig(): SupervisorConfig {
  return { ...config };
}

export function setConfig(updates: Partial<SupervisorConfig>): void {
  config = { ...config, ...updates };

  // If disabling, cancel any pending report
  if (!config.enabled && reportDebounceTimer) {
    clearTimeout(reportDebounceTimer);
    reportDebounceTimer = null;
  }

  emit('config_changed', config);
}

export function getLatestReport(): SupervisorReport | null {
  return latestReport;
}

export function getStatus(): {
  enabled: boolean;
  lastReportTime: number | null;
  nextReportTime: number | null;
} {
  return {
    enabled: config.enabled,
    lastReportTime: latestReport?.timestamp || null,
    // Reports are now event-driven (on task start/complete), not scheduled
    nextReportTime: null,
  };
}

// ============================================================================
// Utilities
// ============================================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function truncate(str: string | undefined, maxLen: number): string {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function getFileName(path: string | undefined): string {
  if (!path) return 'unknown';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}
