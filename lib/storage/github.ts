import { gitBlobSha, serialize } from './serialize';
import { DOC_ID, UID, StoreError, type ApplyResult, type Change, type DocBody, type DocMap, type DocStore } from './types';

/*
 * Stores each data file as JSON in a GitHub repository.
 *
 * Layout:  <dataDir>/users/<uid>/<docId>.json   on one branch.
 * Reads:   ref -> commit -> directory listing -> blobs (blobs are cached by sha; a sha never changes).
 * Writes:  every sync is ONE commit built with the Git Data API (tree with inline contents, commit,
 *          fast-forward ref update). If another write moved the branch in between, the ref update is
 *          rejected and the whole sync is rebuilt on the new head.
 * Safety:  each change carries the blob sha the browser last saw. If the file changed since then, the
 *          change is not written; the current copy is returned as a conflict for the browser to merge.
 */

type Opts = { token: string; repo: string; branch: string; dataDir: string; apiUrl?: string; fetchImpl?: typeof fetch };
type GhEntry = { name: string; path: string; sha: string; type: string };

class LRU<V> {
  private m = new Map<string, V>(); private bytes = 0;
  constructor(private maxBytes: number, private size: (v: V) => number) { }
  get(k: string) { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v); } return v; }
  set(k: string, v: V) {
    if (this.m.has(k)) return; this.m.set(k, v); this.bytes += this.size(v);
    while (this.bytes > this.maxBytes && this.m.size) { const [ok, ov] = this.m.entries().next().value as [string, V]; this.m.delete(ok); this.bytes -= this.size(ov); }
  }
}
const blobCache = new LRU<string>(40 * 1024 * 1024, s => s.length);
const listCache = new LRU<Record<string, string>>(4 * 1024 * 1024, o => 64 * Object.keys(o).length + 64);
const treeOfCommit = new Map<string, string>();

