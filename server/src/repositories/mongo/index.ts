import mongoose from 'mongoose';
import type {
  Attachment,
  CalendarCell,
  DashboardStats,
  Draft,
  MapPoint,
  MediaAsset,
  Post,
  PostQuery,
  Paged,
  SavedView,
  ShareLink,
  TagInfo,
  User,
} from '../../../../shared/types.js';
import type {
  CreatePostInput,
  Repository,
  UpdatePostInput,
} from '../repository.js';
import { buildPostFilter, buildPostSort, serializePost } from './query.js';
import { env } from '../../config/env.js';
import {
  DraftModel,
  MediaModel,
  PostModel,
  ReactionModel,
  ShareModel,
  UserModel,
  ViewModel,
} from './models.js';

const iso = (d: Date | string | null | undefined): string =>
  d instanceof Date ? d.toISOString() : (d ?? new Date().toISOString());

function serializeUser(doc: any): User {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(o._id ?? o.id),
    username: o.username,
    displayName: o.displayName,
    avatarColor: o.avatarColor ?? '#6366f1',
    bio: o.bio ?? '',
    createdAt: iso(o.createdAt),
  };
}

export class MongoRepository implements Repository {
  async connect(): Promise<void> {
    await mongoose.connect(env.mongoUri);
  }
  async disconnect(): Promise<void> {
    await mongoose.disconnect();
  }

  // ---------------- 用户 ----------------
  async createUser(input: {
    username: string;
    passwordHash: string;
    displayName: string;
    avatarColor: string;
  }): Promise<User> {
    const doc = await UserModel.create(input);
    return serializeUser(doc);
  }

  async findUserByUsername(username: string): Promise<(User & { passwordHash: string }) | null> {
    const doc = await UserModel.findOne({ username }).lean();
    if (!doc) return null;
    return { ...serializeUser(doc), passwordHash: (doc as any).passwordHash } as User & {
      passwordHash: string;
    };
  }

