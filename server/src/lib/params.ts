import type { Request } from 'express';

/**
 * Express 5 中 req.params 的值类型为 string | string[]，
 * 这里统一取字符串，避免在每个路由里重复断言。
 */
export function param(req: Request, name: string): string {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}
