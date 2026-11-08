import { randomUUID } from 'node:crypto';
import type {
  ApiToken,
  Attachment,
  CalendarCell,
  DashboardStats,
  Draft,
  MapPoint,
  MediaAsset,
  NoticeConfig,
  NoticeType,
  Post,
  PostQuery,
  Paged,
  SavedView,
  ShareLink,
  TagInfo,
  User,
} from '../../../../shared/types.js';
import type { CreatePostInput, Repository, UpdatePostInput } from '../repository.js';
import { queryTokens } from '../../lib/tokenize.js';

interface UserRow extends User {
  passwordHash: string;
}

interface PostRow extends Post {
  likedBy: string[];
  favoritedBy: string[];
}

const isoNow = () => new Date().toISOString();

/**
 * 内存驱动：纯 Node 实现，用于本地开发 / CI / 无 MongoDB 环境。
 * 语义与 MongoRepository 保持一致（含中文 token 检索、地理范围、日历分桶等）。
 */
export class MemoryRepository implements Repository {
  private users = new Map<string, UserRow>();
  private posts = new Map<string, PostRow>();
  private reactions = new Map<string, { postId: string; userId: string; kind: string }>();
  private shares = new Map<string, ShareLink>();
  private views = new Map<string, SavedView>();
  private drafts = new Map<string, Draft>();
  private medias = new Map<string, MediaAsset>();
  private apiTokens = new Map<string, ApiToken>();
  private notices = new Map<string, NoticeConfig>();

  async connect(): Promise<void> {
    /* 内存驱动无需连接 */
  }
  async disconnect(): Promise<void> {
    /* noop */
  }

  // ---------------- 用户 ----------------
  async createUser(input: {
    username: string;
    passwordHash: string;
    displayName: string;
    avatarColor: string;
  }): Promise<User> {
    const id = randomUUID();
    const user: UserRow = {
      id,
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      avatarColor: input.avatarColor,
      bio: '',
      createdAt: isoNow(),
    };
    this.users.set(id, user);
    return this.publicUser(user);
  }

  private publicUser(u: UserRow): User {
    const { passwordHash: _ph, ...rest } = u;
    return rest;
  }

  async findUserByUsername(username: string): Promise<(User & { passwordHash: string }) | null> {
    const u = [...this.users.values()].find((x) => x.username === username);
    return u ? { ...u } : null;
  }

  async findUserById(id: string): Promise<User | null> {
    const u = this.users.get(id);
    return u ? this.publicUser(u) : null;
  }

