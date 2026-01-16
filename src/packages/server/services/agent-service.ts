/**
 * Agent Service
 * Business logic for managing agents
 */

import * as fs from 'fs';
import type { Agent, AgentClass } from '../../shared/types.js';
import { loadAgents, saveAgents, getDataDir } from '../data/index.js';
import {
  listSessions,
  getSessionSummary,
  loadSession,
  loadToolHistory,
  searchSession,
} from '../claude/session-loader.js';

// In-memory agent storage
const agents = new Map<string, Agent>();

// Listeners for agent changes
type AgentListener = (event: string, agent: Agent | string) => void;
const listeners = new Set<AgentListener>();

// ============================================================================
// Initialization
// ============================================================================

export function initAgents(): void {
  try {
    const storedAgents = loadAgents();
    for (const stored of storedAgents) {
      const agent: Agent = {
        ...stored,
        status: 'idle', // Ready to receive commands
        // Clear runtime state on server restart - we don't know if tasks are still valid
        currentTask: undefined,
        currentTool: undefined,
        // Ensure context fields have defaults (migration for existing agents)
        contextUsed: stored.contextUsed ?? 0,
        contextLimit: stored.contextLimit ?? 200000,
        taskCount: stored.taskCount ?? 0, // Migration for existing agents
        // Initialize empty pending commands queue
        pendingCommands: [],
      };
      agents.set(agent.id, agent);
    }
    console.log(`[AgentService] Loaded ${agents.size} agents from ${getDataDir()}`);
  } catch (err) {
    console.error('[AgentService] Failed to load agents:', err);
  }
}

export function persistAgents(): void {
  try {
    saveAgents(Array.from(agents.values()));
  } catch (err) {
    console.error('[AgentService] Failed to save agents:', err);
  }
}

// ============================================================================
// Event System
// ============================================================================

export function subscribe(listener: AgentListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, data: Agent | string): void {
  listeners.forEach((listener) => listener(event, data));
}

// ============================================================================
// Agent CRUD
// ============================================================================

export function getAgent(id: string): Agent | undefined {
  return agents.get(id);
}

export function getAllAgents(): Agent[] {
  return Array.from(agents.values());
}

export async function createAgent(
  name: string,
  agentClass: AgentClass,
  cwd: string,
  position?: { x: number; y: number; z: number },
  sessionId?: string,
  useChrome?: boolean
): Promise<Agent> {
  const id = generateId();

  // Validate cwd
  if (!fs.existsSync(cwd)) {
    throw new Error(`Directory does not exist: ${cwd}`);
  }

  // Create agent object
  // SessionId can be provided to link to an existing Claude session
  const agent: Agent = {
    id,
    name,
    class: agentClass,
    status: 'idle',
    position: position || {
      x: Math.random() * 10 - 5,
      y: 0,
      z: Math.random() * 10 - 5,
    },
    tmuxSession: `tide-${id}`,
    cwd,
    useChrome,
    tokensUsed: 0,
    contextUsed: 0,
    contextLimit: 200000, // Claude's default context limit
    taskCount: 0, // Initialize task counter
    pendingCommands: [], // Initialize empty command queue
    createdAt: Date.now(),
    lastActivity: Date.now(),
    sessionId: sessionId,
  };

  agents.set(id, agent);
  persistAgents();

  console.log(`[AgentService] Agent ${name} (${id}) created in ${cwd}`);

  emit('created', agent);
  return agent;
}

export function updateAgent(id: string, updates: Partial<Agent>, updateActivity = true): Agent | null {
  const agent = agents.get(id);
  if (!agent) return null;

  // Only update lastActivity for real activity (not position changes, etc.)
  if (updateActivity) {
    Object.assign(agent, updates, { lastActivity: Date.now() });
  } else {
    Object.assign(agent, updates);
  }
  agents.set(id, agent);
  persistAgents();

  emit('updated', agent);
  return agent;
}

export function deleteAgent(id: string): boolean {
  const agent = agents.get(id);
  if (!agent) return false;

  agents.delete(id);
  persistAgents();

  emit('deleted', id);
  return true;
}

// ============================================================================
// Session Operations
// ============================================================================

export async function getAgentSessions(agentId: string) {
  const agent = agents.get(agentId);
  if (!agent) return null;

  const sessions = await listSessions(agent.cwd);
  return {
    sessions,
    currentSessionId: agent.sessionId,
    summary: getSessionSummary(sessions),
  };
}

export async function getAgentHistory(agentId: string, limit: number = 50, offset: number = 0) {
  const agent = agents.get(agentId);
  console.log(`[AgentService] getAgentHistory called for agentId=${agentId}, agent found: ${!!agent}`);
  if (!agent) return null;

  console.log(`[AgentService] Agent ${agent.name} (${agentId}): sessionId=${agent.sessionId}, cwd=${agent.cwd}`);

  if (!agent.sessionId) {
    console.log(`[AgentService] No sessionId for agent ${agentId}, returning empty`);
    return { messages: [], sessionId: null, totalCount: 0, hasMore: false };
  }

  const history = await loadSession(agent.cwd, agent.sessionId, limit, offset);
  console.log(`[AgentService] Loaded ${history?.messages.length || 0} messages for agent ${agentId} from session ${agent.sessionId}`);
  return {
    sessionId: agent.sessionId,
    messages: history?.messages || [],
    cwd: agent.cwd,
    totalCount: history?.totalCount || 0,
    hasMore: history?.hasMore || false,
  };
}

export async function getAllToolHistory(limit: number = 100) {
  const allToolExecutions: Array<{
    agentId: string;
    agentName: string;
    toolName: string;
    timestamp: number;
  }> = [];
  const allFileChanges: Array<{
    agentId: string;
    agentName: string;
    action: 'created' | 'modified' | 'deleted' | 'read';
    filePath: string;
    timestamp: number;
  }> = [];

  // Load tool history for each agent that has a session
  for (const agent of agents.values()) {
    if (!agent.sessionId) continue;

    try {
      const { toolExecutions, fileChanges } = await loadToolHistory(
        agent.cwd,
        agent.sessionId,
        agent.id,
        agent.name,
        limit
      );
      allToolExecutions.push(...toolExecutions);
      allFileChanges.push(...fileChanges);
    } catch (err) {
      console.error(`[AgentService] Failed to load tool history for ${agent.name}:`, err);
    }
  }

  // Sort by timestamp (newest first) and limit
  allToolExecutions.sort((a, b) => b.timestamp - a.timestamp);
  allFileChanges.sort((a, b) => b.timestamp - a.timestamp);

  return {
    toolExecutions: allToolExecutions.slice(0, limit),
    fileChanges: allFileChanges.slice(0, limit),
  };
}

export async function searchAgentHistory(agentId: string, query: string, limit: number = 50) {
  const agent = agents.get(agentId);
  if (!agent) return null;

  if (!agent.sessionId) {
    return { matches: [], totalMatches: 0 };
  }

  const result = await searchSession(agent.cwd, agent.sessionId, query, limit);
  return result || { matches: [], totalMatches: 0 };
}

// ============================================================================
// Utilities
// ============================================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}
