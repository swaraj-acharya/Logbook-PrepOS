// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { buildDayLog, withDayLog, isoLocal, fmtMin } from '../lib/daylog';
import { newCore, docsToWorkspace, workspaceToDocs, serializeWorkspace, parseWorkspaceText } from '../lib/workspace';

const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime();       // local time, September 2026
function docs() {
  const core = newCore({ dayStartHour: 4, activeExamId: 'e1' });
  core.exams = [{ id: 'e1', name: 'Physics finals', date: '2026-10-30', startDate: '2026-09-01' }];
  core.nodes = [{ id: 'S', kind: 'subject', name: 'Mechanics', order: 0 }, { id: 'T', kind: 'topic', name: 'Kinematics', parentId: 'S', order: 0 },
    { id: 'C1', kind: 'concept', name: 'Projectile motion', parentId: 'T', order: 0 }, { id: 'C2', kind: 'concept', name: 'Relative motion', parentId: 'T', order: 1 }];
  core.lectures = [{ id: 'L1', subjectId: 'S', order: 0, name: 'Intro', conceptIds: ['C1'], min: 60, watchedAt: at(25, 9, 50), studiedAt: at(26, 10) }];
  core.planHistory = { '2026-09-25': { date: '2026-09-25', plannedMin: 90, doneMin: 60, tasks: [
    { key: 'lecture0', kind: 'lecture', min: 60, status: 'done', title: 'Watch L01 Intro', start: '09:00', end: '10:00', subjectId: 'S', lectureId: 'L1', why: ['next lecture in Mechanics'] },
    { key: 'review1', kind: 'review', min: 30, status: 'todo', title: 'Recall L01 from memory', subjectId: 'S' },
    { kind: 'practice', min: 20, status: 'skipped' }] } };
  core.plan = { date: '2026-09-26', avail: 120, base: 0, blocks: [
    { key: 'selfstudy0', kind: 'selfstudy', min: 45, title: 'Self-study: L01 Intro', cids: ['C1'], mids: [], subjectId: 'S', lectureId: 'L1', status: 'todo' },
    { key: 'break1', kind: 'break', min: 5, title: 'Break', cids: [], mids: [] },
    { key: 'new2', kind: 'new', min: 40, title: 'Learn Relative motion', cids: ['C2'], mids: [], subjectId: 'S', locked: true, manual: true }], progress: { selfstudy0: 44 }, done: {} };
  core.dayPlans = { '2026-09-28': { date: '2026-09-28', avail: 90, base: 0, blocks: [{ key: 'mv1', kind: 'practice', min: 30, title: 'Past paper', cids: [], mids: [], manual: true }], progress: {} } };
  return { core,
    'ses-2026-09': { sessions: [
      { id: 's1', subjectId: 'S', topicId: 'T', conceptIds: ['C1'], startedAt: at(25, 9, 2), endedAt: at(25, 9, 58), focusSec: 3300, pausedSec: 60, mode: 'lecture', timerStyle: 'focus', source: 'timer', status: 'completed', planBlock: 'lecture0', lectureId: 'L1' },
      { id: 's2', subjectId: 'S', conceptIds: ['C1'], startedAt: at(26, 1, 30), endedAt: at(26, 2, 0), focusSec: 1800, mode: 'reading', source: 'manual', status: 'stopped', notes: 'late night reading' },
      { id: 's3', subjectId: 'S', conceptIds: ['C1', 'C2'], startedAt: at(26, 10), endedAt: at(26, 10, 45), focusSec: 2640, mode: 'reading', source: 'timer', status: 'completed', planBlock: 'selfstudy0', questionsSolved: 4, questionsCorrect: 3 },
      { id: 's4', subjectId: 'S', conceptIds: [], startedAt: at(26, 12), endedAt: at(26, 12, 30), focusSec: 1800, mode: 'reading', status: 'discarded' }] },
    'rev-2026-09': { reviews: [{ id: 'r1', cid: 'C1', at: at(26, 11), g: 3, ivl: 3 }, { id: 'r2', cid: 'C2', at: at(26, 11, 5), g: 1, ivl: 0 }],
      practice: [{ id: 'p1', cid: 'C1', at: at(26, 11, 30), n: 5, c: 4, lv: 'standard' }, { id: 'p2', cid: 'C1', at: at(26, 11, 40), n: 1, c: 1, lv: 'standard', qid: 'q1' }],
      qattempts: [{ id: 'a1', qid: 'q1', at: at(26, 11, 40), result: 'correct', mode: 'practice', grade: 3, timeSec: 150 }] },
    'qs-2026-09': { items: [{ id: 'q1', text: 'A ball is thrown at 30 degrees. Find the range.', conceptId: 'C1', source: 'HC Verma', ref: '4.12', createdAt: at(26, 11, 38) }] },
    'mis-2026-09': { items: [{ id: 'm1', cid: 'C2', at: at(26, 11, 50), q: 'Relative velocity of rain', type: 'sign', stage: 0, next: at(27, 4), attempts: [] }] } };
}
const NOW = at(26, 20);

