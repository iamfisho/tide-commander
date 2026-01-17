/**
 * Tide Commander Server
 * Entry point for the backend server
 */

import { createServer } from 'http';
import { createApp } from './app.js';
import { agentService, claudeService, supervisorService } from './services/index.js';
import * as websocket from './websocket/handler.js';
import { getDataDir } from './data/index.js';
import { logger } from './utils/logger.js';

// Configuration
const PORT = process.env.PORT || 5174;

async function main(): Promise<void> {
  // Initialize services
  agentService.initAgents();
  claudeService.init();
  supervisorService.init();

  logger.server.log(`Data directory: ${getDataDir()}`);

  // Create Express app and HTTP server
  const app = createApp();
  const server = createServer(app);

  // Initialize WebSocket
  websocket.init(server);

  // Start server
  server.listen(PORT, () => {
    logger.server.log(`Server running on http://localhost:${PORT}`);
    logger.server.log(`WebSocket available at ws://localhost:${PORT}/ws`);
    logger.server.log(`API available at http://localhost:${PORT}/api`);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.server.warn('Shutting down...');
    supervisorService.shutdown();
    await claudeService.shutdown();
    agentService.persistAgents();
    server.close();
    process.exit(0);
  });
}

main().catch(console.error);
