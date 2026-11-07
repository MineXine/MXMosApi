import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getRepository } from '../repositories/index.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { validateBody } from '../middleware/error.js';

const registerSchema = z.object({
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_.-]+$/, '只能包含字母数字与 _ . -'),
  password: z.string().min(6).max(72),
  displayName: z.string().min(1).max(24).optional(),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];

export const authRouter = Router();

/** 注册 */
authRouter.post('/register', validateBody(registerSchema), async (req, res) => {
  const { username, password, displayName } = req.body as z.infer<typeof registerSchema>;
  const repo = getRepository();

  const exists = await repo.findUserByUsername(username);
  if (exists) throw conflict('该用户名已被占用');

  const passwordHash = await bcrypt.hash(password, 10);
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const user = await repo.createUser({
    username,
    passwordHash,
    displayName: displayName || username,
    avatarColor: color,
  });

  const token = signToken({ sub: user.id, username: user.username });
  res.status(201).json({ ok: true, data: { token, user } });
});

/** 登录 */
authRouter.post('/login', validateBody(loginSchema), async (req, res) => {
  const { username, password } = req.body as z.infer<typeof loginSchema>;
  const repo = getRepository();

  const user = await repo.findUserByUsername(username);
  if (!user) throw unauthorized('用户名或密码错误');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw unauthorized('用户名或密码错误');

  const { passwordHash: _ph, ...safe } = user;
  const token = signToken({ sub: user.id, username: user.username });
  res.json({ ok: true, data: { token, user: safe } });
});

/** 当前用户 */
authRouter.get('/me', requireAuth, async (req, res) => {
  const repo = getRepository();
  const user = await repo.findUserById(req.user!.sub);
  if (!user) throw notFound('用户不存在');
  res.json({ ok: true, data: { user } });
});

/** 更新资料 */
const profileSchema = z.object({
  displayName: z.string().min(1).max(24).optional(),
  bio: z.string().max(200).optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

authRouter.patch('/me', requireAuth, validateBody(profileSchema), async (req, res) => {
  const repo = getRepository();
  const user = await repo.updateUserProfile(req.user!.sub, req.body);
  if (!user) throw notFound('用户不存在');
  res.json({ ok: true, data: { user } });
});

/** 用户列表（用于切换体验账号） */
authRouter.get('/users', async (_req, res) => {
  const repo = getRepository();
  const users = await repo.listUsers();
  res.json({ ok: true, data: { users } });
});
