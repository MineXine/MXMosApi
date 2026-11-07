import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { PostQuery } from '../../../shared/types.js';
import { ALLOWED_MDC, MDC_DEFAULTS, parseMdcOptions } from '../../../shared/mdc.js';
import { repo } from './filters.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery, getValidatedQuery } from '../middleware/error.js';
import { forbidden, notFound } from '../lib/errors.js';
import { extractTags, toPlainText, tokenize } from '../lib/tokenize.js';
import { parseDevice } from '../lib/device.js';
import { param } from '../lib/params.js';

export const postsRouter = Router();

/* ------------------------------------------------------------------ *
 * MDC 组件解析
 *
 * 组件白名单、默认选项表与解析逻辑统一由 shared/mdc.ts 提供，
 * 前端编辑器预览复用同一份实现，保证两端渲染结果一致。
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 校验 schema
 * ------------------------------------------------------------------ */

const attachmentSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  filename: z.string().optional().default(''),
  mime: z.string().optional().default(''),
  size: z.number().optional().default(0),
  width: z.number().optional(),
  height: z.number().optional(),
  kind: z.enum(['image', 'video', 'audio', 'file']).optional().default('image'),
});

const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().max(120).optional(),
  address: z.string().max(240).optional(),
});

const createPostSchema = z.object({
  content: z.string().min(1, '内容不能为空').max(20000),
  visibility: z.enum(['public', 'private']).optional().default('public'),
  tags: z.array(z.string().min(1).max(32)).max(12).optional(),
  location: geoSchema.nullable().optional(),
  attachments: z.array(attachmentSchema).max(20).optional(),
});

const updatePostSchema = z.object({
  content: z.string().min(1).max(20000).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  tags: z.array(z.string().min(1).max(32)).max(12).optional(),
  location: geoSchema.nullable().optional(),
  attachments: z.array(attachmentSchema).max(20).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  visibility: z.enum(['public', 'private', 'all']).optional().default('all'),
  status: z.enum(['published', 'archived']).optional().default('published'),
  keyword: z.string().max(120).optional(),
  tags: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  hasLocation: z.coerce.boolean().optional(),
  sort: z.enum(['latest', 'oldest', 'popular', 'liked']).optional().default('latest'),
  authorId: z.string().optional(),
  liked: z.coerce.boolean().optional(),
  favorited: z.coerce.boolean().optional(),
  minLat: z.coerce.number().optional(),
  minLng: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  maxLng: z.coerce.number().optional(),
});

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

/** 说说列表（时间线 / 搜索 / 标签 / 视图 统一入口） */
postsRouter.get('/', validateQuery(listQuerySchema), async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof listQuerySchema>>(req);
  const viewerId = req.user?.sub;

  const query: PostQuery = {
    page: q.page,
    pageSize: q.pageSize,
    visibility: q.visibility,
    status: q.status,
    keyword: q.keyword,
    from: q.from,
    to: q.to,
    hasLocation: q.hasLocation,
    sort: q.sort,
    viewerId,
  };

  if (q.tags) {
    query.tags = q.tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }
  if (q.authorId) query.authorIds = [q.authorId];
  if (q.liked) query.likedBy = viewerId ?? '__none__';
  if (q.favorited) query.favoritedBy = viewerId ?? '__none__';
  if (q.minLat !== undefined && q.minLng !== undefined && q.maxLat !== undefined && q.maxLng !== undefined) {
    query.bbox = { minLat: q.minLat, minLng: q.minLng, maxLat: q.maxLat, maxLng: q.maxLng };
  }

  const result = await repo().listPosts(query);
  res.json({ ok: true, data: result });
});

/** 创建说说 */
postsRouter.post('/', requireAuth, validateBody(createPostSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createPostSchema>;
  const r = repo();

  const plainText = toPlainText(body.content);
  const tags = body.tags?.length ? body.tags.map((t) => t.toLowerCase()) : extractTags(body.content, plainText);
  const mdcOptions = parseMdcOptions(body.content, MDC_DEFAULTS);

  const post = await r.createPost({
    authorId: req.user!.sub,
    content: body.content,
    plainText,
    tags: [...new Set(tags)],
    visibility: body.visibility ?? 'public',
    location: body.location ?? null,
    attachments: body.attachments ?? [],
    device: parseDevice(req.headers['user-agent']),
    mdcOptions,
    searchTokens: tokenize(`${body.content} ${plainText} ${tags.join(' ')}`),
  });

  res.status(201).json({ ok: true, data: { post } });
});

