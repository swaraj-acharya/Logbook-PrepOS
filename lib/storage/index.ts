import path from 'node:path';
import { FsStore } from './fs';
import { GitHubStore } from './github';
import { StoreError, type DocStore } from './types';

let store: DocStore | null = null;

/** GitHub when GITHUB_TOKEN and GITHUB_REPO are set; a local folder (.data) only outside production or when STORAGE=fs. */
export function getStore(): DocStore {
  if (store) return store;
  const kind = (process.env.STORAGE || '').toLowerCase();
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPO;
  if (kind !== 'fs' && token && repo) {
    store = new GitHubStore({ token, repo, branch: process.env.GITHUB_BRANCH || 'main', dataDir: process.env.GITHUB_DATA_DIR ?? 'data', apiUrl: process.env.GITHUB_API_URL });
  } else if (kind === 'fs' || process.env.NODE_ENV !== 'production') {
    store = new FsStore(path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.DATA_DIR || '.data'));
  } else {
    throw new StoreError('Storage is not configured. Set GITHUB_TOKEN and GITHUB_REPO (see README).', 500);
  }
  return store;
}
export function storageLabel(): string { try { return getStore().label; } catch { return 'not configured'; } }
