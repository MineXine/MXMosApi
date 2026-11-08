import mongoose, { Schema } from 'mongoose';

/** 用户 */
const UserSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, index: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true },
    avatarColor: { type: String, default: '#6366f1' },
    bio: { type: String, default: '' },
  },
  { timestamps: true, collection: 'users' },
);

/** 说说 */
const PostSchema = new Schema(
  {
    authorId: { type: String, required: true, index: true },
    content: { type: String, required: true },
    plainText: { type: String, default: '' },
    mdcOptions: {
      type: [
        new Schema(
          {
            name: { type: String, required: true },
            props: { type: Schema.Types.Mixed, default: {} },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    tags: { type: [String], default: [], index: true },
    visibility: { type: String, enum: ['public', 'private'], default: 'public', index: true },
    status: {
      type: String,
      enum: ['published', 'archived', 'hidden'],
      default: 'published',
      index: true,
    },
    archivedAt: { type: String, default: null },
    location: {
      type: new Schema(
        {
          lat: { type: Number, required: true },
          lng: { type: Number, required: true },
          label: { type: String, default: '' },
          address: { type: String, default: '' },
        },
        { _id: false },
      ),
      default: null,
    },
    attachments: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            url: { type: String, required: true },
            filename: { type: String, default: '' },
            mime: { type: String, default: '' },
            size: { type: Number, default: 0 },
            width: { type: Number },
            height: { type: Number },
            kind: { type: String, default: 'image' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    device: {
      type: new Schema(
        {
          browser: { type: String, default: '' },
          browserVersion: { type: String, default: '' },
          os: { type: String, default: '' },
          osVersion: { type: String, default: '' },
          deviceType: { type: String, default: '' },
          deviceVendor: { type: String, default: '' },
          ua: { type: String, default: '' },
        },
        { _id: false },
      ),
      default: null,
    },
    stats: {
      type: new Schema(
        {
          likes: { type: Number, default: 0 },
          favorites: { type: Number, default: 0 },
          shares: { type: Number, default: 0 },
          comments: { type: Number, default: 0 },
        },
        { _id: false },
      ),
      default: () => ({ likes: 0, favorites: 0, shares: 0, comments: 0 }),
    },
    likedBy: { type: [String], default: [], select: false },
    favoritedBy: { type: [String], default: [], select: false },
    searchTokens: { type: [String], default: [], index: true },
  },
  { timestamps: true, collection: 'posts' },
);

// 复合索引：时间线 + 可见性 + 状态
PostSchema.index({ authorId: 1, status: 1, createdAt: -1 });
PostSchema.index({ visibility: 1, status: 1, createdAt: -1 });
PostSchema.index({ tags: 1, createdAt: -1 });

/** 点赞 / 收藏 独立集合，避免大数组 */
const ReactionSchema = new Schema(
  {
    postId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    kind: { type: String, enum: ['like', 'favorite'], required: true },
  },
  { timestamps: true, collection: 'reactions' },
);
ReactionSchema.index({ postId: 1, userId: 1, kind: 1 }, { unique: true });

/** 分享链接 */
const ShareSchema = new Schema(
  {
    postId: { type: String, required: true, index: true },
    creatorId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: String, default: null },
  },
  { timestamps: true, collection: 'shares' },
);

/** 视图 */
const ViewSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    icon: { type: String, default: 'inbox' },
    description: { type: String, default: '' },
    filters: { type: Schema.Types.Mixed, default: {} },
    builtIn: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'views' },
);

/** 草稿 */
const DraftSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    content: { type: String, default: '' },
    tags: { type: [String], default: [] },
    attachments: { type: Schema.Types.Mixed, default: [] },
  },
  { timestamps: true, collection: 'drafts' },
);
DraftSchema.index({ ownerId: 1, key: 1 }, { unique: true });

/** 媒体 */
const MediaSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    url: { type: String, required: true },
    filename: { type: String, default: '' },
    mime: { type: String, default: '' },
    size: { type: Number, default: 0 },
    width: { type: Number },
    height: { type: Number },
    kind: { type: String, default: 'image' },
  },
  { timestamps: true, collection: 'medias' },
);

/**
 * API 访问令牌。
 * `token` 存哈希（明文仅创建时返回一次），`prefix` 存明文前缀用于列表识别。
 */
const ApiTokenSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    token: { type: String, required: true, index: true },
    prefix: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    scopes: { type: [String], default: [] },
    lastUsedAt: { type: String, default: null },
    expiresAt: { type: String, default: null },
  },
  { timestamps: true, collection: 'apiTokens' },
);

/** 第三方推送通知渠道 */
const NoticeSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        'telegram',
        'wecom',
        'dingtalk',
        'bark',
        'pushplus',
        'pushdeer',
        'serverchan',
        'igot',
        'qmsg',
        'gocqhttp',
        'webhook',
      ],
      required: true,
    },
    token: { type: String, required: true },
    title: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    onPostCreate: { type: Boolean, default: true },
    lastSentAt: { type: String, default: null },
  },
  { timestamps: true, collection: 'notices' },
);

export const UserModel = mongoose.model('User', UserSchema);
export const PostModel = mongoose.model('Post', PostSchema);
export const ReactionModel = mongoose.model('Reaction', ReactionSchema);
export const ShareModel = mongoose.model('Share', ShareSchema);
export const ViewModel = mongoose.model('View', ViewSchema);
export const DraftModel = mongoose.model('Draft', DraftSchema);
export const MediaModel = mongoose.model('Media', MediaSchema);
export const ApiTokenModel = mongoose.model('ApiToken', ApiTokenSchema);
export const NoticeModel = mongoose.model('Notice', NoticeSchema);
