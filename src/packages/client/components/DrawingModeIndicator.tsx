/**
 * Drawing Mode Indicator
 * Shows visual feedback when the user is in area drawing mode.
 * Displays instructions and provides a way to exit the mode.
 */

import React from 'react';
import type { DrawingTool } from '../../shared/types';

interface DrawingModeIndicatorProps {
  activeTool: DrawingTool;
  onExit: () => void;
}

export function DrawingModeIndicator({ activeTool, onExit }: DrawingModeIndicatorProps) {
  // Only show when in actual drawing mode (rectangle or circle)
  if (!activeTool || activeTool === 'select') return null;

  const toolLabel = activeTool === 'rectangle' ? 'Rectangle' : 'Circle';
  const toolIcon = activeTool === 'rectangle' ? '▭' : '○';

  return (
    <div className="drawing-mode-indicator">
      <div className="drawing-mode-content">
        <span className="drawing-mode-icon">{toolIcon}</span>
        <div className="drawing-mode-text">
          <span className="drawing-mode-title">Drawing {toolLabel}</span>
          <span className="drawing-mode-hint">Click and drag to draw • ESC to cancel</span>
        </div>
      </div>
      <button
        className="drawing-mode-exit"
        onClick={onExit}
        title="Exit drawing mode (ESC)"
      >
        ✕
      </button>
    </div>
  );
}
