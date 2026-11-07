import { Router } from 'express';
import type { Repository } from '../repositories/repository.js';

let repoRef: Repository | null = null;

export function setRepository(repo: Repository): void {
  repoRef = repo;
}

export function repo(): Repository {
  if (!repoRef) throw new Error('repository not initialized');
  return repoRef;
}
