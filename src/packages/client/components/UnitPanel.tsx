import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useStore, store } from '../store';
import { AGENT_CLASS_CONFIG } from '../scene/config';
import { formatNumber, intToHex, formatTokens, formatTimeAgo, formatIdleTime, getIdleTimerColor, filterCostText } from '../utils/formatting';
import { ModelPreview } from './ModelPreview';
import type { Agent, DrawingArea, AgentSupervisorHistoryEntry } from '../../shared/types';

// Progress indicator colors (used by supervisor status components)
const PROGRESS_COLORS: Record<string, string> = {
  on_track: '#4aff9e',
  stalled: '#ff9e4a',
  blocked: '#ff4a4a',
  completed: '#4a9eff',
  idle: '#888888',
};

interface UnitPanelProps {
  onFocusAgent: (agentId: string) => void;
  onKillAgent: (agentId: string) => void;
  onOpenAreaExplorer?: (areaId: string) => void;
}

export function UnitPanel({ onFocusAgent, onKillAgent, onOpenAreaExplorer }: UnitPanelProps) {
  const state = useStore();
  const selectedAgents = store.getSelectedAgents();

  if (state.selectedAgentIds.size === 0) {
    return <AgentsList onOpenAreaExplorer={onOpenAreaExplorer} />;
  }

  if (state.selectedAgentIds.size === 1) {
    const agent = selectedAgents[0];
    if (!agent) return <AgentsList onOpenAreaExplorer={onOpenAreaExplorer} />;
    return (
      <SingleAgentPanel
        agent={agent}
        onFocusAgent={onFocusAgent}
        onKillAgent={onKillAgent}
        onOpenAreaExplorer={onOpenAreaExplorer}
      />
    );
  }

  return <MultiAgentPanel agents={selectedAgents} />;
}

interface AgentsListProps {
  onOpenAreaExplorer?: (areaId: string) => void;
}

