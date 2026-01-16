/**
 * Express Application
 * Main Express app configuration
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import routes from './routes/index.js';

// Temp directory for uploads (same as in files.ts)
const UPLOADS_DIR = path.join(os.tmpdir(), 'tide-commander-uploads');

export function createApp(): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[HTTP] ${req.method} ${req.path}`);
    next();
  });

  // Serve uploaded files statically
  app.use('/uploads', express.static(UPLOADS_DIR));

  // API routes
  app.use('/api', routes);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[HTTP] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