  async updateUserProfile(
    id: string,
    patch: Partial<Pick<User, 'displayName' | 'bio' | 'avatarColor'>>,
  ): Promise<User | null> {
    const u = this.users.get(id);
    if (!u) return null;
    Object.assign(u, patch);
    return this.publicUser(u);
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<boolean> {
    const u = this.users.get(id);
    if (!u) return false;
    u.passwordHash = passwordHash;
    return true;
  }

  async listUsers(): Promise<User[]> {
    return [...this.users.values()].map((u) => this.publicUser(u));
  }

  // ---------------- 说说 ----------------
  async createPost(input: CreatePostInput): Promise<Post> {
    const id = randomUUID();
    const now = isoNow();
    const row: PostRow = {
      id,
      authorId: input.authorId,
      content: input.content,
      plainText: input.plainText,
      mdcOptions: input.mdcOptions ?? [],
      tags: input.tags ?? [],
      visibility: input.visibility,
      status: 'published',
      archivedAt: null,
      location: input.location ?? null,
      attachments: input.attachments ?? [],
      device: input.device ?? null,
      stats: { likes: 0, favorites: 0, shares: 0, comments: 0 },
      liked: false,
      favorited: false,
      searchTokens: input.searchTokens ?? [],
      createdAt: now,
      updatedAt: now,
      likedBy: [],
      favoritedBy: [],
    };
    this.posts.set(id, row);
    return this.viewPost(row);
  }

  private viewPost(row: PostRow, viewerId?: string): Post {
    const { likedBy, favoritedBy, ...rest } = row;
    const author = this.users.get(row.authorId);
    return {
      ...rest,
      author: author ? this.publicUser(author) : undefined,
      liked: viewerId ? likedBy.includes(viewerId) : false,
      favorited: viewerId ? favoritedBy.includes(viewerId) : false,
    };
  }

  async updatePost(id: string, patch: UpdatePostInput): Promise<Post | null> {
    const row = this.posts.get(id);
    if (!row) return null;
    if (patch.content !== undefined) row.content = patch.content;
    if (patch.plainText !== undefined) row.plainText = patch.plainText;
    if (patch.tags !== undefined) row.tags = patch.tags;
    if (patch.visibility !== undefined) row.visibility = patch.visibility;
    if (patch.status !== undefined) {
      row.status = patch.status;
      // 进入封存态时打时间戳，离开时清掉
      row.archivedAt = patch.status === 'archived' ? isoNow() : null;
    }
    if (patch.location !== undefined) row.location = patch.location;
    if (patch.attachments !== undefined) row.attachments = patch.attachments;
    if (patch.mdcOptions !== undefined) row.mdcOptions = patch.mdcOptions;
    if (patch.searchTokens !== undefined) row.searchTokens = patch.searchTokens;
    row.updatedAt = isoNow();
    return this.viewPost(row);
  }

  async deletePost(id: string): Promise<boolean> {
    for (const [k, v] of [...this.reactions]) if (v.postId === id) this.reactions.delete(k);
    for (const [k, v] of [...this.shares]) if (v.postId === id) this.shares.delete(k);
    return this.posts.delete(id);
  }

  async findPostById(id: string, viewerId?: string): Promise<Post | null> {
    const row = this.posts.get(id);
    return row ? this.viewPost(row, viewerId) : null;
  }

  private matchPost(row: PostRow, q: PostQuery): boolean {
    if (q.authorIds && q.authorIds.length > 0 && !q.authorIds.includes(row.authorId)) return false;
    // 可见性：all = 公开 + 自己的私密
    if ((q.visibility ?? 'all') === 'all') {
      const visible = row.visibility === 'public' || (!!q.viewerId && row.authorId === q.viewerId);
      if (!visible) return false;
    } else if (q.visibility && q.visibility !== 'all' && row.visibility !== q.visibility) {
      return false;
    }
    if ((q.status ?? 'published') !== row.status) return false;
    if (q.tags && q.tags.length > 0 && !q.tags.every((t) => row.tags.includes(t))) return false;
    if (q.keyword && q.keyword.trim()) {
      const need = queryTokens(q.keyword);
      if (!need.every((t) => row.searchTokens.includes(t))) return false;
    }
    if (q.from && row.createdAt < q.from) return false;
    if (q.to && row.createdAt > q.to) return false;
    if (q.hasLocation === true && !row.location) return false;
    if (q.bbox && row.location) {
      const { minLat, minLng, maxLat, maxLng } = q.bbox;
      if (row.location.lat < minLat || row.location.lat > maxLat) return false;
      if (row.location.lng < minLng || row.location.lng > maxLng) return false;
    }
    if (q.likedBy && !row.likedBy.includes(q.likedBy)) return false;
    if (q.favoritedBy && !row.favoritedBy.includes(q.favoritedBy)) return false;
    return true;
  }

  async listPosts(query: PostQuery): Promise<Paged<Post>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    let rows = [...this.posts.values()].filter((r) => this.matchPost(r, query));

    const sort = query.sort ?? 'latest';
    rows.sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return a.createdAt.localeCompare(b.createdAt);
        case 'popular':
          return b.stats.likes - a.stats.likes || b.createdAt.localeCompare(a.createdAt);
        case 'liked':
          return b.stats.favorites - a.stats.favorites || b.createdAt.localeCompare(a.createdAt);
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });

    const total = rows.length;
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: slice.map((r) => this.viewPost(r, query.viewerId)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async setArchived(id: string, archived: boolean): Promise<Post | null> {
    const row = this.posts.get(id);
    if (!row) return null;
    row.status = archived ? 'archived' : 'published';
    row.archivedAt = archived ? isoNow() : null;
    row.updatedAt = isoNow();
    return this.viewPost(row);
  }

  async incrementStats(
    id: string,
    field: 'likes' | 'favorites' | 'shares',
    delta: number,
  ): Promise<void> {
    const row = this.posts.get(id);
    if (!row) return;
    row.stats[field] = Math.max(0, row.stats[field] + delta);
  }

  // ---------------- 点赞 / 收藏 ----------------
  private async toggleInternal(
    postId: string,
    userId: string,
    kind: 'like' | 'favorite',
  ): Promise<{ count: number; active: boolean }> {
    const row = this.posts.get(postId);
    if (!row) return { count: 0, active: false };
    const key = `${postId}|${userId}|${kind}`;
    const statsField = kind === 'like' ? 'likes' : 'favorites';
    const arrField = kind === 'like' ? 'likedBy' : 'favoritedBy';

    if (this.reactions.has(key)) {
      this.reactions.delete(key);
      row.stats[statsField] = Math.max(0, row.stats[statsField] - 1);
      row[arrField] = row[arrField].filter((x) => x !== userId);
      return { count: row.stats[statsField], active: false };
    }
    this.reactions.set(key, { postId, userId, kind });
    row.stats[statsField] += 1;
    if (!row[arrField].includes(userId)) row[arrField].push(userId);
    return { count: row.stats[statsField], active: true };
  }

  async toggleLike(postId: string, userId: string): Promise<{ liked: boolean; count: number }> {
    const r = await this.toggleInternal(postId, userId, 'like');
    return { liked: r.active, count: r.count };
  }

  async toggleFavorite(
    postId: string,
    userId: string,
  ): Promise<{ favorited: boolean; count: number }> {
    const r = await this.toggleInternal(postId, userId, 'favorite');
    return { favorited: r.active, count: r.count };
  }

  async isLiked(postId: string, userId: string): Promise<boolean> {
    return this.reactions.has(`${postId}|${userId}|like`);
  }

  async isFavorited(postId: string, userId: string): Promise<boolean> {
    return this.reactions.has(`${postId}|${userId}|favorite`);
  }

  async listLikedBy(postId: string): Promise<User[]> {
    const ids = [...this.reactions.values()]
      .filter((r) => r.postId === postId && r.kind === 'like')
      .map((r) => r.userId);
    return ids
      .map((id) => this.users.get(id))
      .filter((u): u is UserRow => !!u)
      .map((u) => this.publicUser(u));
  }

  // ---------------- 分享 ----------------
  async createShare(input: {
    postId: string;
    creatorId: string;
    token: string;
    expiresAt: string | null;
  }): Promise<ShareLink> {
    const share: ShareLink = { id: randomUUID(), ...input, createdAt: isoNow() };
    this.shares.set(share.id, share);
    const row = this.posts.get(input.postId);
    if (row) row.stats.shares += 1;
    return share;
  }

  async findShareByToken(token: string): Promise<ShareLink | null> {
    const s = [...this.shares.values()].find((x) => x.token === token);
    return s ?? null;
  }

  async listSharesByPost(postId: string): Promise<ShareLink[]> {
    return [...this.shares.values()]
      .filter((s) => s.postId === postId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listSharesByCreator(creatorId: string): Promise<ShareLink[]> {
    return [...this.shares.values()]
      .filter((s) => s.creatorId === creatorId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteShare(id: string): Promise<boolean> {
    return this.shares.delete(id);
  }

  // ---------------- 视图 ----------------
  async listViews(ownerId: string): Promise<SavedView[]> {
    return [...this.views.values()]
      .filter((v) => v.ownerId === ownerId)
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  }

  async createView(input: Omit<SavedView, 'id' | 'createdAt' | 'builtIn'>): Promise<SavedView> {
    const view: SavedView = { ...input, id: randomUUID(), builtIn: false, createdAt: isoNow() };
    this.views.set(view.id, view);
    return view;
  }

  async updateView(id: string, patch: Partial<SavedView>): Promise<SavedView | null> {
    const v = this.views.get(id);
    if (!v) return null;
    const { id: _i, createdAt: _c, ...rest } = patch;
    Object.assign(v, rest);
    return v;
  }

  async deleteView(id: string): Promise<boolean> {
    return this.views.delete(id);
  }

  async findViewById(id: string): Promise<SavedView | null> {
    return this.views.get(id) ?? null;
  }

  // ---------------- 草稿 ----------------
  async upsertDraft(input: {
    ownerId: string;
    key: string;
    content: string;
    tags: string[];
    attachments: Attachment[];
  }): Promise<Draft> {
    const mapKey = `${input.ownerId}|${input.key}`;
    const existing = this.drafts.get(mapKey);
    const draft: Draft = existing
      ? { ...existing, ...input, updatedAt: isoNow() }
      : { id: randomUUID(), ...input, updatedAt: isoNow() };
    this.drafts.set(mapKey, draft);
    return draft;
  }

  async findDraft(ownerId: string, key: string): Promise<Draft | null> {
    return this.drafts.get(`${ownerId}|${key}`) ?? null;
  }

  async listDrafts(ownerId: string): Promise<Draft[]> {
    return [...this.drafts.values()]
      .filter((d) => d.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deleteDraft(ownerId: string, key: string): Promise<boolean> {
    return this.drafts.delete(`${ownerId}|${key}`);
  }

  // ---------------- 媒体 ----------------
  async createMedia(input: Omit<MediaAsset, 'id' | 'createdAt'>): Promise<MediaAsset> {
    const media: MediaAsset = { ...input, id: randomUUID(), createdAt: isoNow() };
    this.medias.set(media.id, media);
    return media;
  }

  async findMediaById(id: string): Promise<MediaAsset | null> {
    return this.medias.get(id) ?? null;
  }

  async listMediaByOwner(ownerId: string): Promise<MediaAsset[]> {
    return [...this.medias.values()]
      .filter((m) => m.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteMedia(id: string): Promise<boolean> {
    return this.medias.delete(id);
  }

  // ---------------- 聚合 ----------------
  async listTags(ownerIds?: string[]): Promise<TagInfo[]> {
    const map = new Map<string, TagInfo>();
    for (const row of this.posts.values()) {
      if (row.status !== 'published') continue;
      if (ownerIds && ownerIds.length > 0 && !ownerIds.includes(row.authorId)) continue;
      for (const tag of row.tags) {
        const cur = map.get(tag);
        if (cur) {
          cur.count += 1;
          if (row.createdAt > cur.lastUsedAt) cur.lastUsedAt = row.createdAt;
        } else {
          map.set(tag, { name: tag, count: 1, lastUsedAt: row.createdAt });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  async calendarBuckets(query: PostQuery & { year: number; month: number }): Promise<CalendarCell[]> {
    const start = new Date(Date.UTC(query.year, query.month - 1, 1)).toISOString();
    const end = new Date(Date.UTC(query.year, query.month, 1)).toISOString();
    const rows = [...this.posts.values()].filter((r) => this.matchPost(r, { ...query, from: start, to: end }));
    const map = new Map<string, number>();
    for (const r of rows) {
      const d = r.createdAt.slice(0, 10);
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));
  }

  async mapPoints(query: PostQuery): Promise<MapPoint[]> {
    const rows = [...this.posts.values()]
      .filter((r) => this.matchPost(r, query) && !!r.location)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 500);
    return rows.map((r) => ({
      id: r.id,
      lat: r.location!.lat,
      lng: r.location!.lng,
      label: r.location!.label ?? '',
      title: (r.plainText ?? '').slice(0, 40) || '无标题说说',
      excerpt: (r.plainText ?? '').slice(0, 100),
      tags: r.tags,
      createdAt: r.createdAt,
    }));
  }

  async dashboardStats(ownerIds: string[]): Promise<DashboardStats> {
    const rows = [...this.posts.values()].filter((r) => ownerIds.includes(r.authorId));
    const agg = rows.reduce(
      (acc, r) => {
        acc.total += 1;
        if (r.status === 'published') acc.published += 1;
        if (r.status === 'archived') acc.archived += 1;
        if (r.visibility === 'private') acc.privateCount += 1;
        if (r.location) acc.withLocation += 1;
        acc.totalLikes += r.stats.likes;
        acc.totalFavorites += r.stats.favorites;
        acc.totalShares += r.stats.shares;
        acc.tagCount += r.tags.length;
        acc.mediaCount += rattachments(r);
        return acc;
      },
      {
        total: 0,
        published: 0,
        archived: 0,
        privateCount: 0,
        withLocation: 0,
        totalLikes: 0,
        totalFavorites: 0,
        totalShares: 0,
        tagCount: 0,
        mediaCount: 0,
      } as DashboardStats,
    );
    return agg;
  }

  async countByTag(ownerIds: string[], tag: string): Promise<number> {
    return [...this.posts.values()].filter(
      (r) => ownerIds.includes(r.authorId) && r.tags.includes(tag) && r.status === 'published',
    ).length;
  }

  // ---------------- 标签管理 ----------------
  async renameTag(ownerIds: string[], from: string, to: string): Promise<number> {
    let n = 0;
    for (const row of this.posts.values()) {
      if (!ownerIds.includes(row.authorId)) continue;
      const idx = row.tags.indexOf(from);
      if (idx < 0) continue;
      // 若新名已存在则去重，否则原位替换
      if (row.tags.includes(to)) {
        row.tags.splice(idx, 1);
      } else {
        row.tags[idx] = to;
      }
      row.searchTokens = queryTokens([row.plainText, ...row.tags].join(' '));
      n += 1;
    }
    return n;
  }

  async removeTag(ownerIds: string[], name: string): Promise<number> {
    let n = 0;
    for (const row of this.posts.values()) {
      if (!ownerIds.includes(row.authorId)) continue;
      const idx = row.tags.indexOf(name);
      if (idx < 0) continue;
      row.tags.splice(idx, 1);
      row.searchTokens = queryTokens([row.plainText, ...row.tags].join(' '));
      n += 1;
    }
    return n;
  }

  // ---------------- API 令牌 ----------------
  async createApiToken(input: {
    ownerId: string;
    name: string;
    token: string;
    prefix: string;
    scopes: string[];
    expiresAt: string | null;
  }): Promise<ApiToken> {
    const now = isoNow();
    const row: ApiToken = {
      id: randomUUID(),
      ownerId: input.ownerId,
      name: input.name,
      token: input.token,
      prefix: input.prefix,
      enabled: true,
      scopes: input.scopes,
      lastUsedAt: null,
      expiresAt: input.expiresAt,
      createdAt: now,
    };
    this.apiTokens.set(row.id, row);
    return row;
  }

  async findApiTokenByHash(tokenHash: string): Promise<ApiToken | null> {
    for (const row of this.apiTokens.values()) {
      if (row.token === tokenHash) return row;
    }
    return null;
  }

  async listApiTokens(ownerId: string): Promise<ApiToken[]> {
    return [...this.apiTokens.values()]
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateApiToken(
    id: string,
    patch: Partial<Pick<ApiToken, 'name' | 'enabled' | 'scopes' | 'expiresAt'>>,
  ): Promise<ApiToken | null> {
    const row = this.apiTokens.get(id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  }

  async deleteApiToken(id: string): Promise<boolean> {
    return this.apiTokens.delete(id);
  }

  async touchApiToken(id: string): Promise<void> {
    const row = this.apiTokens.get(id);
    if (row) row.lastUsedAt = isoNow();
  }

  // ---------------- 通知渠道 ----------------
  async createNotice(input: {
    ownerId: string;
    type: NoticeType;
    token: string;
    title: string;
    enabled: boolean;
    onPostCreate: boolean;
  }): Promise<NoticeConfig> {
    const row: NoticeConfig = {
      id: randomUUID(),
      ownerId: input.ownerId,
      type: input.type,
      token: input.token,
      title: input.title,
      enabled: input.enabled,
      onPostCreate: input.onPostCreate,
      lastSentAt: null,
      createdAt: isoNow(),
    };
    this.notices.set(row.id, row);
    return row;
  }

  async listNotices(ownerId: string): Promise<NoticeConfig[]> {
    return [...this.notices.values()]
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateNotice(
    id: string,
    patch: Partial<Pick<NoticeConfig, 'type' | 'token' | 'title' | 'enabled' | 'onPostCreate'>>,
  ): Promise<NoticeConfig | null> {
    const row = this.notices.get(id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  }

  async deleteNotice(id: string): Promise<boolean> {
    return this.notices.delete(id);
  }

  async touchNotice(id: string): Promise<void> {
    const row = this.notices.get(id);
    if (row) row.lastSentAt = isoNow();
  }

  async listActiveNotices(ownerId: string): Promise<NoticeConfig[]> {
    return [...this.notices.values()].filter(
      (r) => r.ownerId === ownerId && r.enabled && r.onPostCreate,
    );
  }
}

function rattachments(r: PostRow): number {
  return r.attachments.length;
}