function AgentsList({ onOpenAreaExplorer }: AgentsListProps) {
  const state = useStore();
  const [addingDirToArea, setAddingDirToArea] = useState<string | null>(null);
  const [newDirPath, setNewDirPath] = useState('');
  const agentsArray = Array.from(state.agents.values());
  const areasArray = Array.from(state.areas.values());

  // Create a stable key for agent IDs to avoid re-running effect on every render
  const agentIds = useMemo(() => agentsArray.map(a => a.id).sort().join(','), [agentsArray]);

  // Track which agents we've already requested history for (avoid duplicate requests)
  const requestedHistoryRef = useRef<Set<string>>(new Set());

  // Request supervisor history for all agents that don't have it yet (only once per agent)
  useEffect(() => {
    for (const agent of agentsArray) {
      // Skip if we've already requested this agent's history
      if (requestedHistoryRef.current.has(agent.id)) continue;

      const history = store.getAgentSupervisorHistory(agent.id);
      if (history.length === 0 && !store.isLoadingHistoryForAgent(agent.id)) {
        requestedHistoryRef.current.add(agent.id);
        store.requestAgentSupervisorHistory(agent.id);
      }
    }
  }, [agentIds]);

  // Group agents by area
  const agentsByArea = new Map<string | null, Agent[]>();

  for (const agent of agentsArray) {
    const area = store.getAreaForAgent(agent.id);
    const areaId = area?.id || null;
    if (!agentsByArea.has(areaId)) {
      agentsByArea.set(areaId, []);
    }
    agentsByArea.get(areaId)!.push(agent);
  }

  // Make sure all areas are included (even empty ones)
  for (const area of areasArray) {
    if (!agentsByArea.has(area.id)) {
      agentsByArea.set(area.id, []);
    }
  }

  // Sort: areas first (alphabetically), then unassigned
  const sortedAreaIds = Array.from(agentsByArea.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const areaA = state.areas.get(a);
    const areaB = state.areas.get(b);
    return (areaA?.name || '').localeCompare(areaB?.name || '');
  });

  const handleAddDirectory = (areaId: string) => {
    if (newDirPath.trim()) {
      store.addDirectoryToArea(areaId, newDirPath.trim());
      setNewDirPath('');
      setAddingDirToArea(null);
    }
  };

  const handleRemoveDirectory = (areaId: string, dirPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    store.removeDirectoryFromArea(areaId, dirPath);
  };

  // Show empty state only if no agents AND no areas
  if (agentsArray.length === 0 && areasArray.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">⚔️</div>
        <div className="empty-state-title">No Agents Deployed</div>
        <div className="empty-state-desc">Click "+ New Agent" to deploy your first agent</div>
      </div>
    );
  }

  return (
    <div className="agents-list">
      <div className="agents-list-header">Areas & Agents</div>
      {sortedAreaIds.map((areaId) => {
        const agents = agentsByArea.get(areaId)!;
        const area = areaId ? state.areas.get(areaId) : null;

        return (
          <div key={areaId || 'unassigned'} className="agents-group">
            <div
              className="agents-group-header"
              style={area ? {
                borderLeftColor: area.color,
                background: `${area.color}15`
              } : undefined}
            >
              {area ? (
                <>
                  <span className="agents-group-dot" style={{ background: area.color }} />
                  <span className="agents-group-name">{area.name}</span>
                  {area.directories.length > 0 && (
                    <button
                      className="area-browse-btn"
                      onClick={() => onOpenAreaExplorer?.(area.id)}
                      title="Browse files"
                    >
                      📂
                    </button>
                  )}
                </>
              ) : (
                <span className="agents-group-name unassigned">Unassigned</span>
              )}
              <span className="agents-group-count">{agents.length}</span>
            </div>

            {/* Directory list for areas */}
            {area && (
              <div className="area-directories-compact" style={{ background: `${area.color}08` }}>
                {area.directories.map((dir) => (
                  <div
                    key={dir}
                    className="area-dir-item"
                    onClick={() => onOpenAreaExplorer?.(area.id)}
                    title={dir}
                  >
                    <span className="area-dir-icon">📁</span>
                    <span className="area-dir-path">{dir.split('/').pop() || dir}</span>
                    <button
                      className="area-dir-remove"
                      onClick={(e) => handleRemoveDirectory(area.id, dir, e)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {addingDirToArea === area.id ? (
                  <div className="area-add-dir-inline">
                    <input
                      type="text"
                      className="area-add-dir-input"
                      placeholder="/path/to/dir"
                      value={newDirPath}
                      onChange={(e) => setNewDirPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddDirectory(area.id);
                        if (e.key === 'Escape') {
                          setAddingDirToArea(null);
                          setNewDirPath('');
                        }
                      }}
                      autoFocus
                    />
                    <button
                      className="area-add-dir-confirm"
                      onClick={() => handleAddDirectory(area.id)}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    className="area-add-dir-btn-compact"
                    onClick={() => setAddingDirToArea(area.id)}
                  >
                    + Add Directory
                  </button>
                )}
              </div>
            )}

            {agents.length > 0 && (
              <div
                className="agents-group-items"
                style={area ? { background: `${area.color}08` } : undefined}
              >
                {agents.map((agent) => (
                  <AgentListItem key={agent.id} agent={agent} area={area} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Global Supervisor Status - show latest status for all agents from history */}
      {agentsArray.length > 0 && (
        <GlobalSupervisorStatus agents={agentsArray} />
      )}
    </div>
  );
}

interface AgentListItemProps {
  agent: Agent;
  area?: DrawingArea | null;
}

function AgentListItem({ agent, area }: AgentListItemProps) {
  const state = useStore();
  const classConfig = AGENT_CLASS_CONFIG[agent.class];
  const isSelected = state.selectedAgentIds.has(agent.id);
  const [, setTick] = useState(0);

  // Update idle timer every second when agent is idle
  useEffect(() => {
    if (agent.status === 'idle') {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [agent.status]);

  const handleClick = () => {
    store.selectAgent(agent.id);
  };

  // Get idle timer color
  const showIdleClock = agent.status === 'idle' && agent.lastActivity > 0;
  const idleColor = agent.lastActivity > 0 ? getIdleTimerColor(agent.lastActivity) : undefined;

  // Format compact idle time (e.g., "2m", "1h")
  const formatIdleCompact = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  return (
    <div className={`agent-item ${isSelected ? 'selected' : ''}`} onClick={handleClick}>
      <div className="agent-item-icon" style={{ background: `${intToHex(classConfig.color)}20` }}>
        {classConfig.icon}
      </div>
      <div className="agent-item-info">
        <div className="agent-item-name">{agent.name}</div>
        <div className="agent-item-status">
          {agent.status}
          {agent.currentTool ? ` • ${agent.currentTool}` : ''}
          {showIdleClock && (
            <span className="agent-item-idle" style={{ color: idleColor }} title={formatIdleTime(agent.lastActivity)}>
              {' '}⏱ {formatIdleCompact(agent.lastActivity)}
            </span>
          )}
        </div>
      </div>
      <div className={`agent-status-dot ${agent.status}`}></div>
    </div>
  );
}

// Global supervisor status shown when no agent is selected
interface GlobalSupervisorStatusProps {
  agents: Agent[];
}

function GlobalSupervisorStatus({ agents }: GlobalSupervisorStatusProps) {
  const state = useStore();
  const hideCost = state.settings.hideCost;
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('tide-global-supervisor-collapsed') === 'true';
  });

  const handleToggle = () => {
    const newValue = !collapsed;
    setCollapsed(newValue);
    localStorage.setItem('tide-global-supervisor-collapsed', String(newValue));
  };

  // Format relative time
  const formatRelativeTime = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Get the most recent supervisor history entry for each agent
  const agentStatuses = useMemo(() => {
    return agents
      .map(agent => {
        const history = store.getAgentSupervisorHistory(agent.id);
        const latestEntry = history.length > 0 ? history[0] : null;
        return {
          agent,
          entry: latestEntry,
          timestamp: latestEntry?.timestamp || agent.lastActivity || 0,
        };
      })
      .filter(item => item.entry !== null)
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first
  }, [agents, state.supervisor.agentHistories]);

  // Find the most recent timestamp for the header
  const mostRecentTimestamp = agentStatuses.length > 0 ? agentStatuses[0].timestamp : Date.now();

  if (agentStatuses.length === 0) {
    return null;
  }

  return (
    <div className="global-supervisor-status">
      <div className="global-supervisor-header" onClick={handleToggle}>
        <span className="global-supervisor-toggle">{collapsed ? '▶' : '▼'}</span>
        <span className="global-supervisor-title">Supervisor Status</span>
        <span className="global-supervisor-time">{formatRelativeTime(mostRecentTimestamp)}</span>
      </div>
      {!collapsed && (
        <div className="global-supervisor-list">
          {agentStatuses.map(({ agent, entry }) => {
            const classConfig = AGENT_CLASS_CONFIG[agent.class];
            const analysis = entry!.analysis;

            return (
              <div
                key={agent.id}
                className="global-supervisor-item"
                onClick={() => store.selectAgent(agent.id)}
              >
                <div className="global-supervisor-item-header">
                  <span
                    className="global-supervisor-progress-dot"
                    style={{ background: PROGRESS_COLORS[analysis.progress] || '#888' }}
                  />
                  {classConfig && (
                    <span className="global-supervisor-agent-icon">{classConfig.icon}</span>
                  )}
                  <span className="global-supervisor-agent-name">{agent.name}</span>
                  <span className="global-supervisor-item-time">
                    {formatRelativeTime(entry!.timestamp)}
                  </span>
                </div>
                <div className="global-supervisor-status-line">
                  {filterCostText(analysis.statusDescription, hideCost)}
                </div>
                <div className="global-supervisor-summary-text">
                  {filterCostText(analysis.recentWorkSummary, hideCost)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SingleAgentPanelProps {
  agent: Agent;
  onFocusAgent: (agentId: string) => void;
  onKillAgent: (agentId: string) => void;
  onOpenAreaExplorer?: (areaId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#4aff9e',
  working: '#4a9eff',
  waiting: '#ff9e4a',
  error: '#ff4a4a',
  offline: '#888888',
};

function SingleAgentPanel({ agent, onFocusAgent, onKillAgent, onOpenAreaExplorer }: SingleAgentPanelProps) {
  const state = useStore();
  const classConfig = AGENT_CLASS_CONFIG[agent.class];
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(agent.name);
  const [, setTick] = useState(0); // For forcing re-render of idle timer
  const [showHistory, setShowHistory] = useState(true);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Get supervisor history for this agent
  const supervisorHistory = store.getAgentSupervisorHistory(agent.id);
  const isLoadingHistory = store.isLoadingHistoryForAgent(agent.id);

  // Fetch supervisor history when agent is selected (only if not already loaded/loading)
  useEffect(() => {
    if (supervisorHistory.length === 0 && !isLoadingHistory) {
      store.requestAgentSupervisorHistory(agent.id);
    }
  }, [agent.id, supervisorHistory.length, isLoadingHistory]);

  // Update editName when agent changes
  useEffect(() => {
    setEditName(agent.name);
  }, [agent.name]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Update idle timer every second when agent is idle
  useEffect(() => {
    if (agent.status === 'idle') {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [agent.status]);

  // Calculate context usage from actual contextUsed/contextLimit
  const contextPercent = useMemo(() => {
    const used = agent.contextUsed || 0;
    const limit = agent.contextLimit || 200000;
    return Math.min(100, (used / limit) * 100);
  }, [agent.contextUsed, agent.contextLimit]);

  // Get assigned area for this agent
  const assignedArea = store.getAreaForAgent(agent.id);

  // Get last output message for this agent
  const agentOutputs = state.agentOutputs.get(agent.id) || [];
  const lastOutput = agentOutputs.length > 0 ? agentOutputs[agentOutputs.length - 1] : null;

  // Get last prompt for this agent
  const lastPrompt = state.lastPrompts.get(agent.id);

  const handleKill = () => {
    if (confirm('Are you sure you want to terminate this agent?')) {
      onKillAgent(agent.id);
    }
  };

  const handleNameSave = () => {
    const trimmedName = editName.trim();
    if (trimmedName && trimmedName !== agent.name) {
      store.renameAgent(agent.id, trimmedName);
    } else {
      setEditName(agent.name);
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      setEditName(agent.name);
      setIsEditingName(false);
    }
  };

  return (
    <div className="unit-panel">
      {/* Model Preview */}
      <div className="unit-model-preview">
        <ModelPreview
          agentClass={agent.class}
          status={agent.status}
          width={80}
          height={80}
        />
      </div>

      {/* Agent Header */}
      <div className="unit-panel-header">
        <div className="unit-class-icon" style={{ background: `${intToHex(classConfig.color)}20` }}>
          {classConfig.icon}
        </div>
        <div className="unit-header-info">
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              className="unit-name-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
            />
          ) : (
            <div
              className="unit-name unit-name-editable"
              onClick={() => setIsEditingName(true)}
              title="Click to rename"
            >
              {agent.name}
            </div>
          )}
          <div className="unit-status">
            <span style={{ color: STATUS_COLORS[agent.status] }}>{agent.status}</span>
            <span> • {agent.class}</span>
          </div>
          {/* Idle timer - shows how long agent has been idle */}
          {agent.status === 'idle' && agent.lastActivity > 0 && (
            <div
              className="unit-idle-timer"
              title="Time since last activity"
              style={{ color: getIdleTimerColor(agent.lastActivity) }}
            >
              ⏱ {formatIdleTime(agent.lastActivity)}
            </div>
          )}
        </div>
        <div className="unit-header-actions">
          <button
            className="unit-action-icon"
            onClick={() => onFocusAgent(agent.id)}
            title="Focus on agent"
          >
            🎯
          </button>
          <button
            className="unit-action-icon danger"
            onClick={handleKill}
            title="Kill agent"
          >
            ☠️
          </button>
        </div>
      </div>

      {/* Assigned Area */}
      {assignedArea && (
        <div className="unit-area">
          <span className="unit-area-dot" style={{ background: assignedArea.color }} />
          <span className="unit-area-name">{assignedArea.name}</span>
        </div>
      )}

      {/* Area Directories */}
      {assignedArea && assignedArea.directories.length > 0 && (
        <div className="unit-directories">
          <div className="unit-stat-label">Folders</div>
          <div className="unit-directories-list">
            {assignedArea.directories.map((dir) => (
              <div
                key={dir}
                className="unit-directory-item clickable"
                title={`Click to browse: ${dir}`}
                onClick={() => onOpenAreaExplorer?.(assignedArea.id)}
              >
                <span className="unit-directory-icon">📁</span>
                <span className="unit-directory-path">{dir.split('/').pop() || dir}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last Prompt */}
      {lastPrompt && (
        <div className="unit-last-prompt">
          <div className="unit-stat-label">Last Prompt</div>
          <div className="unit-last-prompt-text">
            {lastPrompt.text.length > 150
              ? lastPrompt.text.slice(0, 150) + '...'
              : lastPrompt.text}
          </div>
        </div>
      )}

      {/* Last Response */}
      {lastOutput && (
        <div className="unit-last-message">
          <div className="unit-stat-label">Last Response</div>
          <div className="unit-last-message-text">
            {lastOutput.text.length > 200
              ? lastOutput.text.slice(0, 200) + '...'
              : lastOutput.text}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="unit-stats">
        <div className="unit-stat">
          <div className="unit-stat-label">Tokens</div>
          <div className="unit-stat-value">{formatTokens(agent.tokensUsed)}</div>
        </div>
        <div className="unit-stat">
          <div className="unit-stat-label">Uptime</div>
          <div className="unit-stat-value">{formatTimeAgo(agent.createdAt)}</div>
        </div>
      </div>

      {/* Context Bar */}
      <div className="unit-context">
        <div className="unit-stat-label">Context Usage</div>
        <div className="unit-context-bar">
          <div
            className="unit-context-fill"
            style={{
              width: `${contextPercent}%`,
              background:
                contextPercent > 80
                  ? '#ff4a4a'
                  : contextPercent > 50
                    ? '#ff9e4a'
                    : '#4aff9e',
            }}
          />
        </div>
        <span className="unit-context-value">{Math.round(contextPercent)}%</span>
      </div>

      {/* Current Tool */}
      {agent.currentTool && (
        <div className="unit-current-tool">
          <span className="unit-stat-label">Using:</span>
          <span className="unit-tool-name">{agent.currentTool}</span>
        </div>
      )}

      {/* Current Task */}
      {agent.currentTask && (
        <div className="unit-task">
          <div className="unit-stat-label">Task</div>
          <div className="unit-task-text">{agent.currentTask}</div>
        </div>
      )}

      {/* Working Directory */}
      <div className="unit-cwd">
        <div className="unit-stat-label">CWD</div>
        <div className="unit-cwd-path" title={agent.cwd}>{agent.cwd}</div>
      </div>

      {/* Supervisor History */}
      <div className="unit-supervisor-history">
        <div
          className="unit-supervisor-history-header"
          onClick={() => setShowHistory(!showHistory)}
        >
          <div className="unit-stat-label">Supervisor History</div>
          <span className="unit-supervisor-history-toggle">
            {supervisorHistory.length > 0 && (
              <span className="unit-supervisor-history-count">{supervisorHistory.length}</span>
            )}
            {showHistory ? '▼' : '▶'}
          </span>
        </div>
        {showHistory && (
          <div className="unit-supervisor-history-list">
            {isLoadingHistory ? (
              <div className="unit-supervisor-history-loading">Loading...</div>
            ) : supervisorHistory.length === 0 ? (
              <div className="unit-supervisor-history-empty">No supervisor reports yet</div>
            ) : (
              supervisorHistory.slice(0, 10).map((entry, index) => (
                <SupervisorHistoryItem key={entry.id} entry={entry} defaultExpanded={index === 0} />
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
}

interface MultiAgentPanelProps {
  agents: Agent[];
}

function MultiAgentPanel({ agents }: MultiAgentPanelProps) {
  const totalTokens = agents.reduce((sum, a) => sum + a.tokensUsed, 0);
  const workingCount = agents.filter((a) => a.status === 'working').length;

  return (
    <div className="unit-panel">
      <div className="unit-panel-header">
        <div className="unit-class-icon" style={{ background: '#4a9eff20' }}>
          👥
        </div>
        <div>
          <div className="unit-name">{agents.length} Agents Selected</div>
          <div className="unit-status">Group selection</div>
        </div>
      </div>

      <div className="unit-stats">
        <div className="unit-stat">
          <div className="unit-stat-label">Total Tokens</div>
          <div className="unit-stat-value">{formatNumber(totalTokens)}</div>
        </div>
        <div className="unit-stat">
          <div className="unit-stat-label">Working</div>
          <div className="unit-stat-value">{workingCount}</div>
        </div>
      </div>

      <div style={{ padding: '8px 0', maxHeight: 100, overflowY: 'auto' }}>
        {agents.map((a) => {
          const cfg = AGENT_CLASS_CONFIG[a.class];
          return (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0',
                fontSize: 12,
              }}
            >
              <span>{cfg.icon}</span>
              <span style={{ flex: 1 }}>{a.name}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{a.status}</span>
            </div>
          );
        })}
      </div>

      <div className="unit-actions">
        <button className="unit-action-btn" onClick={() => store.deselectAll()}>
          Deselect All
        </button>
      </div>
    </div>
  );
}

interface SupervisorHistoryItemProps {
  entry: AgentSupervisorHistoryEntry;
  defaultExpanded?: boolean;
}

function SupervisorHistoryItem({ entry, defaultExpanded = false }: SupervisorHistoryItemProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const state = useStore();
  const { analysis } = entry;
  const hideCost = state.settings.hideCost;

  // Format timestamp as relative time
  const formatRelativeTime = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const statusDescription = filterCostText(analysis.statusDescription, hideCost);
  const recentWorkSummary = filterCostText(analysis.recentWorkSummary, hideCost);
  const concerns = analysis.concerns?.map(c => filterCostText(c, hideCost)).filter(c => c.length > 0);

  return (
    <div className="supervisor-history-item">
      <div
        className="supervisor-history-item-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className="supervisor-history-progress-dot"
          style={{ background: PROGRESS_COLORS[analysis.progress] || '#888' }}
          title={analysis.progress}
        />
        <span className="supervisor-history-status">
          {statusDescription}
        </span>
        <span className="supervisor-history-time">{formatRelativeTime(entry.timestamp)}</span>
      </div>
      {expanded && (
        <div className="supervisor-history-item-details">
          <div className="supervisor-history-summary">
            <strong>Summary:</strong> {recentWorkSummary}
          </div>
          {concerns && concerns.length > 0 && (
            <div className="supervisor-history-concerns">
              <strong>Concerns:</strong>
              <ul>
                {concerns.map((concern, i) => (
                  <li key={i}>{concern}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
