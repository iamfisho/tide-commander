import type {
  Agent,
  AgentClass,
  ClientMessage,
  DrawingArea,
  DrawingTool,
  ActivityNarrative,
  SupervisorReport,
  SupervisorConfig,
  AgentSupervisorHistory,
  AgentSupervisorHistoryEntry,
} from '../../shared/types';

// Activity type
export interface Activity {
  agentId: string;
  agentName: string;
  message: string;
  timestamp: number;
}

// Claude output entry
export interface ClaudeOutput {
  text: string;
  isStreaming: boolean;
  timestamp: number;
  isUserPrompt?: boolean; // True if this is a user-sent command
}

// Tool execution entry
export interface ToolExecution {
  agentId: string;
  agentName: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  timestamp: number;
}

// File change entry
export interface FileChange {
  agentId: string;
  agentName: string;
  action: 'created' | 'modified' | 'deleted' | 'read';
  filePath: string;
  timestamp: number;
}

// Last prompt entry
export interface LastPrompt {
  text: string;
  timestamp: number;
}

// Settings
export interface Settings {
  historyLimit: number;
  hideCost: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  historyLimit: 500,
  hideCost: true,
};

// Supervisor state
export interface SupervisorState {
  enabled: boolean;
  lastReport: SupervisorReport | null;
  narratives: Map<string, ActivityNarrative[]>;
  lastReportTime: number | null;
  nextReportTime: number | null;
  // History per agent - loaded on demand when agent is selected
  agentHistories: Map<string, AgentSupervisorHistoryEntry[]>;
  // Track which agent's history is currently being loaded
  loadingHistoryForAgent: string | null;
  // Track if a report is being generated
  generatingReport: boolean;
}

// Store state
export interface StoreState {
  agents: Map<string, Agent>;
  selectedAgentIds: Set<string>;
  activities: Activity[];
  isConnected: boolean;
  // Drawing areas
  areas: Map<string, DrawingArea>;
  activeTool: DrawingTool;
  selectedAreaId: string | null;
  // Claude outputs per agent
  agentOutputs: Map<string, ClaudeOutput[]>;
  // Last prompt per agent
  lastPrompts: Map<string, LastPrompt>;
  // Tool execution history
  toolExecutions: ToolExecution[];
  // File changes history
  fileChanges: FileChange[];
  // Terminal open state
  terminalOpen: boolean;
  // Settings
  settings: Settings;
  // File viewer path (to open files from other components)
  fileViewerPath: string | null;
  // Supervisor state
  supervisor: SupervisorState;
}

// Store actions
type Listener = () => void;

// localStorage keys
const SETTINGS_STORAGE_KEY = 'tide-commander-settings';

