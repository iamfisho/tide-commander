import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/main.scss';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Could not find #app container');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

console.log('[Tide] Tide Commander initialized');
