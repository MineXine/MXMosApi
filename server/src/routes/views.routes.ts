import { Router } from 'express';
import { z } from 'zod';
import { repo } from './filters.js';
import type { ViewFilters } from '../../../shared/types.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery, getValidatedQuery } from '../middleware/error.js';
import { forbidden, notFound } from '../lib/errors.js';
import { param } from '../lib/params.js';

export const viewsRouter = Router();

const filtersSchema = z.object({
  keyword: z.string().max(120).optional(),
  tags: z.array(z.string()).max(12).optional(),
  visibility: z.enum(['public', 'private', 'all']).optional(),
  status: z.enum(['published', 'archived']).optional(),
  hasLocation: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(['latest', 'oldest', 'popular', 'liked']).optional(),
});

const createViewSchema = z.object({
  name: z.string().min(1).max(24),
  icon: z.string().max(24).optional().default('inbox'),
  description: z.string().max(120).optional().default(''),
  filters: filtersSchema.optional().default({}),
  order: z.number().int().optional().default(0),
});

const updateViewSchema = z.object({
  name: z.string().min(1).max(24).optional(),
  icon: z.string().max(24).optional(),
  description: z.string().max(120).optional(),
  filters: filtersSchema.optional(),
  order: z.number().int().optional(),
});

/** 内置视图：首次访问时自动初始化 */
async function ensureBuiltInViews(ownerId: string) {
  const r = repo();
  const existing = await r.listViews(ownerId);
  if (existing.length > 0) return;

  const builtIn: Array<{
    name: string;
    icon: string;
    description: string;
    filters: ViewFilters;
    order: number;
  }> = [
    {
      name: '全部说说',
      icon: '📥',
      description: '时间线视图，按最新排序',
      filters: { visibility: 'all', status: 'published', sort: 'latest' },
      order: 0,
    },
    {
      name: '私密',
      icon: '🔒',
      description: '仅自己可见的私密说说',
      filters: { visibility: 'private', status: 'published' },
      order: 1,
    },
    {
      name: '公开',
      icon: '🌐',
      description: '所有公开的说说',
      filters: { visibility: 'public', status: 'published' },
      order: 2,
    },
    {
      name: '带位置',
      icon: '📍',
      description: '包含地理坐标的说说',
      filters: { hasLocation: true, visibility: 'all', status: 'published' },
      order: 3,
    },
    {
      name: '归档',
      icon: '📦',
      description: '已归档的说说',
      filters: { visibility: 'all', status: 'archived' },
      order: 4,
    },
  ];

  for (const v of builtIn) {
    await r.createView({ ...v, ownerId });
  }
}

/** 视图列表 */
viewsRouter.get('/', requireAuth, async (req, res) => {
  await ensureBuiltInViews(req.user!.sub);
  const views = await repo().listViews(req.user!.sub);
  res.json({ ok: true, data: { views } });
});

/** 创建视图 */
viewsRouter.post('/', requireAuth, validateBody(createViewSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createViewSchema>;
  const view = await repo().createView({ ...body, ownerId: req.user!.sub });
  res.status(201).json({ ok: true, data: { view } });
});

/** 更新视图 */
viewsRouter.patch('/:id', requireAuth, validateBody(updateViewSchema), async (req, res) => {
  const r = repo();
  const existing = await r.findViewById(param(req, 'id'));
  if (!existing) throw notFound('视图不存在');
  if (existing.ownerId !== req.user!.sub) throw forbidden('只能修改自己的视图');
  const view = await r.updateView(param(req, 'id'), req.body);
  res.json({ ok: true, data: { view } });
});

/** 删除视图 */
viewsRouter.delete('/:id', requireAuth, async (req, res) => {
  const r = repo();
  const existing = await r.findViewById(param(req, 'id'));
  if (!existing) throw notFound('视图不存在');
  if (existing.ownerId !== req.user!.sub) throw forbidden('只能删除自己的视图');
  await r.deleteView(param(req, 'id'));
  res.json({ ok: true, data: { deleted: true } });
});

/** 按视图取说说列表 */
const viewListSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

viewsRouter.get('/:id/posts', validateQuery(viewListSchema), async (req, res) => {
  const r = repo();
  const q = getValidatedQuery<z.infer<typeof viewListSchema>>(req);
  const view = await r.findViewById(param(req, 'id'));
  if (!view) throw notFound('视图不存在');
  if (view.ownerId !== req.user?.sub) throw forbidden('无权访问该视图');

  const f = view.filters ?? {};
  const result = await r.listPosts({
    page: q.page,
    pageSize: q.pageSize,
    viewerId: req.user!.sub,
    visibility: f.visibility ?? 'all',
    status: f.status ?? 'published',
    keyword: f.keyword,
    tags: f.tags,
    from: f.from,
    to: f.to,
    hasLocation: f.hasLocation,
    sort: f.sort ?? 'latest',
  });

  res.json({ ok: true, data: { view, ...result } });
});
