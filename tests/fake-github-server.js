/* Run a fake GitHub API for end-to-end testing:  node tests/fake-github-server.js 4010  then set GITHUB_API_URL=http://127.0.0.1:4010 */
import http from 'node:http';
import { createFakeGitHub } from './fake-github.js';

const port = Number(process.argv[2] || 4010);
const gh = createFakeGitHub({ token: process.env.FAKE_TOKEN || 'test-token' });
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  if (req.url === '/__state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ files: gh.headFiles(), commits: Object.values(gh.state.commits).map(c => c.message), blobs: gh.state.blobs })); return; }
  const r = await gh.fetch('http://fake' + req.url, { method: req.method, headers: { Authorization: req.headers['authorization'] }, body: chunks.length ? Buffer.concat(chunks).toString() : undefined });
  res.statusCode = r.status; res.setHeader('content-type', 'application/json'); res.end(await r.text());
}).listen(port, '127.0.0.1', () => console.log('fake GitHub on', port));
