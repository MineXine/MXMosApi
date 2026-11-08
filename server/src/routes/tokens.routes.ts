import { Router } from 'express';
import { z } from 'zod';
import type { ApiToken } from '../../../shared/types.js';
import { getRepository } from '../repositories/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { generateApiToken, hashApiToken, requireAuth } from '../middleware/auth.js';
import { param } from '../lib/params.js';
import { validateBody } from '../middleware/error.js';

/**
 * API 访问令牌管理。
 *
 * 与 JWT 会话的区别：
 * - JWT 短时、绑定登录态，用于后台界面
 * - Token 长期、可单独吊销，供第三方（小程序 / CLI / 自动化脚本）调用开放接口
 *
 * 明文只在创建时返回一次，之后只存哈希，接口一律返回掩码形式。
 */
export const tokensRouter = Router();

tokensRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(40),
  /** 权限范围：目前仅支持 posts:write（开放发布） */
  scopes: z.array(z.string()).default(['posts:write']),
  /** 过期时间；不传表示长期有效 */
  expiresAt: z.string().datetime().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  enabled: z.boolean().optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/**
 * 对外展示用的掩码。
 * 用 `prefix`（明文前缀）让列表可识别是哪个令牌，但不足以鉴权。
 */
function present(t: ApiToken) {
  const suffix = '••••••••';
  return { ...t, token: t.prefix ? `${t.prefix}${suffix}` : suffix };
}

/** 列出当前用户的令牌 */
tokensRouter.get('/', async (req, res) => {
  const repo = getRepository();
  const list = await repo.listApiTokens(req.user!.sub);
  res.json({ ok: true, data: { tokens: list.map(present), total: list.length } });
});

/**
 * 创建令牌。
 * 返回体含一次性的 `token` 明文，仅供本次展示，之后无法再取回。
 */
tokensRouter.post('/', validateBody(createSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createSchema>;
  const repo = getRepository();

  // 限流：单用户最多 20 个令牌
  const existing = await repo.listApiTokens(req.user!.sub);
  if (existing.length >= 20) throw badRequest('令牌数量已达上限（20）');

  const plain = generateApiToken();
  const created = await repo.createApiToken({
    ownerId: req.user!.sub,
    name: body.name,
    token: hashApiToken(plain),
    prefix: plain.slice(0, 11), // `mx_` + 8 位，足够识别、不足以还原
    scopes: body.scopes,
    expiresAt: body.expiresAt ?? null,
  });

  res.status(201).json({
    ok: true,
    data: {
      ...present(created),
      // 一次性明文，仅此一次可见
      token: plain,
      warning: '请立即保存，此明文不会再次显示',
    },
  });
});

/** 更新令牌（改名 / 启停 / 调整权限） */
tokensRouter.patch('/:id', validateBody(updateSchema), async (req, res) => {
  const repo = getRepository();
  const updated = await repo.updateApiToken(param(req, 'id'), req.body as z.infer<typeof updateSchema>);
  if (!updated) throw notFound('令牌不存在');
  res.json({ ok: true, data: { token: present(updated) } });
});

/** 吊销令牌 */
tokensRouter.delete('/:id', async (req, res) => {
  const repo = getRepository();
  const ok = await repo.deleteApiToken(param(req, 'id'));
  if (!ok) throw notFound('令牌不存在');
  res.json({ ok: true, data: { deleted: true } });
});
