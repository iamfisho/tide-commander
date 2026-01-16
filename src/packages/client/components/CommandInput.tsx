import React, { useState } from 'react';
import { useStore, store } from '../store';

export function CommandInput() {
  const [command, setCommand] = useState('');
  const state = useStore();

  const hasSelection = state.selectedAgentIds.size > 0;
  const selectedAgents = store.getSelectedAgents();

  // Calculate total queued commands across selected agents
  const totalQueuedCommands = selectedAgents.reduce(
    (sum, agent) => sum + (agent?.pendingCommands?.length || 0),
    0
  );

  // Check if any selected agent is working
  const anyWorking = selectedAgents.some(agent => agent?.status === 'working');

  const getPlaceholder = () => {
    if (state.selectedAgentIds.size === 0) {
      return 'Select an agent to send commands...';
    } else if (state.selectedAgentIds.size === 1) {
      const agent = selectedAgents[0];
      if (agent?.status === 'working') {
        return `Enter command to queue for ${agent?.name || 'agent'}...`;
      }
      return `Enter command for ${agent?.name || 'agent'}...`;
    } else {
      if (anyWorking) {
        return `Enter command to queue for ${state.selectedAgentIds.size} agents...`;
      }
      return `Enter command for ${state.selectedAgentIds.size} agents...`;
    }
  };

  const handleSend = () => {
    if (!command.trim() || !hasSelection) return;

    for (const agentId of state.selectedAgentIds) {
      store.sendCommand(agentId, command.trim());
    }

    setCommand('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="command-section">
      <div className="command-bar">
        <input
          type="text"
          className="command-input"
          placeholder={getPlaceholder()}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!hasSelection}
        />
        {totalQueuedCommands > 0 && (
          <span className="queue-badge" title="Commands in queue">
            {totalQueuedCommands} queued
          </span>
        )}
        <button className="command-send" onClick={handleSend} disabled={!hasSelection}>
          {anyWorking ? 'Queue' : 'Send'}
        </button>
      </div>
    </div>
  );
}
