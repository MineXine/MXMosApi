import { Router } from 'express';
import { setRepository } from './filters.js';
import { authRouter } from './auth.routes.js';
import { postsRouter } from './posts.routes.js';
import { viewsRouter } from './views.routes.js';
import { draftsRouter } from './drafts.routes.js';
import { mediaRouter } from './media.routes.js';
import { shareRouter } from './share.routes.js';
import { statsRouter } from './stats.routes.js';

export function createApiRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'healthy', time: new Date().toISOString() } });
  });

  router.use('/auth', authRouter);
  router.use('/posts', postsRouter);
  router.use('/views', viewsRouter);
  router.use('/drafts', draftsRouter);
  router.use('/media', mediaRouter);
  router.use('/share', shareRouter);
  router.use('/stats', statsRouter);

  return router;
}

export { setRepository };
