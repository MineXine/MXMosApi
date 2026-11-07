import { Router } from 'express';
import { z } from 'zod';
import { repo } from './filters.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/error.js';
import { param } from '../lib/params.js';

export const draftsRouter = Router();

const attachmentSchema = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string().optional().default(''),
  mime: z.string().optional().default(''),
  size: z.number().optional().default(0),
  width: z.number().optional(),
  height: z.number().optional(),
  kind: z.enum(['image', 'video', 'audio', 'file']).optional().default('image'),
});

const draftSchema = z.object({
  key: z.string().min(1).max(64),
  content: z.string().max(20000).optional().default(''),
  tags: z.array(z.string()).max(12).optional().default([]),
  attachments: z.array(attachmentSchema).max(20).optional().default([]),
});

/** 草稿列表 */
draftsRouter.get('/', requireAuth, async (req, res) => {
  const drafts = await repo().listDrafts(req.user!.sub);
  res.json({ ok: true, data: { drafts } });
});

/** 保存/更新草稿（编辑器自动保存调用） */
draftsRouter.put('/', requireAuth, validateBody(draftSchema), async (req, res) => {
  const body = req.body as z.infer<typeof draftSchema>;
  const draft = await repo().upsertDraft({ ownerId: req.user!.sub, ...body });
  res.json({ ok: true, data: { draft } });
});

/** 获取单个草稿 */
draftsRouter.get('/:key', requireAuth, async (req, res) => {
  const draft = await repo().findDraft(req.user!.sub, param(req, 'key'));
  res.json({ ok: true, data: { draft } });
});

/** 删除草稿 */
draftsRouter.delete('/:key', requireAuth, async (req, res) => {
  await repo().deleteDraft(req.user!.sub, param(req, 'key'));
  res.json({ ok: true, data: { deleted: true } });
});
