import { Router } from 'express';
import { z } from 'zod';
import type { NoticeConfig, NoticeType } from '../../../shared/types.js';
import { getRepository } from '../repositories/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { NOTICE_TYPES, sendNotice, sendNoticeAll } from '../lib/notice.js';
import { param } from '../lib/params.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/error.js';

/**
 * 第三方推送通知渠道管理。
 * 渠道形态与 kkapi-open 的 noticeType 对齐，便于从其配置迁移。
 */
export const noticeRouter = Router();

// 用字面量元组让 zod 推断出 NoticeType 联合，而非宽泛的 string
const typeEnum = z.enum(NOTICE_TYPES as unknown as [NoticeType, ...NoticeType[]]);

/**
 * 支持的渠道一览（前端下拉用）。
 * 静态元数据，无需登录——UI 常在鉴权前就要渲染选项。
 */
noticeRouter.get('/types', (_req, res) => {
  res.json({ ok: true, data: { types: [...NOTICE_TYPES] } });
});

// 以下端点均需登录
noticeRouter.use(requireAuth);

const createSchema = z.object({
  type: typeEnum,
  token: z.string().min(1).max(500),
  title: z.string().max(40).default(''),
  enabled: z.boolean().default(true),
  /** 是否在「新建说说」时推送 */
  onPostCreate: z.boolean().default(true),
});

const updateSchema = z.object({
  type: typeEnum.optional(),
  token: z.string().min(1).max(500).optional(),
  title: z.string().max(40).optional(),
  enabled: z.boolean().optional(),
  onPostCreate: z.boolean().optional(),
});

const testSchema = z.object({
  title: z.string().min(1).max(40).default('测试通知'),
  content: z.string().min(1).max(500).default('这是一条来自说说后台的测试通知，渠道配置正常。'),
});

/** 脱敏展示：token 只露末 4 位 */
function present(c: NoticeConfig): NoticeConfig {
  const t = c.token ?? '';
  return { ...c, token: t.length > 4 ? `****${t.slice(-4)}` : '****' };
}

/** 列出当前用户的渠道 */
noticeRouter.get('/', async (req, res) => {
  const repo = getRepository();
  const list = await repo.listNotices(req.user!.sub);
  res.json({ ok: true, data: { notices: list.map(present), total: list.length } });
});

/** 新增渠道 */
noticeRouter.post('/', validateBody(createSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createSchema>;
  const repo = getRepository();

  const existing = await repo.listNotices(req.user!.sub);
  if (existing.length >= 20) throw badRequest('通知渠道数量已达上限（20）');

  const created = await repo.createNotice({
    ownerId: req.user!.sub,
    type: body.type,
    token: body.token,
    title: body.title,
    enabled: body.enabled,
    onPostCreate: body.onPostCreate,
  });
  res.status(201).json({ ok: true, data: { notice: present(created) } });
});

/** 更新渠道 */
noticeRouter.patch('/:id', validateBody(updateSchema), async (req, res) => {
  const repo = getRepository();
  const updated = await repo.updateNotice(param(req, 'id'), req.body as z.infer<typeof updateSchema>);
  if (!updated) throw notFound('通知渠道不存在');
  res.json({ ok: true, data: { notice: present(updated) } });
});

/** 删除渠道 */
noticeRouter.delete('/:id', async (req, res) => {
  const repo = getRepository();
  const ok = await repo.deleteNotice(param(req, 'id'));
  if (!ok) throw notFound('通知渠道不存在');
  res.json({ ok: true, data: { deleted: true } });
});

/**
 * 测试单个渠道 —— 立即推一条测试消息，返回渠道的真实响应状态。
 * 便于配置后立即校验 token 是否有效。
 */
noticeRouter.post('/:id/test', validateBody(testSchema), async (req, res) => {
  const repo = getRepository();
  const list = await repo.listNotices(req.user!.sub);
  const target = list.find((n) => n.id === req.params.id);
  if (!target) throw notFound('通知渠道不存在');

  const payload = req.body as z.infer<typeof testSchema>;
  const result = await sendNotice(target, payload);
  if (result.ok) await repo.touchNotice(target.id);

  res.json({
    ok: true,
    data: {
      sent: result.ok,
      status: result.status ?? null,
      error: result.error ?? null,
    },
  });
});

/** 测试全部已启用渠道 */
noticeRouter.post('/test-all', validateBody(testSchema), async (req, res) => {
  const repo = getRepository();
  const list = (await repo.listNotices(req.user!.sub)).filter((n) => n.enabled);
  if (!list.length) throw badRequest('还没有启用任何通知渠道');

  const payload = req.body as z.infer<typeof testSchema>;
  const results = await sendNoticeAll(list, payload);
  res.json({ ok: true, data: { results } });
});
