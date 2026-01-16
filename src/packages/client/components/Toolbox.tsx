import React, { useState, useEffect } from 'react';
import { useStore, store } from '../store';
import type { DrawingArea, DrawingTool } from '../../shared/types';

// Color palette for areas
const AREA_COLORS = [
  '#4a9eff', // blue
  '#4aff9e', // green
  '#ff9e4a', // orange
  '#ff4a9e', // pink
  '#9e4aff', // purple
  '#ff4a4a', // red
  '#4affff', // cyan
  '#ffff4a', // yellow
];

// Time mode options
export type TimeMode = 'auto' | 'day' | 'night' | 'dawn' | 'dusk';

// Floor style options
export type FloorStyle = 'none' | 'concrete' | 'galactic' | 'metal' | 'hex' | 'circuit';

// Terrain options
export interface TerrainConfig {
  showTrees: boolean;
  showBushes: boolean;
  showHouse: boolean;
  showLamps: boolean;
  showGrass: boolean;
  fogDensity: number; // 0 = none, 1 = normal, 2 = heavy
  floorStyle: FloorStyle;
}

export interface SceneConfig {
  characterScale: number;
  indicatorScale: number;
  gridVisible: boolean;
  timeMode: TimeMode;
  terrain: TerrainConfig;
}

interface ToolboxProps {
  onConfigChange: (config: SceneConfig) => void;
  onToolChange: (tool: DrawingTool) => void;
  config: SceneConfig;
  isOpen: boolean;
  onClose: () => void;
}