export class GitHubStore implements DocStore {
  readonly label: string;
  private api: string; private f: typeof fetch;
  constructor(private o: Opts) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo)) throw new StoreError('GITHUB_REPO must look like owner/name', 500);
    this.api = (o.apiUrl || 'https://api.github.com').replace(/\/$/, '');
    this.f = o.fetchImpl || fetch;
    this.label = 'GitHub (' + o.repo + ')';
  }

  private async gh<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await this.f(this.api + path, {
          method, cache: 'no-store',
          headers: { Authorization: 'Bearer ' + this.o.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'logbook-study-app', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (e) { lastErr = e; await sleep(400 * (attempt + 1)); continue; }
      if (res.status >= 500 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') || res.status === 429) {
        const wait = Math.min(8000, Number(res.headers.get('retry-after') || 0) * 1000 || 600 * (attempt + 1));
        lastErr = new StoreError('GitHub is busy (' + res.status + ')', 503); await sleep(wait); continue;
      }
      const text = await res.text();
      let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { status: res.status, data };
    }
    throw lastErr instanceof StoreError ? lastErr : new StoreError('Could not reach GitHub', 503);
  }
  private fail(what: string, r: { status: number; data: any }): never {
    const msg = (r.data && r.data.message) || 'HTTP ' + r.status;
    if (r.status === 401) throw new StoreError('GitHub rejected the token (' + msg + '). Check GITHUB_TOKEN.', 500);
    if (r.status === 403 || r.status === 404) throw new StoreError(what + ': ' + msg + '. Check GITHUB_REPO, GITHUB_BRANCH and that the token has Contents read and write access to the repository.', 500);
    throw new StoreError(what + ': ' + msg, 502);
  }
  private repoPath(p: string) { return '/repos/' + this.o.repo + p; }
  private userDir(uid: string) {
    if (!UID.test(uid)) throw new StoreError('Bad user id', 400);
    return (this.o.dataDir ? this.o.dataDir.replace(/^\/|\/$/g, '') + '/' : '') + 'users/' + uid;
  }

  /** Current head commit and its tree; initialises an empty repository on first use. */
  private async head(): Promise<{ commit: string; tree: string }> {
    let r = await this.gh('GET', this.repoPath('/git/ref/heads/' + encodeURIComponent(this.o.branch)));
    if (r.status === 409 || (r.status === 404 && (await this.isEmptyRepo()))) {
      await this.initRepo();
      r = await this.gh('GET', this.repoPath('/git/ref/heads/' + encodeURIComponent(this.o.branch)));
    }
    if (r.status !== 200) this.fail('Reading branch ' + this.o.branch, r);
    const commit: string = r.data.object.sha;
    let tree = treeOfCommit.get(commit);
    if (!tree) {
      const c = await this.gh('GET', this.repoPath('/git/commits/' + commit));
      if (c.status !== 200) this.fail('Reading commit', c);
      tree = c.data.tree.sha as string; treeOfCommit.set(commit, tree);
    }
    return { commit, tree };
  }
  private async isEmptyRepo() {
    const r = await this.gh('GET', this.repoPath(''));
    if (r.status !== 200) this.fail('Opening repository', r);
    return r.data.size === 0;
  }
  private async initRepo() {
    const path = (this.o.dataDir ? this.o.dataDir.replace(/^\/|\/$/g, '') + '/' : '') + 'README.md';
    const content = Buffer.from('# Logbook data\n\nStudy data written by the Logbook app. Each user has a folder under users/.\n').toString('base64');
    const r = await this.gh('PUT', this.repoPath('/contents/' + path), { message: 'Initialise Logbook data', content, branch: this.o.branch });
    if (r.status !== 201 && r.status !== 200) {
      const r2 = await this.gh('PUT', this.repoPath('/contents/' + path), { message: 'Initialise Logbook data', content });
      if (r2.status !== 201 && r2.status !== 200) this.fail('Initialising the repository', r2);
    }
  }
  /** path -> blob sha for this user's folder at a given commit (cached; commits are immutable). */
  private async listing(uid: string, commit: string): Promise<Record<string, string>> {
    const key = commit + ':' + uid; const hit = listCache.get(key); if (hit) return hit;
    const dir = this.userDir(uid);
    const r = await this.gh<GhEntry[]>('GET', this.repoPath('/contents/' + dir.split('/').map(encodeURIComponent).join('/') + '?ref=' + commit));
    const out: Record<string, string> = {};
    if (r.status === 404) { listCache.set(key, out); return out; }
    if (r.status !== 200) this.fail('Listing your data folder', r);
    if (Array.isArray(r.data)) for (const e of r.data) if (e.type === 'file' && e.name.endsWith('.json')) out[e.path] = e.sha;
    listCache.set(key, out);
    return out;
  }
  private async blob(sha: string): Promise<string> {
    const hit = blobCache.get(sha); if (hit !== undefined) return hit;
    const r = await this.gh('GET', this.repoPath('/git/blobs/' + sha));
    if (r.status !== 200) this.fail('Reading a data file', r);
    const text = r.data.encoding === 'base64' ? Buffer.from(r.data.content, 'base64').toString('utf8') : String(r.data.content);
    blobCache.set(sha, text);
    return text;
  }

  async loadAll(uid: string): Promise<DocMap> {
    const { commit } = await this.head();
    const list = await this.listing(uid, commit);
    const out: DocMap = {};
    const entries = Object.entries(list);
    await pool(entries, 6, async ([path, sha]) => {
      const id = path.split('/').pop()!.slice(0, -5);
      if (!DOC_ID.test(id)) return;
      try { out[id] = { body: JSON.parse(await this.blob(sha)), sha }; } catch { /* ignore a hand-edited file that is not valid JSON */ }
    });
    return out;
  }

  async apply(uid: string, changes: Record<string, Change>): Promise<ApplyResult> {
    const dir = this.userDir(uid);
    for (let attempt = 0; attempt < 5; attempt++) {
      const { commit, tree } = await this.head();
      const list = await this.listing(uid, commit);
      const res: ApplyResult = { saved: {}, conflicts: {} };
      const entries: Array<{ path: string; mode: '100644'; type: 'blob'; content?: string; sha?: null }> = [];
      const written: Array<[string, string]> = [];
      for (const [id, ch] of Object.entries(changes)) {
        const path = dir + '/' + id + '.json', cur = list[path] || null;
        if ((ch.baseSha || null) !== cur) {
          res.conflicts[id] = { body: cur ? (JSON.parse(await this.blob(cur)) as DocBody) : null, sha: cur };
          continue;
        }
        if (ch.body === null) { if (cur) entries.push({ path, mode: '100644', type: 'blob', sha: null }); res.saved[id] = null; continue; }
        const text = serialize(ch.body), sha = gitBlobSha(text);
        res.saved[id] = sha;
        if (sha === cur) continue;
        entries.push({ path, mode: '100644', type: 'blob', content: text });
        written.push([sha, text]);
      }
      if (!entries.length) return res;
      const t = await this.gh('POST', this.repoPath('/git/trees'), { base_tree: tree, tree: entries });
      if (t.status !== 201) this.fail('Writing files', t);
      const ids = Object.keys(res.saved);
      const message = 'Logbook sync: ' + (ids.length > 4 ? ids.slice(0, 4).join(', ') + ' and ' + (ids.length - 4) + ' more' : ids.join(', '));
      const c = await this.gh('POST', this.repoPath('/git/commits'), { message, tree: t.data.sha, parents: [commit] });
      if (c.status !== 201) this.fail('Creating commit', c);
      const u = await this.gh('PATCH', this.repoPath('/git/refs/heads/' + encodeURIComponent(this.o.branch)), { sha: c.data.sha, force: false });
      if (u.status === 200) {
        treeOfCommit.set(c.data.sha, t.data.sha);
        written.forEach(([sha, text]) => blobCache.set(sha, text));
        return res;
      }
      if (u.status !== 422 && u.status !== 409) this.fail('Updating branch', u);
      await sleep(150 + Math.random() * 350); // someone else committed first: rebuild on the new head
    }
    throw new StoreError('The data branch kept changing while saving. Try again.', 503);
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0; const workers = Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); });
  await Promise.all(workers);
}
