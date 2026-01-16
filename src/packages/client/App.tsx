import React, { useEffect, useRef, useState, useCallback } from 'react';
import { store, useStore } from './store';
import { connect, setCallbacks, getSocket } from './websocket';
import { SceneManager } from './scene/SceneManager';
import { ToastProvider, useToast } from './components/Toast';
import { UnitPanel } from './components/UnitPanel';
import { ToolHistory } from './components/ToolHistory';
import { SpawnModal } from './components/SpawnModal';
import { Toolbox, type SceneConfig, type TimeMode } from './components/Toolbox';
import { ClaudeOutputPanel } from './components/ClaudeOutputPanel';
import { CommanderView } from './components/CommanderView';
import { FileExplorerPanel } from './components/FileExplorerPanel';
import { AgentBar } from './components/AgentBar';
import { SupervisorPanel } from './components/SupervisorPanel';

// Persist scene manager across HMR
let persistedScene: SceneManager | null = null;
let wsConnected = false;

// Config storage key
const CONFIG_STORAGE_KEY = 'tide-commander-config';

// Default terrain config
const DEFAULT_TERRAIN = {
  showTrees: true,
  showBushes: true,
  showHouse: true,
  showLamps: true,
  showGrass: true,
  fogDensity: 1,
  floorStyle: 'concrete' as const,
};

// Load config from localStorage
function loadConfig(): SceneConfig {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        characterScale: parsed.characterScale ?? 0.5,
        indicatorScale: parsed.indicatorScale ?? 1.0,
        gridVisible: parsed.gridVisible ?? true,
        timeMode: parsed.timeMode ?? 'auto',
        terrain: { ...DEFAULT_TERRAIN, ...parsed.terrain },
      };
    }
  } catch (err) {
    console.warn('[Tide] Failed to load config:', err);
  }
  return { characterScale: 0.5, indicatorScale: 1.0, gridVisible: true, timeMode: 'auto', terrain: DEFAULT_TERRAIN };
}

// Save config to localStorage
function saveConfig(config: SceneConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('[Tide] Failed to save config:', err);
  }
}