  async findUserById(id: string): Promise<User | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await UserModel.findById(id).lean();
    return doc ? serializeUser(doc) : null;
  }

  async updateUserProfile(
    id: string,
    patch: Partial<Pick<User, 'displayName' | 'bio' | 'avatarColor'>>,
  ): Promise<User | null> {
    const doc = await UserModel.findByIdAndUpdate(id, patch, { new: true }).lean();
    return doc ? serializeUser(doc) : null;
  }

  async listUsers(): Promise<User[]> {
    const docs = await UserModel.find().sort({ createdAt: 1 }).lean();
    return docs.map(serializeUser);
  }

  // ---------------- 说说 ----------------
  async createPost(input: CreatePostInput): Promise<Post> {
    const doc = await PostModel.create(input);
    return serializePost(doc.toObject());
  }

  async updatePost(id: string, patch: UpdatePostInput): Promise<Post | null> {
    const doc = await PostModel.findByIdAndUpdate(id, patch, { new: true }).lean();
    return doc ? serializePost(doc) : null;
  }

  async deletePost(id: string): Promise<boolean> {
    const res = await PostModel.findByIdAndDelete(id);
    return !!res;
  }

  async findPostById(id: string, viewerId?: string): Promise<Post | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await PostModel.findById(id).lean();
    if (!doc) return null;
    return serializePost(doc, viewerId);
  }

  async listPosts(query: PostQuery): Promise<Paged<Post>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const filter = buildPostFilter(query);
    const sort = buildPostSort(query.sort);

    const [docs, total] = await Promise.all([
      PostModel.find(filter).sort(sort).skip((page - 1) * pageSize).limit(pageSize).lean(),
      PostModel.countDocuments(filter),
    ]);

    const items = docs.map((d) => serializePost(d, query.viewerId));
    // 批量补作者信息
    await this.attachAuthors(items);

    return {
      items,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  private async attachAuthors(posts: Post[]): Promise<void> {
    if (posts.length === 0) return;
    const ids = [...new Set(posts.map((p) => p.authorId))];
    const users = await UserModel.find({ _id: { $in: ids } }).lean();
    const map = new Map(users.map((u) => [String(u._id), serializeUser(u)]));
    for (const p of posts) {
      const u = map.get(p.authorId);
      if (u) p.author = u;
    }
  }

  async setArchived(id: string, archived: boolean): Promise<Post | null> {
    const patch = archived
      ? { status: 'archived', archivedAt: new Date().toISOString() }
      : { status: 'published', archivedAt: null };
    const doc = await PostModel.findByIdAndUpdate(id, patch, { new: true }).lean();
    return doc ? serializePost(doc) : null;
  }

  async incrementStats(
    id: string,
    field: 'likes' | 'favorites' | 'shares',
    delta: number,
  ): Promise<void> {
    await PostModel.updateOne({ _id: id }, { $inc: { [`stats.${field}`]: delta } });
  }

  // ---------------- 点赞 / 收藏 ----------------
  private async toggle(
    postId: string,
    userId: string,
    kind: 'like' | 'favorite',
  ): Promise<{ count: number; active: boolean }> {
    const existing = await ReactionModel.findOne({ postId, userId, kind });
    const statsField = kind === 'like' ? 'likes' : 'favorites';
    const arrField = kind === 'like' ? 'likedBy' : 'favoritedBy';

    if (existing) {
      await ReactionModel.deleteOne({ _id: existing._id });
      await PostModel.updateOne({ _id: postId }, { $inc: { [`stats.${statsField}`]: -1 } });
      await PostModel.updateOne({ _id: postId }, { $pull: { [arrField]: userId } });
      const count = Math.max(0, (await PostModel.findById(postId).lean())?.stats?.[statsField] ?? 0);
      return { count, active: false };
    }

    await ReactionModel.create({ postId, userId, kind });
    await PostModel.updateOne({ _id: postId }, { $inc: { [`stats.${statsField}`]: 1 } });
    await PostModel.updateOne({ _id: postId }, { $addToSet: { [arrField]: userId } });
    const count = (await PostModel.findById(postId).lean())?.stats?.[statsField] ?? 0;
    return { count, active: true };
  }

  async toggleLike(postId: string, userId: string): Promise<{ liked: boolean; count: number }> {
    const r = await this.toggle(postId, userId, 'like');
    return { liked: r.active, count: r.count };
  }

  async toggleFavorite(
    postId: string,
    userId: string,
  ): Promise<{ favorited: boolean; count: number }> {
    const r = await this.toggle(postId, userId, 'favorite');
    return { favorited: r.active, count: r.count };
  }

  async isLiked(postId: string, userId: string): Promise<boolean> {
    return !!(await ReactionModel.exists({ postId, userId, kind: 'like' }));
  }

  async isFavorited(postId: string, userId: string): Promise<boolean> {
    return !!(await ReactionModel.exists({ postId, userId, kind: 'favorite' }));
  }

  async listLikedBy(postId: string): Promise<User[]> {
    const rows = await ReactionModel.find({ postId, kind: 'like' }).lean();
    const ids = rows.map((r) => r.userId);
    const users = await UserModel.find({ _id: { $in: ids } }).lean();
    return users.map(serializeUser);
  }

  // ---------------- 分享 ----------------
  async createShare(input: {
    postId: string;
    creatorId: string;
    token: string;
    expiresAt: string | null;
  }): Promise<ShareLink> {
    const doc = await ShareModel.create(input);
    const o = doc.toObject();
    return {
      id: String(o._id),
      postId: o.postId,
      token: o.token,
      creatorId: o.creatorId,
      expiresAt: o.expiresAt ?? null,
      createdAt: iso(o.createdAt),
    };
  }

  async findShareByToken(token: string): Promise<ShareLink | null> {
    const o = await ShareModel.findOne({ token }).lean();
    if (!o) return null;
    return {
      id: String(o._id),
      postId: o.postId,
      token: o.token,
      creatorId: o.creatorId,
      expiresAt: o.expiresAt ?? null,
      createdAt: iso(o.createdAt),
    };
  }

  async listSharesByPost(postId: string): Promise<ShareLink[]> {
    const docs = await ShareModel.find({ postId }).sort({ createdAt: -1 }).lean();
    return docs.map((o) => ({
      id: String(o._id),
      postId: o.postId,
      token: o.token,
      creatorId: o.creatorId,
      expiresAt: o.expiresAt ?? null,
      createdAt: iso(o.createdAt),
    }));
  }

  async listSharesByCreator(creatorId: string): Promise<ShareLink[]> {
    const docs = await ShareModel.find({ creatorId }).sort({ createdAt: -1 }).lean();
    return docs.map((o) => ({
      id: String(o._id),
      postId: o.postId,
      token: o.token,
      creatorId: o.creatorId,
      expiresAt: o.expiresAt ?? null,
      createdAt: iso(o.createdAt),
    }));
  }

  async deleteShare(id: string): Promise<boolean> {
    const res = await ShareModel.findByIdAndDelete(id);
    return !!res;
  }

  // ---------------- 视图 ----------------
  private serializeView(o: any): SavedView {
    return {
      id: String(o._id ?? o.id),
      ownerId: o.ownerId,
      name: o.name,
      icon: o.icon ?? 'inbox',
      description: o.description ?? '',
      filters: o.filters ?? {},
      builtIn: o.builtIn ?? false,
      order: o.order ?? 0,
      createdAt: iso(o.createdAt),
    };
  }

  async listViews(ownerId: string): Promise<SavedView[]> {
    const docs = await ViewModel.find({ ownerId }).sort({ order: 1, createdAt: 1 }).lean();
    return docs.map(this.serializeView);
  }

  async createView(input: Omit<SavedView, 'id' | 'createdAt' | 'builtIn'>): Promise<SavedView> {
    const doc = await ViewModel.create({ ...input, builtIn: false });
    return this.serializeView(doc.toObject());
  }

  async updateView(id: string, patch: Partial<SavedView>): Promise<SavedView | null> {
    const { id: _id, createdAt: _c, ...rest } = patch;
    const doc = await ViewModel.findByIdAndUpdate(id, rest, { new: true }).lean();
    return doc ? this.serializeView(doc) : null;
  }

  async deleteView(id: string): Promise<boolean> {
    const res = await ViewModel.findByIdAndDelete(id);
    return !!res;
  }

  async findViewById(id: string): Promise<SavedView | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await ViewModel.findById(id).lean();
    return doc ? this.serializeView(doc) : null;
  }

  // ---------------- 草稿 ----------------
  private serializeDraft(o: any): Draft {
    return {
      id: String(o._id ?? o.id),
      ownerId: o.ownerId,
      key: o.key,
      content: o.content ?? '',
      tags: o.tags ?? [],
      attachments: o.attachments ?? [],
      updatedAt: iso(o.updatedAt),
    };
  }

  async upsertDraft(input: {
    ownerId: string;
    key: string;
    content: string;
    tags: string[];
    attachments: Attachment[];
  }): Promise<Draft> {
    const doc = await DraftModel.findOneAndUpdate(
      { ownerId: input.ownerId, key: input.key },
      { ...input },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return this.serializeDraft(doc);
  }

  async findDraft(ownerId: string, key: string): Promise<Draft | null> {
    const doc = await DraftModel.findOne({ ownerId, key }).lean();
    return doc ? this.serializeDraft(doc) : null;
  }

  async listDrafts(ownerId: string): Promise<Draft[]> {
    const docs = await DraftModel.find({ ownerId }).sort({ updatedAt: -1 }).lean();
    return docs.map(this.serializeDraft);
  }

  async deleteDraft(ownerId: string, key: string): Promise<boolean> {
    const res = await DraftModel.deleteOne({ ownerId, key });
    return (res.deletedCount ?? 0) > 0;
  }

  // ---------------- 媒体 ----------------
  private serializeMedia(o: any): MediaAsset {
    return {
      id: String(o._id ?? o.id),
      ownerId: o.ownerId,
      url: o.url,
      filename: o.filename ?? '',
      mime: o.mime ?? '',
      size: o.size ?? 0,
      width: o.width,
      height: o.height,
      kind: o.kind ?? 'image',
      createdAt: iso(o.createdAt),
    };
  }

  async createMedia(input: Omit<MediaAsset, 'id' | 'createdAt'>): Promise<MediaAsset> {
    const doc = await MediaModel.create(input);
    return this.serializeMedia(doc.toObject());
  }

  async findMediaById(id: string): Promise<MediaAsset | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await MediaModel.findById(id).lean();
    return doc ? this.serializeMedia(doc) : null;
  }

  async listMediaByOwner(ownerId: string): Promise<MediaAsset[]> {
    const docs = await MediaModel.find({ ownerId }).sort({ createdAt: -1 }).lean();
    return docs.map(this.serializeMedia);
  }

  async deleteMedia(id: string): Promise<boolean> {
    const res = await MediaModel.findByIdAndDelete(id);
    return !!res;
  }

  // ---------------- 聚合 ----------------
  async listTags(ownerIds?: string[]): Promise<TagInfo[]> {
    const match: Record<string, unknown> = { status: 'published' };
    if (ownerIds && ownerIds.length > 0) match.authorId = { $in: ownerIds };
    const rows = await PostModel.aggregate([
      { $match: match },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          lastUsedAt: { $max: '$createdAt' },
        },
      },
      { $sort: { count: -1, _id: 1 } },
    ]);
    return rows.map((r) => ({
      name: r._id,
      count: r.count,
      lastUsedAt: iso(r.lastUsedAt),
    }));
  }

  async calendarBuckets(query: PostQuery & { year: number; month: number }): Promise<CalendarCell[]> {
    const start = new Date(Date.UTC(query.year, query.month - 1, 1)).toISOString();
    const end = new Date(Date.UTC(query.year, query.month, 1)).toISOString();
    const filter = buildPostFilter({ ...query, from: start, to: end });
    const rows = await PostModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((r) => ({ date: r._id, count: r.count }));
  }

  async mapPoints(query: PostQuery): Promise<MapPoint[]> {
    const filter = buildPostFilter(query);
    filter['location.lat'] = { $exists: true };
    const docs = await PostModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    return docs.map((o) => ({
      id: String(o._id),
      lat: o.location?.lat ?? 0,
      lng: o.location?.lng ?? 0,
      label: o.location?.label ?? '',
      title: (o.plainText ?? '').slice(0, 40) || '无标题说说',
      excerpt: (o.plainText ?? '').slice(0, 100),
      tags: o.tags ?? [],
      createdAt: iso(o.createdAt),
    }));
  }

  async dashboardStats(ownerIds: string[]): Promise<DashboardStats> {
    const match = { authorId: { $in: ownerIds } };
    const [agg] = await PostModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } },
          archived: { $sum: { $cond: [{ $eq: ['$status', 'archived'] }, 1, 0] } },
          privateCount: { $sum: { $cond: [{ $eq: ['$visibility', 'private'] }, 1, 0] } },
          withLocation: { $sum: { $cond: [{ $ifNull: ['$location', false] }, 1, 0] } },
          totalLikes: { $sum: '$stats.likes' },
          totalFavorites: { $sum: '$stats.favorites' },
          totalShares: { $sum: '$stats.shares' },
          tagCount: { $sum: { $size: { $ifNull: ['$tags', []] } } },
          mediaCount: { $sum: { $size: { $ifNull: ['$attachments', []] } } },
        },
      },
    ]);
    return {
      total: agg?.total ?? 0,
      published: agg?.published ?? 0,
      archived: agg?.archived ?? 0,
      privateCount: agg?.privateCount ?? 0,
      withLocation: agg?.withLocation ?? 0,
      totalLikes: agg?.totalLikes ?? 0,
      totalFavorites: agg?.totalFavorites ?? 0,
      totalShares: agg?.totalShares ?? 0,
      tagCount: agg?.tagCount ?? 0,
      mediaCount: agg?.mediaCount ?? 0,
    };
  }

  async countByTag(ownerIds: string[], tag: string): Promise<number> {
    return PostModel.countDocuments({
      authorId: { $in: ownerIds },
      tags: tag,
      status: 'published',
    });
  }
}
