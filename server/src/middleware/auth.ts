import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import type { ApiToken } from '../../../shared/types.js';
import { env } from '../config/env.js';
import { unauthorized } from '../lib/errors.js';
import { getRepository } from '../repositories/index.js';

export interface AuthPayload {
  sub: string;
  username: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
      /** 通过 X-API-Token 解析出的 API 令牌身份（开放接口用） */
      apiToken?: ApiToken;
    }
  }
}

/**
 * 生成 API Token 明文。
 * 形态 `mx_<base32>`，便于识别与复制。
 */
export function generateApiToken(): string {
  return `mx_${randomBytes(24).toString('base64url')}`;
}

/** Token 落库前的哈希，避免明文入库 */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as AuthPayload;
    return typeof decoded.sub === 'string' ? decoded : null;
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const q = req.query.token;
  if (typeof q === 'string' && q) return q;
  return null;
}

/** 解析登录态（不强制） */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.user = payload;
  }
  next();
}

/** 强制登录 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  next();
}

/**
 * 解析 API Token 身份（不强制）。
 * 读取 `X-API-Token` 头（或 `Authorization: ApiToken <token>`），命中则挂到 req.apiToken。
 */
export async function attachApiToken(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const raw =
      (typeof req.headers['x-api-token'] === 'string' ? req.headers['x-api-token'] : null) ??
      extractApiTokenFromAuth(req);

    if (raw) {
      const repo = getRepository();
      const found = await repo.findApiTokenByHash(hashApiToken(raw));
      // 启用中且未过期才算有效
      if (found?.enabled) {
        const expired = found.expiresAt ? Date.parse(found.expiresAt) <= Date.now() : false;
        if (!expired) {
          req.apiToken = found;
          await repo.touchApiToken(found.id);
        }
      }
    }
  } catch {
    /* 解析失败视为未携带 token */
  }
  next();
}

function extractApiTokenFromAuth(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('ApiToken ')) return header.slice(9).trim();
  return null;
}

/** 强制要求 API Token（用于开放发布等接口） */
export function requireApiToken(req: Request, _res: Response, next: NextFunction): void {
  if (!req.apiToken) {
    next(unauthorized('missing or invalid API token'));
    return;
  }
  if (req.apiToken.expiresAt && Date.parse(req.apiToken.expiresAt) <= Date.now()) {
    next(unauthorized('API token expired'));
    return;
  }
  next();
}
