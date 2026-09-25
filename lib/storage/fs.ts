import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gitBlobSha, serialize } from './serialize';
import { DOC_ID, UID, StoreError, type ApplyResult, type Change, type DocMap, type DocStore } from './types';

/** Local folder store for development and self-hosting on a single machine. */
export class FsStore implements DocStore {
  readonly label: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root: string) { this.label = 'this server (' + root + ')'; }
  private dir(uid: string) { if (!UID.test(uid)) throw new StoreError('Bad user id', 400); return path.join(this.root, 'users', uid); }

  async loadAll(uid: string): Promise<DocMap> {
    const dir = this.dir(uid), out: DocMap = {};
    let names: string[] = [];
    try { names = await fs.readdir(dir); } catch { return out; }
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const id = n.slice(0, -5); if (!DOC_ID.test(id)) continue;
      const text = await fs.readFile(path.join(dir, n), 'utf8');
      try { out[id] = { body: JSON.parse(text), sha: gitBlobSha(text) }; } catch { /* skip unreadable file */ }
    }
    return out;
  }

  apply(uid: string, changes: Record<string, Change>): Promise<ApplyResult> {
    // Serialise writes so two requests cannot interleave.
    const run = this.queue.then(() => this.applyNow(uid, changes));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async applyNow(uid: string, changes: Record<string, Change>): Promise<ApplyResult> {
    const dir = this.dir(uid); await fs.mkdir(dir, { recursive: true });
    const res: ApplyResult = { saved: {}, conflicts: {} };
    for (const [id, ch] of Object.entries(changes)) {
      const file = path.join(dir, id + '.json');
      let curText: string | null = null;
      try { curText = await fs.readFile(file, 'utf8'); } catch { curText = null; }
      const cur = curText == null ? null : gitBlobSha(curText);
      if ((ch.baseSha || null) !== cur) { res.conflicts[id] = { body: curText == null ? null : JSON.parse(curText), sha: cur }; continue; }
      if (ch.body === null) { if (curText != null) await fs.unlink(file); res.saved[id] = null; continue; }
      const text = serialize(ch.body);
      const tmp = file + '.' + process.pid + '.tmp';
      await fs.writeFile(tmp, text); await fs.rename(tmp, file);
      res.saved[id] = gitBlobSha(text);
    }
    return res;
  }
}
