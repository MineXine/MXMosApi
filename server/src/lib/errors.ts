/** 统一业务异常 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = '未登录或登录已失效') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = '没有操作权限') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = '资源不存在') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