export function Toolbox({ onConfigChange, onToolChange, config, isOpen, onClose }: ToolboxProps) {
  const state = useStore();
  const areasArray = Array.from(state.areas.values());

  // Areas are loaded from server via WebSocket on connection

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleToolSelect = (tool: DrawingTool) => {
    const newTool = state.activeTool === tool ? null : tool;
    onToolChange(newTool);
  };

  const handleAreaClick = (areaId: string) => {
    store.selectArea(state.selectedAreaId === areaId ? null : areaId);
    onToolChange('select');
  };

  const handleDeleteArea = (e: React.MouseEvent, areaId: string) => {
    e.stopPropagation();
    store.deleteArea(areaId);
  };

  return (
    <>
      {/* Backdrop */}
      <div className="toolbox-backdrop" onClick={onClose} />

      <aside className="toolbox">
        {/* Header with close button */}
        <div className="toolbox-header">
          <span>Tools & Settings</span>
          <button className="toolbox-close-btn" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        {/* Drawing Tools */}
        <div className="toolbox-section">
          <div className="toolbox-section-header">Drawing Tools</div>
        <div className="tool-buttons">
          <button
            className={`tool-btn ${state.activeTool === 'select' ? 'active' : ''}`}
            onClick={() => handleToolSelect('select')}
            title="Select"
          >
            <span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
              </svg>
            </span>
            <span className="tool-btn-label">Select</span>
          </button>
          <button
            className={`tool-btn ${state.activeTool === 'rectangle' ? 'active' : ''}`}
            onClick={() => handleToolSelect('rectangle')}
            title="Rectangle"
          >
            <span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            </span>
            <span className="tool-btn-label">Rect</span>
          </button>
          <button
            className={`tool-btn ${state.activeTool === 'circle' ? 'active' : ''}`}
            onClick={() => handleToolSelect('circle')}
            title="Circle"
          >
            <span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
              </svg>
            </span>
            <span className="tool-btn-label">Circle</span>
          </button>
          </div>
        </div>

        {/* Areas List */}
        <div className="toolbox-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
          <div className="toolbox-section-header" style={{ padding: '12px 12px 10px' }}>
            Areas ({areasArray.length})
          </div>
          <div className="areas-list">
            {areasArray.length === 0 ? (
              <div className="areas-empty">
                Draw on the battlefield to create areas
              </div>
            ) : (
              areasArray.map((area) => (
                <AreaItem
                  key={area.id}
                  area={area}
                  isSelected={state.selectedAreaId === area.id}
                  onClick={() => handleAreaClick(area.id)}
                  onDelete={(e) => handleDeleteArea(e, area.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Area Editor */}
        {state.selectedAreaId && (
          <AreaEditor
            area={state.areas.get(state.selectedAreaId)!}
            onClose={() => store.selectArea(null)}
          />
        )}

        {/* Config Section */}
        <ConfigSection config={config} onChange={onConfigChange} />
      </aside>
    </>
  );
}

interface AreaItemProps {
  area: DrawingArea;
  isSelected: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

function AreaItem({ area, isSelected, onClick, onDelete }: AreaItemProps) {
  const agentCount = area.assignedAgentIds.length;
  const typeLabel = area.type === 'rectangle' ? 'Rect' : 'Circle';

  return (
    <div className={`area-item ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div className="area-color-dot" style={{ backgroundColor: area.color }} />
      <div className="area-info">
        <div className="area-name">{area.name}</div>
        <div className="area-meta">
          {typeLabel} {agentCount > 0 && `• ${agentCount} agent${agentCount > 1 ? 's' : ''}`}
        </div>
      </div>
      <button className="area-delete-btn" onClick={onDelete} title="Delete area">
        &times;
      </button>
    </div>
  );
}

interface AreaEditorProps {
  area: DrawingArea;
  onClose: () => void;
}

function AreaEditor({ area, onClose }: AreaEditorProps) {
  const [name, setName] = useState(area.name);

  useEffect(() => {
    setName(area.name);
  }, [area.id, area.name]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    store.updateArea(area.id, { name: newName });
  };

  const handleColorSelect = (color: string) => {
    store.updateArea(area.id, { color });
  };

  return (
    <div className="area-editor">
      <div className="area-editor-header">
        <span className="area-editor-title">Edit Area</span>
        <button className="area-editor-close" onClick={onClose}>&times;</button>
      </div>
      <div className="area-editor-row">
        <div className="area-editor-label">Name</div>
        <input
          type="text"
          className="area-editor-input"
          value={name}
          onChange={handleNameChange}
          placeholder="Area name"
        />
      </div>
      <div className="area-editor-row">
        <div className="area-editor-label">Color</div>
        <div className="color-picker-row">
          {AREA_COLORS.map((color) => (
            <div
              key={color}
              className={`color-swatch ${area.color === color ? 'selected' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => handleColorSelect(color)}
            />
          ))}
        </div>
      </div>
      {area.assignedAgentIds.length > 0 && (
        <div className="area-editor-row">
          <div className="area-editor-label">Assigned Agents ({area.assignedAgentIds.length})</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Right-click to unassign
          </div>
        </div>
      )}
    </div>
  );
}

interface ConfigSectionProps {
  config: SceneConfig;
  onChange: (config: SceneConfig) => void;
}

const TIME_MODE_OPTIONS: { value: TimeMode; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', icon: '🕐' },
  { value: 'dawn', label: 'Dawn', icon: '🌅' },
  { value: 'day', label: 'Day', icon: '☀️' },
  { value: 'dusk', label: 'Dusk', icon: '🌇' },
  { value: 'night', label: 'Night', icon: '🌙' },
];

const FLOOR_STYLE_OPTIONS: { value: FloorStyle; label: string; icon: string }[] = [
  { value: 'none', label: 'Grass', icon: '🌱' },
  { value: 'concrete', label: 'Concrete', icon: '🏗️' },
  { value: 'galactic', label: 'Galactic', icon: '🌌' },
  { value: 'metal', label: 'Metal', icon: '⚙️' },
  { value: 'hex', label: 'Hexagon', icon: '⬡' },
  { value: 'circuit', label: 'Circuit', icon: '🔌' },
];

function TimeModePicker({ value, onChange }: { value: TimeMode; onChange: (mode: TimeMode) => void }) {
  const currentIndex = TIME_MODE_OPTIONS.findIndex(opt => opt.value === value);

  const handlePrev = () => {
    const newIndex = currentIndex > 0 ? currentIndex - 1 : TIME_MODE_OPTIONS.length - 1;
    onChange(TIME_MODE_OPTIONS[newIndex].value);
  };

  const handleNext = () => {
    const newIndex = currentIndex < TIME_MODE_OPTIONS.length - 1 ? currentIndex + 1 : 0;
    onChange(TIME_MODE_OPTIONS[newIndex].value);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      handleNext();
    } else {
      handlePrev();
    }
  };

  const current = TIME_MODE_OPTIONS[currentIndex];
  const prev = TIME_MODE_OPTIONS[currentIndex > 0 ? currentIndex - 1 : TIME_MODE_OPTIONS.length - 1];
  const next = TIME_MODE_OPTIONS[currentIndex < TIME_MODE_OPTIONS.length - 1 ? currentIndex + 1 : 0];

  return (
    <div className="time-picker" onWheel={handleWheel}>
      <button className="time-picker-arrow up" onClick={handlePrev}>▲</button>
      <div className="time-picker-items">
        <div className="time-picker-item faded">{prev.icon}</div>
        <div className="time-picker-item current">
          <span className="time-picker-icon">{current.icon}</span>
          <span className="time-picker-label">{current.label}</span>
        </div>
        <div className="time-picker-item faded">{next.icon}</div>
      </div>
      <button className="time-picker-arrow down" onClick={handleNext}>▼</button>
    </div>
  );
}

function FloorStylePicker({ value, onChange }: { value: FloorStyle; onChange: (style: FloorStyle) => void }) {
  const currentIndex = FLOOR_STYLE_OPTIONS.findIndex(opt => opt.value === value);

  const handlePrev = () => {
    const newIndex = currentIndex > 0 ? currentIndex - 1 : FLOOR_STYLE_OPTIONS.length - 1;
    onChange(FLOOR_STYLE_OPTIONS[newIndex].value);
  };

  const handleNext = () => {
    const newIndex = currentIndex < FLOOR_STYLE_OPTIONS.length - 1 ? currentIndex + 1 : 0;
    onChange(FLOOR_STYLE_OPTIONS[newIndex].value);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      handleNext();
    } else {
      handlePrev();
    }
  };

  const current = FLOOR_STYLE_OPTIONS[currentIndex];
  const prev = FLOOR_STYLE_OPTIONS[currentIndex > 0 ? currentIndex - 1 : FLOOR_STYLE_OPTIONS.length - 1];
  const next = FLOOR_STYLE_OPTIONS[currentIndex < FLOOR_STYLE_OPTIONS.length - 1 ? currentIndex + 1 : 0];

  return (
    <div className="time-picker" onWheel={handleWheel}>
      <button className="time-picker-arrow up" onClick={handlePrev}>▲</button>
      <div className="time-picker-items">
        <div className="time-picker-item faded">{prev.icon}</div>
        <div className="time-picker-item current">
          <span className="time-picker-icon">{current.icon}</span>
          <span className="time-picker-label">{current.label}</span>
        </div>
        <div className="time-picker-item faded">{next.icon}</div>
      </div>
      <button className="time-picker-arrow down" onClick={handleNext}>▼</button>
    </div>
  );
}

function ConfigSection({ config, onChange }: ConfigSectionProps) {
  const state = useStore();
  const [historyLimit, setHistoryLimit] = useState(state.settings.historyLimit);

  const updateTerrain = (updates: Partial<TerrainConfig>) => {
    onChange({ ...config, terrain: { ...config.terrain, ...updates } });
  };

  const handleHistoryLimitChange = (value: number) => {
    setHistoryLimit(value);
    store.updateSettings({ historyLimit: value });
  };

  return (
    <div className="config-section">
      <div className="toolbox-section-header">Settings</div>

      {/* History Limit */}
      <div className="config-row">
        <span className="config-label">History Limit</span>
        <input
          type="number"
          className="config-input"
          value={historyLimit}
          onChange={(e) => handleHistoryLimitChange(parseInt(e.target.value) || 100)}
          min={50}
          max={2000}
          step={50}
        />
        <span className="config-value">msgs</span>
      </div>
      <div className="config-row">
        <span className="config-label">Hide Costs</span>
        <input
          type="checkbox"
          checked={state.settings.hideCost}
          onChange={(e) => store.updateSettings({ hideCost: e.target.checked })}
        />
      </div>
      <div className="config-row">
        <span className="config-label">Character Size</span>
        <input
          type="range"
          className="config-slider"
          min="0.3"
          max="3.0"
          step="0.1"
          value={config.characterScale}
          onChange={(e) => onChange({ ...config, characterScale: parseFloat(e.target.value) })}
        />
        <span className="config-value">{config.characterScale.toFixed(1)}x</span>
      </div>
      <div className="config-row">
        <span className="config-label">Indicator Size</span>
        <input
          type="range"
          className="config-slider"
          min="0.3"
          max="2.0"
          step="0.1"
          value={config.indicatorScale}
          onChange={(e) => onChange({ ...config, indicatorScale: parseFloat(e.target.value) })}
        />
        <span className="config-value">{config.indicatorScale.toFixed(1)}x</span>
      </div>
      <div className="config-row">
        <span className="config-label">Show Grid</span>
        <input
          type="checkbox"
          checked={config.gridVisible}
          onChange={(e) => onChange({ ...config, gridVisible: e.target.checked })}
        />
      </div>
      <div className="config-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <span className="config-label">Time of Day</span>
        <TimeModePicker
          value={config.timeMode}
          onChange={(mode) => onChange({ ...config, timeMode: mode })}
        />
      </div>

      <div className="toolbox-section-header" style={{ marginTop: 10 }}>Terrain</div>
      <div className="terrain-toggles">
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showTrees}
            onChange={(e) => updateTerrain({ showTrees: e.target.checked })}
          />
          <span>🌳 Trees</span>
        </label>
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showBushes}
            onChange={(e) => updateTerrain({ showBushes: e.target.checked })}
          />
          <span>🌿 Bushes</span>
        </label>
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showHouse}
            onChange={(e) => updateTerrain({ showHouse: e.target.checked })}
          />
          <span>🏠 House</span>
        </label>
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showLamps}
            onChange={(e) => updateTerrain({ showLamps: e.target.checked })}
          />
          <span>💡 Lamps</span>
        </label>
        <label className="terrain-toggle">
          <input
            type="checkbox"
            checked={config.terrain.showGrass}
            onChange={(e) => updateTerrain({ showGrass: e.target.checked })}
          />
          <span>🟩 Grass</span>
        </label>
      </div>
      <div className="config-row" style={{ marginTop: 6 }}>
        <span className="config-label">Fog</span>
        <input
          type="range"
          className="config-slider"
          min="0"
          max="2"
          step="0.1"
          value={config.terrain.fogDensity}
          onChange={(e) => updateTerrain({ fogDensity: parseFloat(e.target.value) })}
        />
        <span className="config-value">
          {config.terrain.fogDensity === 0 ? 'Off' : config.terrain.fogDensity <= 1 ? 'Light' : 'Heavy'}
        </span>
      </div>

      <div className="config-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, marginTop: 8 }}>
        <span className="config-label">Floor Style</span>
        <FloorStylePicker
          value={config.terrain.floorStyle}
          onChange={(style) => updateTerrain({ floorStyle: style })}
        />
      </div>
    </div>
  );
}

export { AREA_COLORS, TIME_MODE_OPTIONS, FLOOR_STYLE_OPTIONS };
