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
} from '../../../shared/types.js';

export interface CreatePostInput {
  authorId: string;
  content: string;
  plainText: string;
  tags: string[];
  visibility: Post['visibility'];
  location: Post['location'];
  attachments: Attachment[];
  device: Post['device'];
  mdcOptions: Post['mdcOptions'];
  searchTokens: string[];
}

export interface UpdatePostInput {
  content?: string;
  plainText?: string;
  tags?: string[];
  visibility?: Post['visibility'];
  /** 状态流转：published / archived / hidden */
  status?: Post['status'];
  location?: Post['location'];
  attachments?: Attachment[];
  mdcOptions?: Post['mdcOptions'];
  searchTokens?: string[];
}

/**
 * 仓储统一接口。
 * MongoDB(Mongoose) 与内存驱动各自实现，API 层与业务层零差异。
 */
export interface Repository {
  /** 建立连接（内存驱动为空实现） */
  connect?(): Promise<void>;
  /** 关闭连接 */
  disconnect?(): Promise<void>;

  // ---- 用户 ----
  createUser(input: {
    username: string;
    passwordHash: string;
    displayName: string;
    avatarColor: string;
  }): Promise<User>;
  findUserByUsername(username: string): Promise<(User & { passwordHash: string }) | null>;
  findUserById(id: string): Promise<User | null>;
  updateUserProfile(
    id: string,
    patch: Partial<Pick<User, 'displayName' | 'bio' | 'avatarColor'>>,
  ): Promise<User | null>;
  /** 修改密码（仅更新哈希，用于「修改密码」能力） */
  updateUserPassword(id: string, passwordHash: string): Promise<boolean>;
  listUsers(): Promise<User[]>;

  // ---- 说说 ----
  createPost(input: CreatePostInput): Promise<Post>;
  updatePost(id: string, patch: UpdatePostInput): Promise<Post | null>;
  deletePost(id: string): Promise<boolean>;
  findPostById(id: string, viewerId?: string): Promise<Post | null>;
  listPosts(query: PostQuery): Promise<Paged<Post>>;
  setArchived(id: string, archived: boolean): Promise<Post | null>;
  incrementStats(id: string, field: 'likes' | 'favorites' | 'shares', delta: number): Promise<void>;

  // ---- 点赞 / 收藏 ----
  toggleLike(postId: string, userId: string): Promise<{ liked: boolean; count: number }>;
  toggleFavorite(postId: string, userId: string): Promise<{ favorited: boolean; count: number }>;
  isLiked(postId: string, userId: string): Promise<boolean>;
  isFavorited(postId: string, userId: string): Promise<boolean>;
  listLikedBy(postId: string): Promise<User[]>;

  // ---- 分享 ----
  createShare(input: {
    postId: string;
    creatorId: string;
    token: string;
    expiresAt: string | null;
  }): Promise<ShareLink>;
  findShareByToken(token: string): Promise<ShareLink | null>;
  listSharesByPost(postId: string): Promise<ShareLink[]>;
  listSharesByCreator(creatorId: string): Promise<ShareLink[]>;
  deleteShare(id: string): Promise<boolean>;

  // ---- 视图 ----
  listViews(ownerId: string): Promise<SavedView[]>;
  createView(input: Omit<SavedView, 'id' | 'createdAt' | 'builtIn'>): Promise<SavedView>;
  updateView(id: string, patch: Partial<SavedView>): Promise<SavedView | null>;
  deleteView(id: string): Promise<boolean>;
  findViewById(id: string): Promise<SavedView | null>;

  // ---- 草稿 ----
  upsertDraft(input: {
    ownerId: string;
    key: string;
    content: string;
    tags: string[];
    attachments: Attachment[];
  }): Promise<Draft>;
  findDraft(ownerId: string, key: string): Promise<Draft | null>;
  listDrafts(ownerId: string): Promise<Draft[]>;
  deleteDraft(ownerId: string, key: string): Promise<boolean>;

  // ---- 媒体 ----
  createMedia(input: Omit<MediaAsset, 'id' | 'createdAt'>): Promise<MediaAsset>;
  findMediaById(id: string): Promise<MediaAsset | null>;
  listMediaByOwner(ownerId: string): Promise<MediaAsset[]>;
  deleteMedia(id: string): Promise<boolean>;

  // ---- 聚合统计 ----
  listTags(ownerIds?: string[]): Promise<TagInfo[]>;
  calendarBuckets(query: PostQuery & { year: number; month: number }): Promise<CalendarCell[]>;
  mapPoints(query: PostQuery): Promise<MapPoint[]>;
  dashboardStats(ownerIds: string[]): Promise<DashboardStats>;
  countByTag(ownerIds: string[], tag: string): Promise<number>;

  // ---- 标签管理 ----
  /** 重命名标签（把所有说说里的旧名换成新名） */
  renameTag(ownerIds: string[], from: string, to: string): Promise<number>;
  /** 删除标签（从所有说说中摘除，不影响说说本身） */
  removeTag(ownerIds: string[], name: string): Promise<number>;

  // ---- API 令牌 ----
  createApiToken(input: {
    ownerId: string;
    name: string;
    token: string;
    prefix: string;
    scopes: string[];
    expiresAt: string | null;
  }): Promise<ApiToken>;
  findApiTokenByHash(tokenHash: string): Promise<ApiToken | null>;
  listApiTokens(ownerId: string): Promise<ApiToken[]>;
  updateApiToken(
    id: string,
    patch: Partial<Pick<ApiToken, 'name' | 'enabled' | 'scopes' | 'expiresAt'>>,
  ): Promise<ApiToken | null>;
  deleteApiToken(id: string): Promise<boolean>;
  /** 记录 token 最近使用（用于审计） */
  touchApiToken(id: string): Promise<void>;

  // ---- 通知渠道 ----
  createNotice(input: {
    ownerId: string;
    type: NoticeType;
    token: string;
    title: string;
    enabled: boolean;
    onPostCreate: boolean;
  }): Promise<NoticeConfig>;
  listNotices(ownerId: string): Promise<NoticeConfig[]>;
  updateNotice(
    id: string,
    patch: Partial<Pick<NoticeConfig, 'type' | 'token' | 'title' | 'enabled' | 'onPostCreate'>>,
  ): Promise<NoticeConfig | null>;
  deleteNotice(id: string): Promise<boolean>;
  /** 记录推送时间 */
  touchNotice(id: string): Promise<void>;
  /** 取出「说说创建时需推送」的渠道 */
  listActiveNotices(ownerId: string): Promise<NoticeConfig[]>;
}