describe('day-by-day progress log', () => {
  it('keeps one record per study day, with the day starting at 4:00', () => {
    const { days } = buildDayLog(docsToWorkspace(docs(), { now: NOW }), NOW);
    expect(Object.keys(days)).toEqual(['2026-09-25', '2026-09-26']);          // the 01:30 session belongs to the 25th; future plans are left out
    const d25 = days['2026-09-25'], d26 = days['2026-09-26'];
    expect(d25.weekday).toBe('Friday');
    expect(d25.time).toMatchObject({ studiedMin: 85, sessions: 2, plannedMin: 90 });
    expect(d25.sessions.map(s => s.time)).toEqual(['09:02-09:58', '01:30-02:00']);
    expect(d25.sessions[0]).toMatchObject({ subject: 'Mechanics', topic: 'Kinematics', concepts: ['Projectile motion'], mode: 'Lecture or video', lecture: 'L01 Intro', task: 'Watch L01 Intro', pausedMin: 1 });
    expect(d25.tasks.map(t => [t.title, t.status])).toEqual([['Watch L01 Intro', 'done'], ['Recall L01 from memory', 'not done'], ['Practice', 'skipped']]);
    expect(d25.tasks[0]).toMatchObject({ time: '09:00-10:00', kind: 'Lecture', subject: 'Mechanics', minutes: 60, why: ['next lecture in Mechanics'] });
    expect(d25.lectures).toEqual([{ lecture: 'L01 Intro', subject: 'Mechanics', steps: ['watched'] }]);
    expect(d25.exam).toMatchObject({ name: 'Physics finals', daysLeft: 35 });
    expect(d25.newConcepts).toEqual(['Projectile motion']);
    expect(d26.time).toMatchObject({ studiedMin: 44, sessions: 1, plannedMin: 85, availableMin: 120 });        // the discarded session does not count
    expect(d26.tasks.map(t => [t.title, t.status])).toEqual([['Self-study: L01 Intro', 'done'], ['Learn Relative motion', 'to do']]);
    expect(d26.tasks[1]).toMatchObject({ locked: true, addedOrEditedByYou: true });
    expect(d26.sessions[0]).toMatchObject({ task: 'Self-study: L01 Intro', questions: 4, correct: 3 });
    expect(d26.recall).toMatchObject({ count: 2, remembered: 1 });
    expect(d26.recall.items[1]).toEqual({ concept: 'Relative motion', subject: 'Mechanics', grade: 'Again' });
    expect(d26.questions).toMatchObject({ attempted: 1, correct: 1, logged: 1 });
    expect(d26.questions.attempts[0]).toMatchObject({ question: 'A ball is thrown at 30 degrees. Find the range.', subject: 'Mechanics', source: 'HC Verma 4.12', result: 'correct', timeSec: 150 });
    expect(d26.practiceCounts).toEqual([{ concept: 'Projectile motion', questions: 5, correct: 4, level: 'standard' }]);   // question-linked record not counted twice
    expect(d26.mistakes.logged[0]).toMatchObject({ question: 'Relative velocity of rain', type: 'sign', concept: 'Relative motion' });
    expect(d26.lectures[0].steps).toEqual(['self-study done']);
    expect(d26.summary).toMatch(/^Studied 44m in 1 session \(Mechanics 44m\)\. Tasks: 1 of 2 done\./);
    expect(d26.lastActivityAt).toBe(isoLocal(at(26, 11, 50)));
    expect(d26.lastActivityAt).toMatch(/^2026-09-26T11:50:00[+-]\d\d:\d\d$/);
  });
  it('adds an overview with totals and streak', () => {
    const { overview } = buildDayLog(docsToWorkspace(docs(), { now: NOW }), NOW);
    expect(overview.today).toBe('2026-09-26');
    expect(overview.exam).toEqual({ name: 'Physics finals', date: '2026-10-30', daysLeft: 34 });
    expect(overview.totals).toMatchObject({ studiedMin: 129, studyDays: 2, sessions: 3, currentStreakDays: 2, concepts: 2, conceptsRecalled: 1, lectures: 1,
      lecturesCovered: 1, questionsSaved: 1, questionAttempts: 1, questionAccuracy: 1, recalls: 2, openMistakes: 1 });
    expect(fmtMin(129)).toBe('2h 09m');
  });
  it('is written into the file but never read back as data', () => {
    const ws = withDayLog(docsToWorkspace(docs(), { now: NOW }), NOW);
    const text = serializeWorkspace(ws), keys = Object.keys(JSON.parse(text));
    expect(keys.slice(0, 7)).toEqual(['schemaVersion', 'app', 'workspaceId', 'createdAt', 'savedAt', 'updatedAt', 'overview']);
    expect(keys[keys.length - 1]).toBe('days');
    const back = workspaceToDocs(parseWorkspaceText(text).ws);
    expect(Object.keys(back).some(k => /days|overview/.test(k))).toBe(false);
    expect(back['ses-2026-09'].sessions.length).toBe(4);
  });
  it('keeps each day where it happened even when saved days later', () => {
    const later = at(29, 9);                                     // saved three days later
    const { days } = buildDayLog(docsToWorkspace(docs(), { now: later }), later);
    expect(days['2026-09-26'].tasks.map(t => t.status)).toEqual(['done', 'not done']);
    expect(days['2026-09-26'].time.studiedMin).toBe(44);
    expect(days['2026-09-28'].tasks.map(t => [t.title, t.status])).toEqual([['Past paper', 'not done']]);   // a moved task, on its own day
  });
});
