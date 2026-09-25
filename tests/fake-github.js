/* A small in-memory imitation of the GitHub REST endpoints the store uses. Used by unit tests and the end-to-end server. */
import { createHash } from 'node:crypto';

const sha1 = s => createHash('sha1').update(s).digest('hex');
const blobSha = text => { const b = Buffer.from(text, 'utf8'); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };

export function createFakeGitHub({ owner = 'me', repo = 'logbook-data', branch = 'main', token = 'test-token' } = {}) {
  const st = { refs: {}, commits: {}, trees: {}, blobs: {}, calls: [], races: 0, empty: true };
  const base = `/repos/${owner}/${repo}`;
  const reply = (status, data) => new Response(data == null ? '' : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const putTree = files => { const sha = sha1(JSON.stringify(Object.entries(files).sort())); st.trees[sha] = files; return sha; };
  const commit = (tree, parents, message) => { const sha = sha1(tree + parents.join() + message + Math.random()); st.commits[sha] = { tree, parents, message }; return sha; };
  const addBlob = text => { const sha = blobSha(text); st.blobs[sha] = text; return sha; };
  const head = () => st.refs[branch] ? st.trees[st.commits[st.refs[branch]].tree] : {};
  // Test helper: another writer commits directly, moving the branch.
  function externalWrite(path, text) {
    const files = Object.assign({}, head()); files[path] = addBlob(text);
    st.refs[branch] = commit(putTree(files), st.refs[branch] ? [st.refs[branch]] : [], 'external');
  }
  async function handle(method, url, body) {
    const u = new URL(url, 'http://x'); const p = decodeURIComponent(u.pathname);
    st.calls.push(method + ' ' + p);
    if (p === base && method === 'GET') return reply(200, { size: st.empty ? 0 : 1 });
    if (p.startsWith(base + '/git/ref/heads/') && method === 'GET') {
      if (st.empty) return reply(409, { message: 'Git Repository is empty.' });
      const b = p.slice((base + '/git/ref/heads/').length); return st.refs[b] ? reply(200, { object: { sha: st.refs[b] } }) : reply(404, { message: 'Not Found' });
    }
    if (p.startsWith(base + '/contents/') && method === 'PUT') {
      const path = p.slice((base + '/contents/').length);
      const files = Object.assign({}, head()); files[path] = addBlob(Buffer.from(body.content, 'base64').toString('utf8'));
      st.refs[body.branch || branch] = commit(putTree(files), st.refs[branch] ? [st.refs[branch]] : [], body.message); st.empty = false;
      return reply(201, { content: { sha: files[path] } });
    }
    if (p.startsWith(base + '/contents/') && method === 'GET') {
      const dir = p.slice((base + '/contents/').length), ref = u.searchParams.get('ref');
      const c = st.commits[ref]; if (!c) return reply(404, { message: 'No commit found for the ref' });
      const files = st.trees[c.tree];
      const list = Object.keys(files).filter(f => f.startsWith(dir + '/') && !f.slice(dir.length + 1).includes('/')).map(f => ({ name: f.split('/').pop(), path: f, sha: files[f], type: 'file' }));
      return list.length ? reply(200, list) : reply(404, { message: 'Not Found' });
    }
    if (p.startsWith(base + '/git/commits/') && method === 'GET') { const c = st.commits[p.split('/').pop()]; return c ? reply(200, { tree: { sha: c.tree } }) : reply(404, { message: 'Not Found' }); }
    if (p.startsWith(base + '/git/blobs/') && method === 'GET') { const t = st.blobs[p.split('/').pop()]; return t != null ? reply(200, { content: Buffer.from(t).toString('base64'), encoding: 'base64' }) : reply(404, { message: 'Not Found' }); }
    if (p === base + '/git/trees' && method === 'POST') {
      const files = Object.assign({}, st.trees[body.base_tree] || {});
      for (const e of body.tree) { if (e.sha === null) { if (!(e.path in files)) return reply(422, { message: 'path not in tree' }); delete files[e.path]; } else files[e.path] = addBlob(e.content); }
      return reply(201, { sha: putTree(files) });
    }
    if (p === base + '/git/commits' && method === 'POST') return reply(201, { sha: commit(body.tree, body.parents, body.message) });
    if (p.startsWith(base + '/git/refs/heads/') && method === 'PATCH') {
      if (st.races > 0) { st.races--; externalWrite('other/file.txt', 'moved ' + Math.random()); }
      const b = p.slice((base + '/git/refs/heads/').length), c = st.commits[body.sha];
      if (!c || (!body.force && c.parents[0] !== st.refs[b])) return reply(422, { message: 'Update is not a fast forward' });
      st.refs[b] = body.sha; return reply(200, { object: { sha: body.sha } });
    }
    return reply(404, { message: 'Not Found: ' + method + ' ' + p });
  }
  const fetchImpl = async (url, init = {}) => {
    const auth = (init.headers || {})['Authorization'];
    if (auth !== 'Bearer ' + token) return reply(401, { message: 'Bad credentials' });
    return handle(init.method || 'GET', url, init.body ? JSON.parse(init.body) : null);
  };
  return { state: st, fetch: fetchImpl, handle, externalWrite, headFiles: head, blobSha };
}
