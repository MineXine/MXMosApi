import type { Post, PostQuery } from '../../../../shared/types.js';
import { queryTokens } from '../../lib/tokenize.js';

/**
 * 构建 Mongo 过滤器。
 *
 * 可见性规则（visibility = 'all' 时）：
 *   公开说说 OR 自己的私密说说
 */
export function buildPostFilter(query: PostQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  if (query.visibility === 'all') {
    if (query.viewerId) {
      filter.$or = [
        { visibility: 'public' },
        { visibility: 'private', authorId: query.viewerId },
      ];
    } else {
      filter.visibility = 'public';
    }
  } else if (query.visibility && query.visibility !== 'public') {
    filter.visibility = query.visibility;
  } else if (query.visibility === 'public') {
    filter.visibility = 'public';
  }

  // 显式限定作者（标签页 / 视图场景）
  if (query.authorIds && query.authorIds.length > 0) {
    filter.authorId = { $in: query.authorIds };
  }

  filter.status = query.status ?? 'published';

  if (query.tags && query.tags.length > 0) {
    filter.tags = { $all: query.tags };
  }

  if (query.keyword && query.keyword.trim()) {
    // 中文检索走 searchTokens 多值索引
    filter.searchTokens = { $all: queryTokens(query.keyword) };
  }

  const range: Record<string, string> = {};
  if (query.from) range.$gte = query.from;
  if (query.to) range.$lte = query.to;
  if (query.from || query.to) filter.createdAt = range;

  if (query.hasLocation === true) {
    filter['location.lat'] = { $exists: true };
  }

  if (query.bbox) {
    filter['location.lat'] = { $gte: query.bbox.minLat, $lte: query.bbox.maxLat };
    filter['location.lng'] = { $gte: query.bbox.minLng, $lte: query.bbox.maxLng };
  }

  if (query.likedBy) filter.likedBy = query.likedBy;
  if (query.favoritedBy) filter.favoritedBy = query.favoritedBy;

  return filter;
}

export function buildPostSort(sort: PostQuery['sort']): Record<string, 1 | -1> {
  switch (sort) {
    case 'oldest':
      return { createdAt: 1 };
    case 'popular':
      return { 'stats.likes': -1, createdAt: -1 };
    case 'liked':
      return { 'stats.favorites': -1, createdAt: -1 };
    case 'latest':
    default:
      return { createdAt: -1 };
  }
}

/** 统一的 Post 序列化（Mongo 文档 -> 领域对象） */
export function serializePost(doc: any, viewerId?: string): Post {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const likedBy: string[] = obj.likedBy ?? [];
  const favoritedBy: string[] = obj.favoritedBy ?? [];
  return {
    id: String(obj._id ?? obj.id),
    authorId: obj.authorId,
    content: obj.content,
    plainText: obj.plainText,
    mdcOptions: obj.mdcOptions ?? [],
    tags: obj.tags ?? [],
    visibility: obj.visibility,
    status: obj.status,
    archivedAt: obj.archivedAt ?? null,
    location: obj.location ?? null,
    attachments: obj.attachments ?? [],
    device: obj.device ?? null,
    stats: {
      likes: obj.stats?.likes ?? 0,
      favorites: obj.stats?.favorites ?? 0,
      shares: obj.stats?.shares ?? 0,
      comments: obj.stats?.comments ?? 0,
    },
    liked: viewerId ? likedBy.includes(viewerId) : false,
    favorited: viewerId ? favoritedBy.includes(viewerId) : false,
    searchTokens: obj.searchTokens ?? [],
    createdAt:
      obj.createdAt instanceof Date ? obj.createdAt.toISOString() : (obj.createdAt ?? ''),
    updatedAt:
      obj.updatedAt instanceof Date ? obj.updatedAt.toISOString() : (obj.updatedAt ?? ''),
  };
}
