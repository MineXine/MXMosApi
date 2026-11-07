import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { repo } from './filters.js';
import { requireAuth } from '../middleware/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { env } from '../config/env.js';
import { param } from '../lib/params.js';

export const mediaRouter = Router();

const uploadRoot = path.resolve(process.cwd(), env.uploadDir);

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await fs.mkdir(uploadRoot, { recursive: true });
      cb(null, uploadRoot);
    } catch (err) {
      cb(err as Error, uploadRoot);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.uploadMaxBytes },
  fileFilter: (_req, file, cb) => {
    const ok =
      /^image\//.test(file.mimetype) ||
      /^video\//.test(file.mimetype) ||
      /^audio\//.test(file.mimetype) ||
      file.mimetype === 'application/pdf';
    if (!ok) {
      cb(new Error('仅支持图片、视频、音频与 PDF 文件'));
      return;
    }
    cb(null, true);
  },
});

function kindOf(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** 上传媒体 */
mediaRouter.post('/', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest('未接收到文件');

  const media = await repo().createMedia({
    ownerId: req.user!.sub,
    url: `/uploads/${file.filename}`,
    filename: file.originalname,
    mime: file.mimetype,
    size: file.size,
    kind: kindOf(file.mimetype),
  });

  res.status(201).json({ ok: true, data: { media } });
});

/** 媒体列表 */
mediaRouter.get('/', requireAuth, async (req, res) => {
  const medias = await repo().listMediaByOwner(req.user!.sub);
  res.json({ ok: true, data: { medias } });
});

/** 删除媒体 */
mediaRouter.delete('/:id', requireAuth, async (req, res) => {
  const r = repo();
  const media = await r.findMediaById(param(req, 'id'));
  if (!media) throw notFound('媒体不存在');
  if (media.ownerId !== req.user!.sub) throw badRequest('只能删除自己的媒体');
  await r.deleteMedia(media.id);
  try {
    const abs = path.join(uploadRoot, path.basename(media.url));
    await fs.unlink(abs);
  } catch {
    /* 文件可能已被清理，忽略 */
  }
  res.json({ ok: true, data: { deleted: true } });
});
