/**
 * Tide Data Manager
 * Manages persistent storage for Tide Commander
 *
 * Data is stored in ~/.local/share/tide-commander/
 * - agents.json - Agent configurations and session mappings
 * - areas.json - Drawing areas (synced from frontend)
 *
 * Claude sessions are stored in ~/.claude/projects/<cwd>/
 * We reference them by session ID
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Agent, DrawingArea, AgentSupervisorHistory, AgentSupervisorHistoryEntry } from '../../shared/types.js';

// XDG-compliant data directory
const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const AREAS_FILE = path.join(DATA_DIR, 'areas.json');
const SUPERVISOR_HISTORY_FILE = path.join(DATA_DIR, 'supervisor-history.json');

// Maximum history entries per agent
const MAX_HISTORY_PER_AGENT = 50;

// Agent with session history reference (stored on disk)
// Some fields may be missing in older saved data
export interface StoredAgent {
  id: string;
  name: string;
  class: Agent['class'];
  position: Agent['position'];
  tmuxSession: string;
  cwd: string;
  tokensUsed: number;
  contextUsed?: number;  // May be missing in older data
  contextLimit?: number; // May be missing in older data
  taskCount?: number;    // May be missing in older data
  createdAt: number;
  lastActivity: number;
  sessionId?: string;
  lastSessionId?: string;
  currentTask?: string;
}

export interface TideData {
  agents: StoredAgent[];
  savedAt: number;
  version: string;
}

// Ensure data directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[TideData] Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Load agents from disk
 */
export function loadAgents(): StoredAgent[] {
  ensureDataDir();

  try {
    if (fs.existsSync(AGENTS_FILE)) {
      const data: TideData = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
      console.log(`[TideData] Loaded ${data.agents.length} agents from ${AGENTS_FILE}`);
      return data.agents;
    }
  } catch (err) {
    console.error('[TideData] Failed to load agents:', err);
  }

  return [];
}

/**
 * Save agents to disk
 */
export function saveAgents(agents: Agent[]): void {
  ensureDataDir();

  try {
    // Convert to stored format (remove runtime-only fields)
    const storedAgents: StoredAgent[] = agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      class: agent.class,
      position: agent.position,
      tmuxSession: agent.tmuxSession,
      cwd: agent.cwd,
      tokensUsed: agent.tokensUsed,
      contextUsed: agent.contextUsed,
      contextLimit: agent.contextLimit,
      createdAt: agent.createdAt,
      lastActivity: agent.lastActivity,
      sessionId: agent.sessionId,
      currentTask: agent.currentTask,
    }));

    const data: TideData = {
      agents: storedAgents,
      savedAt: Date.now(),
      version: '1.0.0',
    };

    fs.writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[TideData] Failed to save agents:', err);
  }
}

/**
 * Load drawing areas from disk
 */
export function loadAreas(): DrawingArea[] {
  ensureDataDir();

  try {
    if (fs.existsSync(AREAS_FILE)) {
      const data = JSON.parse(fs.readFileSync(AREAS_FILE, 'utf-8'));
      return data.areas || [];
    }
  } catch (err) {
    console.error('[TideData] Failed to load areas:', err);
  }

  return [];
}

/**
 * Save drawing areas to disk
 */
export function saveAreas(areas: DrawingArea[]): void {
  ensureDataDir();

  try {
    const data = {
      areas,
      savedAt: Date.now(),
    };
    fs.writeFileSync(AREAS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[TideData] Failed to save areas:', err);
  }
}

/**
 * Update a single agent's session ID
 */
export function updateAgentSession(agentId: string, sessionId: string): void {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === agentId);

  if (agent) {
    agent.lastSessionId = agent.sessionId;
    agent.sessionId = sessionId;
    // Re-save with proper typing - ensure context fields have defaults
    // Note: pendingCommands is runtime-only and initialized to [] when loaded
    saveAgents(agents.map(a => ({
      ...a,
      status: 'offline' as const,
      contextUsed: a.contextUsed ?? 0,
      contextLimit: a.contextLimit ?? 200000,
      taskCount: a.taskCount ?? 0,
      pendingCommands: [], // Runtime-only, always empty when saved
    })));
  }
}

/**
 * Get the data directory path (for UI display)
 */
export function getDataDir(): string {
  return DATA_DIR;
}

/**
 * Get Claude's project directory for a cwd
 */
export function getClaudeProjectDir(cwd: string): string {
  const encoded = cwd.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

// ============================================================================
// Supervisor History Persistence
// ============================================================================

interface SupervisorHistoryData {
  histories: Record<string, AgentSupervisorHistoryEntry[]>;
  savedAt: number;
  version: string;
}

/**
 * Load all supervisor history from disk
 */
export function loadSupervisorHistory(): Map<string, AgentSupervisorHistoryEntry[]> {
  ensureDataDir();

  try {
    if (fs.existsSync(SUPERVISOR_HISTORY_FILE)) {
      const data: SupervisorHistoryData = JSON.parse(fs.readFileSync(SUPERVISOR_HISTORY_FILE, 'utf-8'));
      console.log(`[TideData] Loaded supervisor history for ${Object.keys(data.histories).length} agents`);
      return new Map(Object.entries(data.histories));
    }
  } catch (err) {
    console.error('[TideData] Failed to load supervisor history:', err);
  }

  return new Map();
}

/**
 * Save supervisor history to disk
 */
export function saveSupervisorHistory(histories: Map<string, AgentSupervisorHistoryEntry[]>): void {
  ensureDataDir();

  try {
    const data: SupervisorHistoryData = {
      histories: Object.fromEntries(histories),
      savedAt: Date.now(),
      version: '1.0.0',
    };

    fs.writeFileSync(SUPERVISOR_HISTORY_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[TideData] Failed to save supervisor history:', err);
  }
}

/**
 * Add a history entry for an agent
 */
export function addSupervisorHistoryEntry(
  histories: Map<string, AgentSupervisorHistoryEntry[]>,
  agentId: string,
  entry: AgentSupervisorHistoryEntry
): void {
  let agentHistory = histories.get(agentId);
  if (!agentHistory) {
    agentHistory = [];
    histories.set(agentId, agentHistory);
  }

  // Add to beginning (most recent first)
  agentHistory.unshift(entry);

  // Trim to max entries
  if (agentHistory.length > MAX_HISTORY_PER_AGENT) {
    agentHistory.pop();
  }
}

/**
 * Get supervisor history for a specific agent
 */
export function getAgentSupervisorHistory(
  histories: Map<string, AgentSupervisorHistoryEntry[]>,
  agentId: string
): AgentSupervisorHistory {
  return {
    agentId,
    entries: histories.get(agentId) || [],
  };
}

/**
 * Delete supervisor history for an agent (when agent is deleted)
 */
export function deleteSupervisorHistory(
  histories: Map<string, AgentSupervisorHistoryEntry[]>,
  agentId: string
): void {
  histories.delete(agentId);
}
