import { Router } from 'express';
import { repo } from './filters.js';
import { requireAuth } from '../middleware/auth.js';
import { parseDevice } from '../lib/device.js';

export const statsRouter = Router();

/** 仪表盘统计 */
statsRouter.get('/', requireAuth, async (req, res) => {
  const stats = await repo().dashboardStats([req.user!.sub]);
  res.json({ ok: true, data: { stats } });
});

/** 当前请求的设备信息（浏览器版本等） */
statsRouter.get('/device', requireAuth, (req, res) => {
  res.json({ ok: true, data: { device: parseDevice(req.headers['user-agent']) } });
});
