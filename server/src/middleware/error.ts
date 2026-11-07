import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { AppError } from '../lib/errors.js';
import { env } from '../config/env.js';

/** Express 5 中 req.query 是只读 getter，统一挂载到 req.validatedQuery */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validatedQuery?: unknown;
    }
  }
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new AppError(422, 'VALIDATION_ERROR', '请求参数校验失败', formatZod(result.error)),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(
        new AppError(422, 'VALIDATION_ERROR', '查询参数校验失败', formatZod(result.error)),
      );
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}

export function getValidatedQuery<T>(req: Request): T {
  return req.validatedQuery as T;
}

function formatZod(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
}

/** 全局错误处理 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: formatZod(err) },
    });
    return;
  }

  const e = err as { status?: number; statusCode?: number; message?: string; code?: string };
  const status = e?.status ?? e?.statusCode ?? 500;
  if (status >= 500 && env.nodeEnv !== 'test') {
    console.error('[unhandled]', err);
  }
  res.status(status).json({
    ok: false,
    error: {
      code: e?.code ?? 'INTERNAL_ERROR',
      message: status >= 500 ? '服务器内部错误' : (e?.message ?? '请求失败'),
    },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: `接口不存在: ${req.method} ${req.path}` },
  });
}
