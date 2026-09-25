// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { GitHubStore } from '../lib/storage/github';
import { gitBlobSha, serialize } from '../lib/storage/serialize';
import { createFakeGitHub } from './fake-github.js';

const mk = (gh, extra = {}) => new GitHubStore({ token: 'test-token', repo: 'me/logbook-data', branch: 'main', dataDir: 'data', apiUrl: 'https://api.test', fetchImpl: gh.fetch, ...extra });

describe('GitHub store', () => {
  it('initialises an empty repository and loads nothing', async () => {
    const gh = createFakeGitHub(); const s = mk(gh);
    expect(await s.loadAll('me')).toEqual({});
    expect(Object.keys(gh.headFiles())).toContain('data/README.md');
  });

  it('writes several files in one commit and reads them back with their versions', async () => {
    const gh = createFakeGitHub(); const s = mk(gh); await s.loadAll('me');
    const before = Object.keys(gh.state.commits).length;
    const core = { v: 1, nodes: [{ id: 'c1', name: 'Phasors' }], updatedAt: 5 }, ses = { sessions: [{ id: 's1', focusSec: 1800 }], updatedAt: 6 };
    const r = await s.apply('me', { core: { body: core, baseSha: null }, 'ses-2026-09': { body: ses, baseSha: null } });
    expect(Object.keys(gh.state.commits).length - before).toBe(1);
    expect(r.conflicts).toEqual({});
    expect(r.saved.core).toBe(gitBlobSha(serialize(core)));
    const all = await s.loadAll('me');
    expect(all.core.body).toEqual(core); expect(all.core.sha).toBe(r.saved.core);
    expect(gh.headFiles()['data/users/me/ses-2026-09.json']).toBe(r.saved['ses-2026-09']);
  });

  it('refuses to overwrite a file that changed since the browser last saw it', async () => {
    const gh = createFakeGitHub(); const s = mk(gh);
    const r1 = await s.apply('me', { core: { body: { a: 1, updatedAt: 1 }, baseSha: null } });
    await s.apply('me', { core: { body: { a: 2, updatedAt: 2 }, baseSha: r1.saved.core } });   // another device
    const r3 = await s.apply('me', { core: { body: { a: 3, updatedAt: 3 }, baseSha: r1.saved.core } });   // stale
    expect(r3.saved.core).toBeUndefined();
    expect(r3.conflicts.core.body).toEqual({ a: 2, updatedAt: 2 });
    const r4 = await s.apply('me', { core: { body: { a: 3, updatedAt: 3 }, baseSha: r3.conflicts.core.sha } });
    expect(r4.saved.core).toBeTruthy();
  });

  it('deletes files and keeps users apart', async () => {
    const gh = createFakeGitHub(); const s = mk(gh);
    const r = await s.apply('alice', { 'tb-2026-09': { body: { items: [] }, baseSha: null } });
    await s.apply('bob', { core: { body: { who: 'bob' }, baseSha: null } });
    expect(Object.keys(await s.loadAll('alice'))).toEqual(['tb-2026-09']);
    await s.apply('alice', { 'tb-2026-09': { body: null, baseSha: r.saved['tb-2026-09'] } });
    expect(await s.loadAll('alice')).toEqual({});
    expect((await s.loadAll('bob')).core.body).toEqual({ who: 'bob' });
  });

  it('rebuilds the commit when the branch moves during a save', async () => {
    const gh = createFakeGitHub(); const s = mk(gh);
    await s.apply('me', { core: { body: { a: 1 }, baseSha: null } });
    gh.state.races = 2;
    const r = await s.apply('me', { 'mis-2026-09': { body: { items: [{ id: 'm1' }] }, baseSha: null } });
    expect(r.saved['mis-2026-09']).toBeTruthy();
    expect(gh.headFiles()['data/users/me/mis-2026-09.json']).toBe(r.saved['mis-2026-09']);
    expect(gh.headFiles()['other/file.txt']).toBeTruthy();
  });

  it('skips the commit when nothing changed', async () => {
    const gh = createFakeGitHub(); const s = mk(gh);
    const r = await s.apply('me', { core: { body: { a: 1 }, baseSha: null } });
    const n = Object.keys(gh.state.commits).length;
    await s.apply('me', { core: { body: { a: 1 }, baseSha: r.saved.core } });
    expect(Object.keys(gh.state.commits).length).toBe(n);
  });

  it('reports a bad token clearly', async () => {
    const gh = createFakeGitHub(); const s = mk(gh, { token: 'wrong' });
    await expect(s.loadAll('me')).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it('computes the same blob id as git', () => {
    const text = serialize({ name: 'Φm and ₹', n: [1, 2] });
    let git = null;
    try { git = execFileSync('git', ['hash-object', '--stdin'], { input: text }).toString().trim(); } catch { }
    if (git) expect(gitBlobSha(text)).toBe(git);
  });
});
