#!/usr/bin/env node
/*
 * Saves your Logbook PrepOS progress to git, one commit per study day, then pushes.
 *
 *   npm run progress:push                    commit every new or changed day, then git push
 *   npm run progress:push -- --no-push       commit only
 *   npm run progress:push -- --dry-run       show what would be committed; change nothing
 *   npm run progress:push -- --dir <folder>  the progress folder (default: progress)
 *
 * The app writes your progress file (for example progress/physics-finals-progress.json). This script reads it,
 * writes one readable file per study day to progress/days/YYYY-MM-DD.json, and commits each new or changed day
 * on its own, dated at that day's last activity. A day you forgot to push therefore still appears on its own date
 * in the history, not lumped into the day you pushed. The progress file itself is committed last. It uses your
 * normal git login (SSH key or credential helper); no GitHub token is involved. Other changes in your working tree
 * are left alone, staged or not.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = `Commits your progress to git one study day at a time, then pushes.
  npm run progress:push                    commit every new or changed day, then git push
  npm run progress:push -- --no-push       commit only
  npm run progress:push -- --dry-run       show what would be committed
  npm run progress:push -- --dir <folder>  the progress folder (default: progress)`;
const pad = n => String(n).padStart(2, '0');
function isoLocal(ts) {
  const d = new Date(ts), off = -d.getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
/** The study day for a moment, with the day starting at `sh` o'clock (same rule as the app). */
function studyDay(ts, sh) { const d = new Date(ts - (sh || 0) * 3600e3); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
/** Late in the day itself, in local time: used when a day has no activity time, or its last activity ran past midnight. */
function endOfDate(date) { const [y, m, d] = date.split('-').map(Number); return isoLocal(new Date(y, m - 1, d, 23, 59, 0).getTime()); }

export function parseArgs(argv) {
  const o = { dir: 'progress', push: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-push') o.push = false;
    else if (a === '--dry-run') { o.dryRun = true; o.push = false; }
    else if (a === '--dir') o.dir = argv[++i];
    else if (a.startsWith('--dir=')) o.dir = a.slice(6);
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('Unknown option ' + a + '. Use --help.');
  }
  return o;
}
function isWorkspace(j) { return j && typeof j === 'object' && (j.app && j.app.format === 'prep-workspace' || (typeof j.schemaVersion === 'number' && 'workspaceId' in j)); }
function subjectLine(date, log, update) {
  const t = log.tasks || [], done = t.filter(x => x.status === 'done').length;
  return `${update ? 'Update progress' : 'Progress'} ${date} (${log.weekday || ''}): ${log.time ? log.time.studied : '0m'} studied${t.length ? `, ${done}/${t.length} tasks done` : ''}`;
}
function body(log) {
  const mark = { done: '[x]', skipped: '[-]', 'to do': '[ ]', 'not done': '[ ]' };
  const lines = [log.summary || ''];
  if ((log.tasks || []).length) { lines.push('', 'Tasks:'); for (const t of log.tasks) lines.push(`${mark[t.status] || '[ ]'} ${t.time ? t.time + ' ' : ''}${t.title} (${t.minutes} min${t.subject ? ', ' + t.subject : ''})${t.status === 'not done' ? ' - not done' : t.status === 'skipped' ? ' - skipped' : ''}`); }
  return lines.join('\n');
}

/**
 * Runs the whole thing. `env.cwd` is where to start (default: the current folder); `env.now` the current time.
 * Returns the list of commits made (or planned, with dryRun).
 */
export function main(argv, env = {}) {
  const o = parseArgs(argv), log = env.log || (s => console.log(s)), now = env.now || Date.now();
  if (o.help) { log(USAGE); return []; }
  const cwd = env.cwd || process.cwd(), dir = path.resolve(cwd, o.dir);
  if (!fs.existsSync(dir)) throw new Error(`There is no folder ${dir}. Create it and save your progress file there from the app (Settings, Store progress).`);
  const git = (args, extra = {}) => execFileSync('git', args, { cwd: root || dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...extra });
  let root = null;
  try { root = git(['rev-parse', '--show-toplevel']).trim(); } catch { throw new Error(`${dir} is not inside a git repository.`); }
  const rel = p => path.relative(root, p).split(path.sep).join('/');
  let hasHead = true; try { git(['rev-parse', '--verify', '-q', 'HEAD']); } catch { hasHead = false; }
  const committed = p => { if (!hasHead) return null; try { return git(['show', 'HEAD:' + rel(p)]); } catch { return null; } };

  // the progress files written by the app
  const files = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.json') && !n.startsWith('.')).map(n => path.join(dir, n)).filter(p => fs.statSync(p).isFile());
  const sources = [];
  for (const p of files) {
    let j; const text = fs.readFileSync(p, 'utf8');
    try { j = JSON.parse(text); } catch { throw new Error(`${rel(p)} is not valid JSON (it may be in the middle of a merge conflict). Nothing was committed.`); }
    if (isWorkspace(j)) sources.push({ p, j });
  }
  if (!sources.length) throw new Error(`No progress file in ${rel(dir) || '.'}. In the app, open Settings, Store progress, and create or link a file in this folder.`);

  // one readable file per day
  const days = [];
  for (const { p, j } of sources) {
    const daysDir = sources.length === 1 ? path.join(dir, 'days') : path.join(dir, 'days', path.basename(p, '.json'));
    const sh = Number(j.settings && j.settings.dayStartHour) || 0, today = studyDay(now, sh);
    for (const [date, dayLog] of Object.entries(j.days || {})) {
      if (!/^\d{4}-\d\d-\d\d$/.test(date) || date > today) continue;
      const file = path.join(daysDir, date + '.json'), text = JSON.stringify(dayLog, null, 2) + '\n';
      const before = committed(file);
      if (before === text) continue;
      const onDisk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (!o.dryRun && onDisk !== text) { fs.mkdirSync(daysDir, { recursive: true }); fs.writeFileSync(file, text); }
      let when = date < today ? (dayLog.lastActivityAt || endOfDate(date)) : isoLocal(now);
      if (date < today && when.slice(0, 10) > date) when = endOfDate(date);      // study after midnight still belongs to its own day
      days.push({ date, file, log: dayLog, update: before != null, when });
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file));
  const plan = days.map(d => ({ files: [d.file], subject: subjectLine(d.date, d.log, d.update), body: body(d.log), when: d.when, date: d.date }));
  const changedSources = sources.filter(s => committed(s.p) !== fs.readFileSync(s.p, 'utf8'));
  if (changedSources.length) {
    const ds = days.map(d => d.date);
    plan.push({ files: changedSources.map(s => s.p), subject: 'Update progress data' + (ds.length ? ` (${ds[0]}${ds.length > 1 ? ' to ' + ds[ds.length - 1] : ''})` : ''),
      body: 'The full progress file written by Logbook PrepOS: syllabus, lectures, memory, sessions, questions, mistakes and plans.', when: isoLocal(now) });
  }
  if (!plan.length) { log('Nothing new to commit. Your progress is already in git.'); }
  for (const c of plan) {
    if (o.dryRun) { log(`would commit  ${c.when}  ${c.subject}`); continue; }
    const paths = c.files.map(rel);
    git(['add', '--', ...paths]);
    try { git(['commit', '--quiet', '-m', c.subject, '-m', c.body, '--', ...paths], { env: { ...process.env, GIT_AUTHOR_DATE: c.when, GIT_COMMITTER_DATE: c.when } }); }
    catch (e) {
      const msg = String(e.stderr || e.message || '');
      if (/nothing to commit|no changes added/i.test(msg)) continue;
      if (/Please tell me who you are|user\.email/i.test(msg)) throw new Error('git does not know who you are yet. Run: git config --global user.name "Your Name" and git config --global user.email "you@example.com"');
      throw new Error('git commit failed: ' + msg.trim());
    }
    log(`committed  ${c.when.slice(0, 16).replace('T', ' ')}  ${c.subject}`);
  }
  if (o.push && plan.length) {
    try { execFileSync('git', ['push'], { cwd: root, stdio: 'inherit' }); log('Pushed.'); }
    catch {
      log('The commits are saved locally, but git push did not succeed.');
      log('If the branch has no upstream yet:   git push -u origin HEAD');
      log('If the remote has newer commits:     git pull --rebase   then run this again');
      process.exitCode = 1;
    }
  }
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(e.message || e); process.exitCode = 1; }
}
