// @ts-nocheck
import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { main } from '../scripts/progress-push.mjs';
import { withDayLog } from '../lib/daylog';
import { newCore, docsToWorkspace, serializeWorkspace } from '../lib/workspace';

const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime();
let hasGit = true; try { execFileSync('git', ['--version']); } catch { hasGit = false; }
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
function progressText(now) {
  const core = newCore({ dayStartHour: 4, activeExamId: 'e' }); core.exams = [{ id: 'e', name: 'Finals', date: '2026-11-30' }];
  core.nodes = [{ id: 'S', kind: 'subject', name: 'Maths', order: 0 }];
  const s = (id, d, h, min) => ({ id, subjectId: 'S', conceptIds: [], startedAt: at(d, h), endedAt: at(d, h) + min * 60e3, focusSec: min * 60, mode: 'reading', source: 'timer', status: 'completed' });
  const sessions = [s('a', 24, 18, 60), s('b', 25, 9, 30), s('c', 25, 23, 90), s('d', 26, 8, 45)].filter(x => x.startedAt <= now);
  return serializeWorkspace(withDayLog(docsToWorkspace({ core, 'ses-2026-09': { sessions } }, { now }), now));
}
let repo;
beforeEach(() => {
  if (!hasGit) return;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prog-'));
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 't@example.com'); git(repo, 'config', 'user.name', 'Tester'); git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'init');
  fs.mkdirSync(path.join(repo, 'progress'));
});

describe.skipIf(!hasGit)('progress:push', () => {
  it('commits each study day separately, dated on that day, then the progress file', () => {
    fs.writeFileSync(path.join(repo, 'progress', 'finals-progress.json'), progressText(at(26, 12)));
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'unrelated\n'); git(repo, 'add', 'notes.txt');      // staged, not ours
    const out = []; main(['--no-push'], { cwd: repo, now: at(26, 12), log: s => out.push(s) });
    const log = git(repo, 'log', '--format=%aI|%s').trim().split('\n').reverse().slice(1);
    expect(log.map(l => l.split('|')[1])).toEqual([
      'Progress 2026-09-24 (Thursday): 1h studied', 'Progress 2026-09-25 (Friday): 2h studied', 'Progress 2026-09-26 (Saturday): 45m studied', 'Update progress data (2026-09-24 to 2026-09-26)']);
    expect(log[0].slice(0, 16)).toBe('2026-09-24T19:00');           // last activity of the 24th
    expect(log[1].slice(0, 16)).toBe('2026-09-25T23:59');           // activity ran past midnight: kept on its own date
    expect(log[2].slice(0, 16)).toBe('2026-09-26T12:00');           // today: now
    expect(fs.existsSync(path.join(repo, 'progress', 'days', '2026-09-25.json'))).toBe(true);
    const day = JSON.parse(fs.readFileSync(path.join(repo, 'progress', 'days', '2026-09-25.json'), 'utf8'));
    expect(day.time.studiedMin).toBe(120);
    expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('notes.txt');                     // left staged, not committed
    // nothing new: no commits
    main(['--no-push'], { cwd: repo, now: at(26, 12, 5), log: () => { } });
    expect(git(repo, 'rev-list', '--count', 'HEAD').trim()).toBe('5');
  });
  it('a day pushed late still gets its own date, and only changed days are committed again', () => {
    fs.writeFileSync(path.join(repo, 'progress', 'finals-progress.json'), progressText(at(25, 12)));
    main(['--no-push'], { cwd: repo, now: at(25, 12), log: () => { } });
    // forgot to push on the 25th evening and the 26th; push on the 27th
    fs.writeFileSync(path.join(repo, 'progress', 'finals-progress.json'), progressText(at(27, 10)));
    main(['--no-push'], { cwd: repo, now: at(27, 10), log: () => { } });
    const log = git(repo, 'log', '--format=%aI|%s', '-4').trim().split('\n').reverse();
    expect(log.map(l => l.split('|')[1].split(':')[0])).toEqual(['Update progress data (2026-09-24 to 2026-09-25)', 'Update progress 2026-09-25 (Friday)',
      'Progress 2026-09-26 (Saturday)', 'Update progress data (2026-09-25 to 2026-09-26)']);         // the 24th did not change, so it is not committed again
    expect(log[1].slice(0, 10)).toBe('2026-09-25'); expect(log[2].slice(0, 10)).toBe('2026-09-26'); expect(log[3].slice(0, 10)).toBe('2026-09-27');
  });
  it('dry run changes nothing, and a broken file stops before committing', () => {
    fs.writeFileSync(path.join(repo, 'progress', 'finals-progress.json'), progressText(at(26, 12)));
    const out = []; const plan = main(['--dry-run'], { cwd: repo, now: at(26, 12), log: s => out.push(s) });
    expect(plan.length).toBe(4); expect(out[0]).toMatch(/^would commit/);
    expect(fs.existsSync(path.join(repo, 'progress', 'days'))).toBe(false);
    expect(git(repo, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    fs.writeFileSync(path.join(repo, 'progress', 'finals-progress.json'), '{ "schemaVersion": 2, <<<<<<< HEAD');
    expect(() => main(['--no-push'], { cwd: repo, now: at(26, 12) })).toThrow(/not valid JSON/);
    fs.rmSync(path.join(repo, 'progress', 'finals-progress.json'));
    expect(() => main(['--no-push'], { cwd: repo, now: at(26, 12) })).toThrow(/No progress file/);
  });
});
