/**
 * Routes Module
 * Aggregates all route handlers
 */

import { Router } from 'express';
import agentsRouter from './agents.js';
import filesRouter from './files.js';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Mount sub-routers
router.use('/agents', agentsRouter);
router.use('/files', filesRouter);

export default router;