/** 标签列表 */
postsRouter.get('/tags/list', async (_req, res) => {
  const tags = await repo().listTags();
  res.json({ ok: true, data: { tags } });
});

/** 日历视图数据 */
const calendarSchema = z.object({
  year: z.coerce.number().int().min(1970).max(3000),
  month: z.coerce.number().int().min(1).max(12),
  visibility: z.enum(['public', 'private', 'all']).optional().default('all'),
  tags: z.string().optional(),
  authorId: z.string().optional(),
});

postsRouter.get('/calendar/buckets', validateQuery(calendarSchema), async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof calendarSchema>>(req);
  const cells = await repo().calendarBuckets({
    year: q.year,
    month: q.month,
    visibility: q.visibility,
    viewerId: req.user?.sub,
    authorIds: q.authorId ? [q.authorId] : undefined,
    tags: q.tags ? q.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) : undefined,
    status: 'published',
  });
  res.json({ ok: true, data: { cells } });
});

/** 地图视图数据 */
const mapSchema = z.object({
  visibility: z.enum(['public', 'private', 'all']).optional().default('all'),
  tags: z.string().optional(),
  minLat: z.coerce.number().optional(),
  minLng: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  maxLng: z.coerce.number().optional(),
});

postsRouter.get('/map/points', validateQuery(mapSchema), async (req, res) => {
  const q = getValidatedQuery<z.infer<typeof mapSchema>>(req);
  const points = await repo().mapPoints({
    visibility: q.visibility,
    viewerId: req.user?.sub,
    tags: q.tags ? q.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) : undefined,
    status: 'published',
    bbox:
      q.minLat !== undefined && q.minLng !== undefined && q.maxLat !== undefined && q.maxLng !== undefined
        ? { minLat: q.minLat, minLng: q.minLng, maxLat: q.maxLat, maxLng: q.maxLng }
        : undefined,
  });
  res.json({ ok: true, data: { points } });
});

/** 说说详情 */
postsRouter.get('/:id', async (req, res) => {
  const post = await repo().findPostById(param(req, 'id'), req.user?.sub);
  if (!post) throw notFound('说说不存在');

  // 私密说说仅作者可见
  if (post.visibility === 'private' && post.authorId !== req.user?.sub) {
    throw forbidden('该说说为私密内容');
  }
  res.json({ ok: true, data: { post } });
});

/** 更新说说 */
postsRouter.patch('/:id', requireAuth, validateBody(updatePostSchema), async (req, res) => {
  const r = repo();
  const existing = await r.findPostById(param(req, 'id'), req.user!.sub);
  if (!existing) throw notFound('说说不存在');
  if (existing.authorId !== req.user!.sub) throw forbidden('只能编辑自己的说说');

  const body = req.body as z.infer<typeof updatePostSchema>;
  const patch: Record<string, unknown> = {};

  if (body.content !== undefined) {
    patch.content = body.content;
    patch.plainText = toPlainText(body.content);
    patch.mdcOptions = parseMdcOptions(body.content, MDC_DEFAULTS);
    // 正文变化时重新抽取标签（未显式传 tags 才覆盖）
    if (body.tags === undefined) {
      patch.tags = extractTags(body.content, patch.plainText as string);
    }
  }
  if (body.tags !== undefined) patch.tags = body.tags.map((t) => t.toLowerCase());
  if (body.visibility !== undefined) patch.visibility = body.visibility;
  if (body.location !== undefined) patch.location = body.location;
  if (body.attachments !== undefined) patch.attachments = body.attachments;

  const plain = (patch.plainText as string) ?? existing.plainText;
  const tagList = (patch.tags as string[]) ?? existing.tags;
  patch.searchTokens = tokenize(`${patch.content ?? existing.content} ${plain} ${tagList.join(' ')}`);

  const post = await r.updatePost(param(req, 'id'), patch);
  res.json({ ok: true, data: { post } });
});

