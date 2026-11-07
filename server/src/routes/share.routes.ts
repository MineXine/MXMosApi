import { Router } from 'express';
import { repo } from './filters.js';
import { requireAuth } from '../middleware/auth.js';
import { notFound } from '../lib/errors.js';
import { env } from '../config/env.js';
import { param } from '../lib/params.js';

export const shareRouter = Router();

/** 公开访问：凭 token 读取说说（无需登录） */
shareRouter.get('/:token', async (req, res) => {
  const r = repo();
  const share = await r.findShareByToken(param(req, 'token'));
  if (!share) throw notFound('分享链接无效或已失效');

  if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
    throw notFound('分享链接已过期');
  }

  const post = await r.findPostById(share.postId);
  if (!post) throw notFound('分享的内容已不存在');

  res.json({ ok: true, data: { post, share } });
});

/** 我的分享列表 */
shareRouter.get('/', requireAuth, async (req, res) => {
  const shares = await repo().listSharesByCreator(req.user!.sub);
  res.json({ ok: true, data: { shares } });
});

/** 撤销分享 */
shareRouter.delete('/:id', requireAuth, async (req, res) => {
  const r = repo();
  const shares = await r.listSharesByCreator(req.user!.sub);
  const target = shares.find((s) => s.id === param(req, 'id'));
  if (!target) throw notFound('分享记录不存在');
  await r.deleteShare(target.id);
  res.json({ ok: true, data: { deleted: true } });
});

/** 生成分享落地页 URL */
export function buildShareUrl(token: string): string {
  const base = env.publicBaseUrl || '';
  return `${base}/share/${token}`;
}