class Store {
  private state: StoreState = {
    agents: new Map(),
    selectedAgentIds: new Set(),
    activities: [],
    isConnected: false,
    // Drawing areas
    areas: new Map(),
    activeTool: null,
    selectedAreaId: null,
    // Claude outputs
    agentOutputs: new Map(),
    // Last prompts
    lastPrompts: new Map(),
    // Tool and file histories
    toolExecutions: [],
    fileChanges: [],
    // Terminal state
    terminalOpen: false,
    // Settings - load from localStorage or use defaults
    settings: (() => {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
        }
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
      return { ...DEFAULT_SETTINGS };
    })(),
    // File viewer path
    fileViewerPath: null,
    // Supervisor state
    supervisor: {
      enabled: true,
      lastReport: null,
      narratives: new Map(),
      lastReportTime: null,
      nextReportTime: null,
      agentHistories: new Map(),
      loadingHistoryForAgent: null,
      generatingReport: false,
    },
  };

  private listeners = new Set<Listener>();
  private sendMessage: ((msg: ClientMessage) => void) | null = null;

  // Subscribe to state changes
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Notify all listeners
  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  // Get current state
  getState(): StoreState {
    return this.state;
  }

  // Set WebSocket send function
  setSendMessage(fn: (msg: ClientMessage) => void): void {
    this.sendMessage = fn;
  }

  // Connection state
  setConnected(isConnected: boolean): void {
    this.state.isConnected = isConnected;
    this.notify();
  }

  // Agent management
  setAgents(agentList: Agent[]): void {
    // Create a new Map to ensure React detects the change
    const newAgents = new Map<string, Agent>();
    for (const agent of agentList) {
      newAgents.set(agent.id, agent);
    }
    this.state.agents = newAgents;
    this.notify();
  }

  addAgent(agent: Agent): void {
    // Create a new Map to ensure React detects the change
    const newAgents = new Map(this.state.agents);
    newAgents.set(agent.id, agent);
    this.state.agents = newAgents;
    this.notify();
  }

  updateAgent(agent: Agent): void {
    // Create a new Map to ensure React detects the change
    const newAgents = new Map(this.state.agents);
    newAgents.set(agent.id, agent);
    this.state.agents = newAgents;
    this.notify();
  }

  removeAgent(agentId: string): void {
    // Create a new Map to ensure React detects the change
    const newAgents = new Map(this.state.agents);
    newAgents.delete(agentId);
    this.state.agents = newAgents;
    this.state.selectedAgentIds.delete(agentId);
    this.notify();
  }

  // Selection management
  selectAgent(agentId: string | null): void {
    this.state.selectedAgentIds.clear();
    if (agentId) {
      this.state.selectedAgentIds.add(agentId);
    }
    this.notify();
  }

  addToSelection(agentId: string): void {
    if (this.state.selectedAgentIds.has(agentId)) {
      this.state.selectedAgentIds.delete(agentId);
    } else {
      this.state.selectedAgentIds.add(agentId);
    }
    this.notify();
  }

  selectMultiple(agentIds: string[]): void {
    this.state.selectedAgentIds.clear();
    for (const id of agentIds) {
      this.state.selectedAgentIds.add(id);
    }
    this.notify();
  }

  deselectAll(): void {
    this.state.selectedAgentIds.clear();
    this.notify();
  }

  // Terminal state
  toggleTerminal(agentId?: string): void {
    // If an agentId is provided, make sure it's selected first
    if (agentId && !this.state.selectedAgentIds.has(agentId)) {
      this.state.selectedAgentIds.clear();
      this.state.selectedAgentIds.add(agentId);
    }
    this.state.terminalOpen = !this.state.terminalOpen;
    this.notify();
  }

  setTerminalOpen(open: boolean): void {
    this.state.terminalOpen = open;
    this.notify();
  }

  // File viewer
  setFileViewerPath(path: string | null): void {
    this.state.fileViewerPath = path;
    this.notify();
  }

  clearFileViewerPath(): void {
    this.state.fileViewerPath = null;
    this.notify();
  }

  // ===== Supervisor =====

  setSupervisorReport(report: SupervisorReport): void {
    this.state.supervisor.lastReport = report;
    this.state.supervisor.lastReportTime = report.timestamp;

    // Also update agent histories with the new report data
    const newHistories = new Map(this.state.supervisor.agentHistories);
    for (const analysis of report.agentSummaries) {
      const agentHistory = newHistories.get(analysis.agentId) || [];
      // Create a new history entry from the report
      const newEntry: AgentSupervisorHistoryEntry = {
        id: `${report.id}-${analysis.agentId}`,
        timestamp: report.timestamp,
        reportId: report.id,
        analysis,
      };
      // Add to beginning (most recent first), avoid duplicates
      if (!agentHistory.some(e => e.reportId === report.id)) {
        const updatedHistory = [newEntry, ...agentHistory];
        // Keep max 50 entries
        if (updatedHistory.length > 50) {
          updatedHistory.pop();
        }
        newHistories.set(analysis.agentId, updatedHistory);
      }
    }
    this.state.supervisor.agentHistories = newHistories;
    this.state.supervisor.generatingReport = false;

    this.notify();
  }

  addNarrative(agentId: string, narrative: ActivityNarrative): void {
    const agentNarratives = this.state.supervisor.narratives.get(agentId) || [];
    agentNarratives.unshift(narrative);
    if (agentNarratives.length > 50) {
      agentNarratives.pop();
    }
    // Create new Map to trigger React updates
    const newNarratives = new Map(this.state.supervisor.narratives);
    newNarratives.set(agentId, agentNarratives);
    this.state.supervisor.narratives = newNarratives;
    this.notify();
  }

  getNarratives(agentId: string): ActivityNarrative[] {
    return this.state.supervisor.narratives.get(agentId) || [];
  }

  setSupervisorStatus(status: {
    enabled: boolean;
    lastReportTime: number | null;
    nextReportTime: number | null;
  }): void {
    this.state.supervisor.enabled = status.enabled;
    this.state.supervisor.lastReportTime = status.lastReportTime;
    this.state.supervisor.nextReportTime = status.nextReportTime;
    this.notify();
  }

  setSupervisorConfig(config: Partial<SupervisorConfig>): void {
    this.sendMessage?.({
      type: 'set_supervisor_config',
      payload: config,
    });
  }

  requestSupervisorReport(): void {
    this.state.supervisor.generatingReport = true;
    this.notify();
    this.sendMessage?.({
      type: 'request_supervisor_report',
      payload: {},
    });
  }

  // Request supervisor history for a specific agent
  requestAgentSupervisorHistory(agentId: string): void {
    this.state.supervisor.loadingHistoryForAgent = agentId;
    this.notify();
    this.sendMessage?.({
      type: 'request_agent_supervisor_history',
      payload: { agentId },
    });
  }

  // Set supervisor history for an agent (called when receiving from server)
  setAgentSupervisorHistory(history: AgentSupervisorHistory): void {
    const newHistories = new Map(this.state.supervisor.agentHistories);
    newHistories.set(history.agentId, history.entries);
    this.state.supervisor.agentHistories = newHistories;
    if (this.state.supervisor.loadingHistoryForAgent === history.agentId) {
      this.state.supervisor.loadingHistoryForAgent = null;
    }
    this.notify();
  }

  // Get supervisor history for an agent (from local cache)
  getAgentSupervisorHistory(agentId: string): AgentSupervisorHistoryEntry[] {
    return this.state.supervisor.agentHistories.get(agentId) || [];
  }

  // Check if history is being loaded for an agent
  isLoadingHistoryForAgent(agentId: string): boolean {
    return this.state.supervisor.loadingHistoryForAgent === agentId;
  }

  // Settings
  updateSettings(updates: Partial<Settings>): void {
    this.state.settings = { ...this.state.settings, ...updates };
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.state.settings));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
    this.notify();
  }

  getSettings(): Settings {
    return this.state.settings;
  }

  // Activity feed
  addActivity(activity: Activity): void {
    this.state.activities.unshift(activity);
    if (this.state.activities.length > 100) {
      this.state.activities.pop();
    }
    this.notify();
  }

  // Tool execution tracking
  addToolExecution(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    const agent = this.state.agents.get(agentId);
    this.state.toolExecutions.unshift({
      agentId,
      agentName: agent?.name || 'Unknown',
      toolName,
      toolInput,
      timestamp: Date.now(),
    });
    // Keep last 200 tool executions
    if (this.state.toolExecutions.length > 200) {
      this.state.toolExecutions.pop();
    }
    this.notify();
  }

  // File change tracking
  addFileChange(agentId: string, action: 'created' | 'modified' | 'deleted' | 'read', filePath: string): void {
    const agent = this.state.agents.get(agentId);
    this.state.fileChanges.unshift({
      agentId,
      agentName: agent?.name || 'Unknown',
      action,
      filePath,
      timestamp: Date.now(),
    });
    // Keep last 200 file changes
    if (this.state.fileChanges.length > 200) {
      this.state.fileChanges.pop();
    }
    this.notify();
  }

  // Load tool history from server (for page refresh)
  async loadToolHistory(): Promise<void> {
    try {
      const res = await fetch('http://localhost:5174/api/agents/tool-history?limit=100');
      const data = await res.json();

      if (data.toolExecutions) {
        this.state.toolExecutions = data.toolExecutions;
      }
      if (data.fileChanges) {
        this.state.fileChanges = data.fileChanges;
      }
      this.notify();
    } catch (err) {
      console.error('[Store] Failed to load tool history:', err);
    }
  }

  // Claude output management
  addOutput(agentId: string, output: ClaudeOutput): void {
    let outputs = this.state.agentOutputs.get(agentId);
    if (!outputs) {
      outputs = [];
      this.state.agentOutputs.set(agentId, outputs);
    }
    outputs.push(output);
    // Keep last 200 outputs per agent
    if (outputs.length > 200) {
      outputs.shift();
    }
    this.notify();
  }

  clearOutputs(agentId: string): void {
    this.state.agentOutputs.delete(agentId);
    this.notify();
  }

  getOutputs(agentId: string): ClaudeOutput[] {
    return this.state.agentOutputs.get(agentId) || [];
  }

  // Actions that send to server
  spawnAgent(
    name: string,
    agentClass: AgentClass,
    cwd: string,
    position?: { x: number; z: number },
    sessionId?: string,
    useChrome?: boolean
  ): void {
    const pos3d = position ? { x: position.x, y: 0, z: position.z } : undefined;
    this.sendMessage?.({
      type: 'spawn_agent',
      payload: { name, class: agentClass, cwd, position: pos3d, sessionId, useChrome },
    });
  }

  createDirectoryAndSpawn(path: string, name: string, agentClass: AgentClass): void {
    this.sendMessage?.({
      type: 'create_directory',
      payload: { path, name, class: agentClass },
    });
  }

  sendCommand(agentId: string, command: string): void {
    // Track last prompt
    this.state.lastPrompts.set(agentId, {
      text: command,
      timestamp: Date.now(),
    });
    this.notify();

    // Note: User prompt is added to output when the server confirms execution starts
    // This way queued commands only appear when they're actually consumed

    this.sendMessage?.({
      type: 'send_command',
      payload: { agentId, command },
    });
  }

  // Called when server confirms a command started executing
  addUserPromptToOutput(agentId: string, command: string): void {
    this.addOutput(agentId, {
      text: command,
      isStreaming: false,
      timestamp: Date.now(),
      isUserPrompt: true,
    });
  }

  getLastPrompt(agentId: string): LastPrompt | undefined {
    return this.state.lastPrompts.get(agentId);
  }

  setLastPrompt(agentId: string, text: string): void {
    this.state.lastPrompts.set(agentId, {
      text,
      timestamp: Date.now(),
    });
    this.notify();
  }

  // Update pending commands queue for an agent
  updatePendingCommands(agentId: string, pendingCommands: string[]): void {
    const agent = this.state.agents.get(agentId);
    if (agent) {
      const updatedAgent = { ...agent, pendingCommands };
      const newAgents = new Map(this.state.agents);
      newAgents.set(agentId, updatedAgent);
      this.state.agents = newAgents;
      this.notify();
    }
  }

  moveAgent(agentId: string, position: { x: number; y: number; z: number }): void {
    // Update local state with new Map to trigger React updates
    const agent = this.state.agents.get(agentId);
    if (agent) {
      const updatedAgent = { ...agent, position };
      const newAgents = new Map(this.state.agents);
      newAgents.set(agentId, updatedAgent);
      this.state.agents = newAgents;
      this.notify();
    }

    // Send to server
    this.sendMessage?.({
      type: 'move_agent',
      payload: { agentId, position },
    });
  }

  killAgent(agentId: string): void {
    this.sendMessage?.({
      type: 'kill_agent',
      payload: { agentId },
    });
  }

  // Stop current operation (but keep agent alive)
  stopAgent(agentId: string): void {
    this.sendMessage?.({
      type: 'stop_agent',
      payload: { agentId },
    });
  }

  // Remove agent from UI and persistence (keeps Claude session running)
  removeAgentFromServer(agentId: string): void {
    this.sendMessage?.({
      type: 'remove_agent',
      payload: { agentId },
    });
  }

  // Rename agent
  renameAgent(agentId: string, name: string): void {
    // Update local state immediately for responsive UI
    const agent = this.state.agents.get(agentId);
    if (agent) {
      const updatedAgent = { ...agent, name };
      const newAgents = new Map(this.state.agents);
      newAgents.set(agentId, updatedAgent);
      this.state.agents = newAgents;
      this.notify();
    }

    // Send to server
    this.sendMessage?.({
      type: 'rename_agent',
      payload: { agentId, name },
    });
  }

  // Computed values
  getTotalTokens(): number {
    let total = 0;
    for (const agent of this.state.agents.values()) {
      total += agent.tokensUsed;
    }
    return total;
  }

  getSelectedAgents(): Agent[] {
    const agents: Agent[] = [];
    for (const id of this.state.selectedAgentIds) {
      const agent = this.state.agents.get(id);
      if (agent) agents.push(agent);
    }
    return agents;
  }

  // ===== Drawing Areas =====

  // Set active drawing tool
  setActiveTool(tool: DrawingTool): void {
    this.state.activeTool = tool;
    if (tool !== 'select') {
      this.state.selectedAreaId = null;
    }
    this.notify();
  }

  // Select area for editing
  selectArea(areaId: string | null): void {
    this.state.selectedAreaId = areaId;
    this.notify();
  }

  // Add new area
  addArea(area: DrawingArea): void {
    this.state.areas.set(area.id, area);
    this.syncAreasToServer();
    this.notify();
  }

  // Update existing area
  updateArea(areaId: string, updates: Partial<DrawingArea>): void {
    const area = this.state.areas.get(areaId);
    if (area) {
      Object.assign(area, updates);
      this.syncAreasToServer();
      this.notify();
    }
  }

  // Delete area
  deleteArea(areaId: string): void {
    this.state.areas.delete(areaId);
    if (this.state.selectedAreaId === areaId) {
      this.state.selectedAreaId = null;
    }
    this.syncAreasToServer();
    this.notify();
  }

  // Assign agent to area
  assignAgentToArea(agentId: string, areaId: string): void {
    const area = this.state.areas.get(areaId);
    if (area && !area.assignedAgentIds.includes(agentId)) {
      // Remove from any other area first
      for (const otherArea of this.state.areas.values()) {
        const idx = otherArea.assignedAgentIds.indexOf(agentId);
        if (idx !== -1) {
          otherArea.assignedAgentIds.splice(idx, 1);
        }
      }
      area.assignedAgentIds.push(agentId);
      this.syncAreasToServer();
      this.notify();
    }
  }

  // Unassign agent from area
  unassignAgentFromArea(agentId: string, areaId: string): void {
    const area = this.state.areas.get(areaId);
    if (area) {
      const idx = area.assignedAgentIds.indexOf(agentId);
      if (idx !== -1) {
        area.assignedAgentIds.splice(idx, 1);
        this.syncAreasToServer();
        this.notify();
      }
    }
  }

  // Add directory to area
  addDirectoryToArea(areaId: string, directoryPath: string): void {
    const area = this.state.areas.get(areaId);
    if (area && !area.directories.includes(directoryPath)) {
      area.directories.push(directoryPath);
      this.syncAreasToServer();
      this.notify();
    }
  }

  // Remove directory from area
  removeDirectoryFromArea(areaId: string, directoryPath: string): void {
    const area = this.state.areas.get(areaId);
    if (area) {
      const idx = area.directories.indexOf(directoryPath);
      if (idx !== -1) {
        area.directories.splice(idx, 1);
        this.syncAreasToServer();
        this.notify();
      }
    }
  }

  // Get all directories for an area
  getAreaDirectories(areaId: string): string[] {
    const area = this.state.areas.get(areaId);
    return area?.directories || [];
  }

  // Check if a position is inside an area
  isPositionInArea(pos: { x: number; z: number }, area: DrawingArea): boolean {
    if (area.type === 'rectangle' && area.width && area.height) {
      const halfW = area.width / 2;
      const halfH = area.height / 2;
      return (
        pos.x >= area.center.x - halfW &&
        pos.x <= area.center.x + halfW &&
        pos.z >= area.center.z - halfH &&
        pos.z <= area.center.z + halfH
      );
    } else if (area.type === 'circle' && area.radius) {
      const dx = pos.x - area.center.x;
      const dz = pos.z - area.center.z;
      return dx * dx + dz * dz <= area.radius * area.radius;
    }
    return false;
  }

  // Get area for an agent (checks actual position, not just assignment)
  getAreaForAgent(agentId: string): DrawingArea | null {
    const agent = this.state.agents.get(agentId);
    if (!agent) return null;

    // Check each area to see if agent is inside its bounds
    for (const area of this.state.areas.values()) {
      if (this.isPositionInArea({ x: agent.position.x, z: agent.position.z }, area)) {
        return area;
      }
    }
    return null;
  }

  // Sync areas to server via WebSocket
  private syncAreasToServer(): void {
    const areasArray = Array.from(this.state.areas.values());
    this.sendMessage?.({
      type: 'sync_areas',
      payload: areasArray,
    });
  }

  // Set areas from server (called when receiving areas_update message)
  setAreasFromServer(areasArray: DrawingArea[]): void {
    // Create new Map to ensure React detects the change
    const newAreas = new Map<string, DrawingArea>();
    for (const area of areasArray) {
      // Migration: ensure directories array exists for old areas
      if (!area.directories) {
        area.directories = [];
      }
      newAreas.set(area.id, area);
    }
    this.state.areas = newAreas;
    this.notify();
  }

  // ===== Status Polling =====
  // NOTE: HTTP polling is disabled - WebSocket handles all status updates now
  // The sync happens on WebSocket connect (server-side) and on agent events
  private statusPollInterval: number | null = null;

  // Start polling agent status (disabled - WebSocket handles this)
  startStatusPolling(): void {
    // Disabled: WebSocket already syncs status on connect and broadcasts updates
    // Keeping method for potential manual refresh needs
  }

  stopStatusPolling(): void {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  private async pollAgentStatus(): Promise<void> {
    try {
      const res = await fetch('http://localhost:5174/api/agents/status');
      if (!res.ok) return;

      const statuses = await res.json() as Array<{
        id: string;
        status: Agent['status'];
        currentTask?: string;
        currentTool?: string;
        isProcessRunning: boolean;
        sessionActivity?: {
          isActive: boolean;
          lastMessageType: string | null;
          secondsSinceLastActivity: number;
        } | null;
      }>;

      let changed = false;
      const newAgents = new Map(this.state.agents);

      for (const statusInfo of statuses) {
        const agent = newAgents.get(statusInfo.id);
        if (!agent) continue;

        // Check if status is out of sync
        if (agent.status !== statusInfo.status) {
          const activityInfo = statusInfo.sessionActivity
            ? `session: ${statusInfo.sessionActivity.lastMessageType}, ${statusInfo.sessionActivity.secondsSinceLastActivity}s ago`
            : 'no session';
          console.log(`[Store] Status poll correction: ${agent.name} was '${agent.status}', now '${statusInfo.status}' (process: ${statusInfo.isProcessRunning}, ${activityInfo})`);
          newAgents.set(statusInfo.id, {
            ...agent,
            status: statusInfo.status,
            currentTask: statusInfo.currentTask,
            currentTool: statusInfo.currentTool,
          });
          changed = true;
        }
      }

      if (changed) {
        this.state.agents = newAgents;
        this.notify();
      }
    } catch (err) {
      // Silently fail - this is just a fallback
    }
  }
}

// Singleton store instance
export const store = new Store();

// React hook for using the store
export function useStore(): StoreState {
  const [, forceUpdate] = React.useState({});

  React.useEffect(() => {
    return store.subscribe(() => forceUpdate({}));
  }, []);

  return store.getState();
}

// Import React for the hook
import React from 'react';