/** 删除说说 */
postsRouter.delete('/:id', requireAuth, async (req, res) => {
  const r = repo();
  const existing = await r.findPostById(param(req, 'id'));
  if (!existing) throw notFound('说说不存在');
  if (existing.authorId !== req.user!.sub) throw forbidden('只能删除自己的说说');
  await r.deletePost(param(req, 'id'));
  res.json({ ok: true, data: { deleted: true } });
});

/** 归档 */
postsRouter.post('/:id/archive', requireAuth, async (req, res) => {
  const r = repo();
  const existing = await r.findPostById(param(req, 'id'));
  if (!existing) throw notFound('说说不存在');
  if (existing.authorId !== req.user!.sub) throw forbidden('只能归档自己的说说');
  const post = await r.setArchived(param(req, 'id'), true);
  res.json({ ok: true, data: { post } });
});

/** 恢复 */
postsRouter.post('/:id/unarchive', requireAuth, async (req, res) => {
  const r = repo();
  const existing = await r.findPostById(param(req, 'id'));
  if (!existing) throw notFound('说说不存在');
  if (existing.authorId !== req.user!.sub) throw forbidden('只能恢复自己的说说');
  const post = await r.setArchived(param(req, 'id'), false);
  res.json({ ok: true, data: { post } });
});

/** 点赞 / 取消点赞 */
postsRouter.post('/:id/like', requireAuth, async (req, res) => {
  const r = repo();
  const post = await r.findPostById(param(req, 'id'));
  if (!post) throw notFound('说说不存在');
  const result = await r.toggleLike(param(req, 'id'), req.user!.sub);
  res.json({ ok: true, data: result });
});

/** 收藏 / 取消收藏 */
postsRouter.post('/:id/favorite', requireAuth, async (req, res) => {
  const r = repo();
  const post = await r.findPostById(param(req, 'id'));
  if (!post) throw notFound('说说不存在');
  const result = await r.toggleFavorite(param(req, 'id'), req.user!.sub);
  res.json({ ok: true, data: result });
});

/** 点赞用户列表 */
postsRouter.get('/:id/likes', async (req, res) => {
  const users = await repo().listLikedBy(param(req, 'id'));
  res.json({ ok: true, data: { users } });
});

/** 生成分享链接 */
postsRouter.post('/:id/share', requireAuth, async (req, res) => {
  const r = repo();
  const post = await r.findPostById(param(req, 'id'));
  if (!post) throw notFound('说说不存在');
  if (post.authorId !== req.user!.sub && post.visibility === 'private') {
    throw forbidden('私密说说不能分享');
  }

  const body = (req.body ?? {}) as { expiresInDays?: number };
  const expiresAt =
    body.expiresInDays && body.expiresInDays > 0
      ? new Date(Date.now() + body.expiresInDays * 86400_000).toISOString()
      : null;

  const share = await r.createShare({
    postId: post.id,
    creatorId: req.user!.sub,
    token: nanoid(24),
    expiresAt,
  });

  res.status(201).json({ ok: true, data: { share } });
});

/** 分享链接列表（按说说） */
postsRouter.get('/:id/shares', requireAuth, async (req, res) => {
  const shares = await repo().listSharesByPost(param(req, 'id'));
  res.json({ ok: true, data: { shares } });
});

/** 撤销分享 */
postsRouter.delete('/:id/shares/:shareId', requireAuth, async (req, res) => {
  const r = repo();
  const shares = await r.listSharesByPost(param(req, 'id'));
  const target = shares.find((s) => s.id === param(req, 'shareId'));
  if (!target) throw notFound('分享记录不存在');
  if (target.creatorId !== req.user!.sub) throw forbidden('只能撤销自己的分享');
  await r.deleteShare(target.id);
  res.json({ ok: true, data: { deleted: true } });
});

export { parseMdcOptions, MDC_DEFAULTS, ALLOWED_MDC };
