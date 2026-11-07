import { Router } from 'express';
import type { Repository } from './repository.js';
import { MongoRepository } from './mongo/index.js';
import { MemoryRepository } from './memory/index.js';
import { env } from '../config/env.js';

let instance: Repository | null = null;

export async function initRepository(): Promise<Repository> {
  if (instance) return instance;

  if (env.dbDriver === 'mongo') {
    const mongo = new MongoRepository();
    await mongo.connect();
    instance = mongo;
    console.log('[db] 使用 MongoDB 驱动');
  } else {
    const memory = new MemoryRepository();
    await memory.connect();
    instance = memory;
    console.log('[db] 使用内存驱动（数据不持久化，仅用于开发/CI）');
  }
  return instance;
}

export function getRepository(): Repository {
  if (!instance) throw new Error('repository 尚未初始化');
  return instance;
}

export async function closeRepository(): Promise<void> {
  if (instance) {
    await instance.disconnect?.();
    instance = null;
  }
}
