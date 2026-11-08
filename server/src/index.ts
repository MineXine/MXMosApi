import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs/promises';
import { env } from './config/env.js';
import { attachApiToken, attachUser } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { createApiRouter, setRepository } from './routes/index.js';
import { closeRepository, getRepository, initRepository } from './repositories/index.js';

export async function createApp() {
  const repo = await initRepository();
  setRepository(repo);

  const app = express();

  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (env.logRequests) {
    app.use((req, _res, next) => {
      const start = Date.now();
      _res.on('finish', () => {
        console.log(`${req.method} ${req.originalUrl} ${_res.statusCode} ${Date.now() - start}ms`);
      });
      next();
    });
  }

  // 静态资源：上传的文件
  const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
  await fs.mkdir(uploadRoot, { recursive: true });
  app.use('/uploads', express.static(uploadRoot));

  // 解析登录态
  app.use(attachUser);
  app.use(attachApiToken);

  app.use('/api', createApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function main() {
  const app = await createApp();
  const server = app.listen(env.port, env.host, () => {
    console.log(`[server] 说说系统 API 已启动: http://localhost:${env.port}/api`);
    console.log(`[server] 数据库驱动: ${env.dbDriver}`);
  });

  const shutdown = async () => {
    console.log('\n[server] 正在关闭...');
    server.close();
    await closeRepository();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// 仅在直接运行时启动
if (process.argv[1] && process.argv[1].includes('index')) {
  main().catch((err) => {
    console.error('[server] 启动失败:', err);
    process.exit(1);
  });
}

export { getRepository };