function AppContent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(false);
  const [isToolboxOpen, setIsToolboxOpen] = useState(false);
  const [isCommanderViewOpen, setIsCommanderViewOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSupervisorOpen, setIsSupervisorOpen] = useState(false);
  const [sceneConfig, setSceneConfig] = useState(loadConfig);
  const [explorerAreaId, setExplorerAreaId] = useState<string | null>(null);
  const { showToast } = useToast();
  const state = useStore();

  // Initialize scene and websocket
  useEffect(() => {
    if (!canvasRef.current || !selectionBoxRef.current) return;

    // Reuse or create scene manager (persists across HMR)
    if (persistedScene) {
      // Reattach to new canvas/selection elements
      persistedScene.reattach(canvasRef.current, selectionBoxRef.current);
      sceneRef.current = persistedScene;
      console.log('[Tide] Reattached existing scene (HMR)');
    } else {
      const scene = new SceneManager(canvasRef.current, selectionBoxRef.current);
      sceneRef.current = scene;
      persistedScene = scene;

      // Apply saved config
      const savedConfig = loadConfig();
      scene.setCharacterScale(savedConfig.characterScale);
      scene.setIndicatorScale(savedConfig.indicatorScale);
      scene.setGridVisible(savedConfig.gridVisible);
      scene.setTimeMode(savedConfig.timeMode);
      scene.setTerrainConfig(savedConfig.terrain);
      scene.setFloorStyle(savedConfig.terrain.floorStyle, true); // force=true on initial load

      // Load character models then upgrade any existing agents
      scene.loadCharacterModels().then(() => {
        console.log('[Tide] Character models ready');
        scene.upgradeAgentModels();
      }).catch((err) => {
        console.warn('[Tide] Some models failed to load, using fallback:', err);
      });
    }

    // Set up websocket callbacks (always update refs)
    setCallbacks({
      onToast: showToast,
      onAgentCreated: (agent) => {
        sceneRef.current?.addAgent(agent);
        (window as any).__spawnModalSuccess?.();
      },
      onAgentUpdated: (agent, positionChanged) => {
        sceneRef.current?.updateAgent(agent, positionChanged);
      },
      onAgentDeleted: (agentId) => {
        sceneRef.current?.removeAgent(agentId);
      },
      onAgentsSync: (agents) => {
        sceneRef.current?.syncAgents(agents);
      },
      onSpawnError: () => {
        (window as any).__spawnModalError?.();
      },
      onSpawnSuccess: () => {
        (window as any).__spawnModalSuccess?.();
      },
      onDirectoryNotFound: (path) => {
        (window as any).__spawnModalDirNotFound?.(path);
      },
      onToolUse: (agentId, toolName, toolInput) => {
        sceneRef.current?.showToolBubble(agentId, toolName, toolInput);
      },
    });

    // Connect to server only if not already connected
    if (!wsConnected || !getSocket() || getSocket()?.readyState !== WebSocket.OPEN) {
      connect();
      wsConnected = true;
    }

    // Don't dispose on HMR unmount - only on full page unload
    return () => {
      // Only cleanup if page is actually unloading
      if (!import.meta.hot) {
        sceneRef.current?.dispose();
        persistedScene = null;
        wsConnected = false;
      }
    };
  }, [showToast]);

  // Subscribe to selection changes to update scene visuals
  useEffect(() => {
    return store.subscribe(() => {
      sceneRef.current?.refreshSelectionVisuals();
    });
  }, []);

  // Sync areas when they change (subscribe to store for real-time updates)
  useEffect(() => {
    // Initial sync
    sceneRef.current?.syncAreas();

    // Subscribe to store changes - sync areas on any change
    let lastAreasJson = '';
    return store.subscribe(() => {
      const state = store.getState();
      const areasJson = JSON.stringify(Array.from(state.areas.values()));
      if (areasJson !== lastAreasJson) {
        lastAreasJson = areasJson;
        sceneRef.current?.syncAreas();
      }
    });
  }, []);

  // Update area highlight when selection changes
  useEffect(() => {
    sceneRef.current?.highlightArea(state.selectedAreaId);
  }, [state.selectedAreaId]);

  // Handle config changes
  const handleConfigChange = useCallback((config: SceneConfig) => {
    setSceneConfig(config);
    saveConfig(config);
    sceneRef.current?.setCharacterScale(config.characterScale);
    sceneRef.current?.setIndicatorScale(config.indicatorScale);
    sceneRef.current?.setGridVisible(config.gridVisible);
    sceneRef.current?.setTimeMode(config.timeMode);
    sceneRef.current?.setTerrainConfig(config.terrain);
    sceneRef.current?.setFloorStyle(config.terrain.floorStyle);
  }, []);

  // Handle tool changes
  const handleToolChange = useCallback((tool: 'rectangle' | 'circle' | 'select' | null) => {
    sceneRef.current?.setDrawingTool(tool);
  }, []);

  // Handle focus agent
  const handleFocusAgent = useCallback((agentId: string) => {
    sceneRef.current?.focusAgent(agentId);
  }, []);

  // Handle kill agent (terminates Claude session)
  const handleKillAgent = useCallback((agentId: string) => {
    store.killAgent(agentId);
  }, []);

  // Handle opening file explorer for an area
  const handleOpenAreaExplorer = useCallback((areaId: string) => {
    setExplorerAreaId(areaId);
  }, []);

  // Handle delete selected agents (removes from UI and server, keeps Claude sessions running)
  const handleDeleteSelectedAgents = useCallback(() => {
    const selectedIds = Array.from(state.selectedAgentIds);
    selectedIds.forEach(id => {
      // Remove from server persistence (triggers agent_deleted broadcast)
      store.removeAgentFromServer(id);
      // Clean up 3D scene (zzz bubble, etc.)
      sceneRef.current?.removeAgent(id);
    });
    setIsDeleteConfirmOpen(false);
    showToast('info', 'Agents Removed', `${selectedIds.length} agent(s) removed from view`);
  }, [state.selectedAgentIds, showToast]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to deselect or close modal
      if (e.key === 'Escape') {
        if (isSpawnModalOpen) {
          setIsSpawnModalOpen(false);
        } else {
          store.deselectAll();
          sceneRef.current?.refreshSelectionVisuals();
        }
      }

      // Ctrl+Number keys to select agents
      if (e.key >= '1' && e.key <= '9' && e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const state = store.getState();
        const index = parseInt(e.key) - 1;
        const agentIds = Array.from(state.agents.keys());
        if (index < agentIds.length) {
          store.selectAgent(agentIds[index]);
          sceneRef.current?.refreshSelectionVisuals();
        }
      }

      // Alt+N to spawn new agent
      if (e.key === 'n' && e.altKey) {
        e.preventDefault();
        setIsSpawnModalOpen(true);
      }

      // Tab or Cmd/Ctrl+K to toggle Commander View
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          setIsCommanderViewOpen(prev => !prev);
        }
      }

      // Cmd+K (Mac) or Ctrl+K (Windows/Linux) to toggle Commander View
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsCommanderViewOpen(prev => !prev);
      }

      // Delete or Backspace to remove selected agents (with confirmation)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          const currentState = store.getState();
          if (currentState.selectedAgentIds.size > 0) {
            e.preventDefault();
            setIsDeleteConfirmOpen(true);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSpawnModalOpen]);

  return (
    <div className="app">
      <main className="main-content">
        <div className="battlefield-container">
          <canvas ref={canvasRef} id="battlefield"></canvas>
          <div ref={selectionBoxRef} id="selection-box"></div>
        </div>

        <aside className="sidebar">
          {state.selectedAgentIds.size > 0 ? (
            <>
              <div className="sidebar-section unit-section">
                <UnitPanel
                  onFocusAgent={handleFocusAgent}
                  onKillAgent={handleKillAgent}
                  onOpenAreaExplorer={handleOpenAreaExplorer}
                />
              </div>
              <div className="sidebar-section tool-history-section">
                <ToolHistory agentIds={Array.from(state.selectedAgentIds)} />
              </div>
            </>
          ) : (
            <div className="sidebar-section unit-section">
              <UnitPanel
                onFocusAgent={handleFocusAgent}
                onKillAgent={handleKillAgent}
                onOpenAreaExplorer={handleOpenAreaExplorer}
              />
            </div>
          )}
        </aside>

        {/* Guake-style dropdown terminal */}
        <ClaudeOutputPanel />
      </main>

      {/* Floating settings button */}
      <button
        className="floating-settings-btn"
        onClick={() => setIsToolboxOpen(true)}
        title="Settings & Tools"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </button>

      {/* Toolbox sidebar overlay */}
      <Toolbox
        config={sceneConfig}
        onConfigChange={handleConfigChange}
        onToolChange={handleToolChange}
        isOpen={isToolboxOpen}
        onClose={() => setIsToolboxOpen(false)}
      />

      <SpawnModal
        isOpen={isSpawnModalOpen}
        onClose={() => setIsSpawnModalOpen(false)}
        onSpawnStart={() => {}}
        onSpawnEnd={() => {}}
      />

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div
          className="modal-overlay visible"
          onClick={() => setIsDeleteConfirmOpen(false)}
        >
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Remove Agents</div>
            <div className="modal-body confirm-modal-body">
              <p>Remove {state.selectedAgentIds.size} selected agent{state.selectedAgentIds.size > 1 ? 's' : ''} from the battlefield?</p>
              <p className="confirm-modal-note">Claude Code sessions will continue running in the background.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsDeleteConfirmOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDeleteSelectedAgents}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Commander View button */}
      <button
        className="commander-toggle-btn"
        onClick={() => setIsCommanderViewOpen(true)}
        title="Commander View (⌘K)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>

      {/* Supervisor Overview button */}
      <button
        className="supervisor-toggle-btn"
        onClick={() => setIsSupervisorOpen(true)}
        title="Supervisor Overview"
      >
        🎖️
      </button>

      <CommanderView
        isOpen={isCommanderViewOpen}
        onClose={() => setIsCommanderViewOpen(false)}
      />

      {/* Supervisor Panel */}
      <SupervisorPanel
        isOpen={isSupervisorOpen}
        onClose={() => setIsSupervisorOpen(false)}
      />

      {/* File Explorer Panel (right side) */}
      <FileExplorerPanel
        isOpen={explorerAreaId !== null}
        areaId={explorerAreaId}
        onClose={() => setExplorerAreaId(null)}
      />

      {/* Bottom Agent Bar */}
      <AgentBar onFocusAgent={handleFocusAgent} onSpawnClick={() => setIsSpawnModalOpen(true)} />
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
