import { Router } from 'express';
import { setRepository } from './filters.js';
import { authRouter } from './auth.routes.js';
import { postsRouter } from './posts.routes.js';
import { viewsRouter } from './views.routes.js';
import { draftsRouter } from './drafts.routes.js';
import { mediaRouter } from './media.routes.js';
import { shareRouter } from './share.routes.js';
import { statsRouter } from './stats.routes.js';
import { tokensRouter } from './tokens.routes.js';
import { noticeRouter } from './notice.routes.js';

/** 服务版本信息（运维 / 开放接口自描述用） */
const VERSION = '1.1.0';

export function createApiRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, data: { status: 'healthy', time: new Date().toISOString() } });
  });

  /** 版本与能力自描述，供开放 API 消费方做兼容判断 */
  router.get('/version', (_req, res) => {
    res.json({
      ok: true,
      data: {
        name: 'MXMosApi',
        version: VERSION,
        apiVersion: 'v1',
        capabilities: {
          jwt: true,
          apiToken: true,
          posts: true,
          postStatus: true,      // published / archived / hidden
          tagManagement: true,   // 标签改名与删除
          views: true,
          calendar: true,
          map: true,
          search: true,
          openPublish: true,     // POST /posts/by-token
          notice: true,          // 11 种第三方推送
          media: true,
          share: true,
        },
      },
    });
  });

  router.use('/auth', authRouter);
  router.use('/posts', postsRouter);
  router.use('/views', viewsRouter);
  router.use('/drafts', draftsRouter);
  router.use('/media', mediaRouter);
  router.use('/share', shareRouter);
  router.use('/stats', statsRouter);
  router.use('/tokens', tokensRouter);
  router.use('/notice', noticeRouter);

  return router;
}

export { setRepository };
