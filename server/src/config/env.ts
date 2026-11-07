/** 环境配置：全部通过 env 读取，带默认值便于本地启动。 */
function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: num(process.env.PORT, 4000),
  host: process.env.HOST ?? '0.0.0.0',

  /** 数据库驱动：mongo（生产） | memory（本地零依赖 / CI） */
  dbDriver: (process.env.DB_DRIVER ?? 'memory') as 'mongo' | 'memory',
  mongoUri: process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/shuoshuo',

  jwtSecret: process.env.JWT_SECRET ?? 'shuoshuo-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',

  /** 上传目录 */
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  /** 上传体积上限（字节） */
  uploadMaxBytes: num(process.env.UPLOAD_MAX_BYTES, 20 * 1024 * 1024),
  /** 公开访问前缀 */
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? '',

  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  logRequests: bool(process.env.LOG_REQUESTS, true),
} as const;

export type Env = typeof env;
