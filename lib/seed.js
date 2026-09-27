/* =====================================================================
   Reference text for the Method page, and the colour palette.
   No exam or syllabus is built in: every preparation starts from the setup
   wizard or an import (see examples/ for a sample syllabus file).
   ===================================================================== */
export const PALETTE = ['#2447C8', '#0E7C86', '#8A4FBF', '#C2410C', '#15803D', '#B8336A', '#A16207', '#475569', '#0369A1', '#9F1239', '#4D7C0F', '#6D28D9'];

export const EVIDENCE = [
  { p: 'Retrieval practice (testing effect)', s: 'Strong', e: 'Recalling information strengthens later retention more than restudying it. Supported across many studies and meta-analyses; rated high utility in a major review of study techniques.', src: 'Roediger & Karpicke (2006), Psychological Science. Rowland (2014), Psychological Bulletin. Adesope, Trevisan & Sundararajan (2017), Review of Educational Research. Dunlosky et al. (2013), Psychological Science in the Public Interest.', f: 'Reviews hide the answer first. After every session the app offers “Recall now”.' },
  { p: 'Spacing and distributed practice', s: 'Strong', e: 'Spreading practice over time beats massing it. The best gap grows with how long you need to remember.', src: 'Cepeda et al. (2006), Psychological Bulletin. Cepeda et al. (2008), Psychological Science. Dunlosky et al. (2013).', f: 'Adaptive review dates per concept, capped so a review lands before your exam.' },
  { p: 'Successive relearning', s: 'Strong', e: 'Retrieving to a correct answer, then repeating that across spaced sessions, produces durable and efficient learning.', src: 'Rawson & Dunlosky (2011), Journal of Experimental Psychology: General. Rawson, Dunlosky & Sciartelli (2013), Educational Psychology Review.', f: 'Missed items come back later in the same review and again on later days.' },
  { p: 'Feedback after retrieval', s: 'Strong', e: 'Feedback, especially after errors, improves what is retained; it works best when it tells you what to change.', src: 'Hattie & Timperley (2007), Review of Educational Research. Butler & Roediger (2008), Memory & Cognition.', f: 'Reveal-and-compare on every card; corrected reasoning stored with each mistake.' },
  { p: 'Interleaving', s: 'Moderate, conditional', e: 'Mixing problem types helps you learn to tell similar problems apart. Benefits depend on the material and are strongest for easily confused categories.', src: 'Rohrer & Taylor (2007), Instructional Science. Brunmair & Richter (2019), Psychological Bulletin.', f: 'Mixed practice and mixed review, used only after concepts have been learned once.' },
  { p: 'Self-explanation and elaboration', s: 'Moderate', e: 'Explaining why and how, in your own words, improves understanding and transfer.', src: 'Chi et al. (1994), Cognitive Science. Bisra et al. (2018), Educational Psychology Review. Dunlosky et al. (2013).', f: 'Teach-back: explain a concept without notes, then see what you missed.' },
  { p: 'Generation effect', s: 'Moderate', e: 'Information you produce yourself is remembered better than information you only read.', src: 'Slamecka & Graf (1978), Journal of Experimental Psychology: Human Learning and Memory. Bertsch et al. (2007), Memory & Cognition.', f: 'Write your answer before revealing. Write your own recall prompts.' },
  { p: 'Learning from errors', s: 'Moderate', e: 'Errors followed by corrective feedback can improve learning; high-confidence errors are often corrected especially well.', src: 'Metcalfe (2017), Annual Review of Psychology. Butterfield & Metcalfe (2001), Journal of Experimental Psychology: Learning, Memory, and Cognition.', f: 'Mistake notebook with typed causes and staged retries.' },
  { p: 'Metacognition and calibration', s: 'Moderate', e: 'Learners often misjudge what they know and which strategies work; overconfidence leads to stopping study too early.', src: 'Kornell & Bjork (2008), Psychological Science. Dunlosky & Rawson (2012), Learning and Instruction.', f: 'Confidence rating before reveal; calibration chart in Insights.' },
  { p: 'Worked examples, cognitive load, expertise reversal', s: 'Moderate', e: 'Worked examples help novices; as expertise grows, independent problem solving becomes more useful.', src: 'Sweller, van Merriënboer & Paas (1998; 2019), Educational Psychology Review. Kalyuga et al. (2003), Educational Psychologist.', f: 'Practice ladder: basic, standard, advanced, unfamiliar problems.' },
  { p: 'Transfer of learning', s: 'Mixed', e: 'Retrieval practice transfers to new questions moderately; transfer is not automatic.', src: 'Pan & Rickard (2018), Psychological Bulletin. Barnett & Ceci (2002), Psychological Bulletin.', f: '“Applied” requires success on advanced or unfamiliar problems, not only recall.' },
  { p: 'Forgetting curves', s: 'Strong (existence); model form approximate', e: 'Memory declines quickly at first, then more slowly. Exact curves vary by person and material.', src: 'Ebbinghaus (1885). Murre & Dros (2015), PLoS ONE.', f: 'Estimated recall percentage per concept, shown as an estimate.' },
  { p: 'Desirable difficulties', s: 'Framework', e: 'Conditions that feel harder (spacing, testing, interleaving) often produce better long-term learning than conditions that feel fluent.', src: 'Bjork (1994). Bjork & Bjork (2011).', f: 'The app does not treat “it felt easy” as evidence of learning.' },
  { p: 'Rereading and highlighting', s: 'Low utility as a main strategy', e: 'Rated low utility when used alone. Reading is still how you first meet material, so the app tracks it without judging it.', src: 'Dunlosky et al. (2013).', f: 'Insights shows how your time splits between taking in, making, and retrieving.' }
];

export const HEURISTICS = [
  ['Review scheduler', 'Uses the FSRS v4.5 formula structure with its default starting weights (Ye, Su & Cao, KDD 2022 describes the underlying approach). The weights were fitted on general flashcard users, not on you or on the material of your exam. Estimates should be read as approximate.'],
  ['Estimated recall %', 'A model estimate from your review history. It is not the exact probability that you will remember something.'],
  ['Estimated mastery', 'Weighted blend: retrieval accuracy 30%, application accuracy 25%, current recall 20%, stability 15%, confidence calibration 10%. Missing parts are left out. Needs at least two data points; evidence level is shown beside it.'],
  ['Concept states', 'Thresholds for Understood, Retrieved, Practiced, Applied, Stable and Mastered are product rules. Time studied alone never moves a concept past Exposed.'],
  ['Daily plan mix', 'Early phases lean to new learning; the middle balances new learning, recall and practice; the final phases lean to revision, practice, saved questions and mistakes. The split per phase is editable in Settings, and new learning is raised automatically when the syllabus would not otherwise be covered in time.'],
  ['Review priority', 'Overdue ratio, forgetting risk, importance, prerequisite status and lapses, with editable weights.'],
  ['Exam-aware cap', 'No review interval is allowed to jump past the last days before your exam.'],
  ['Importance and retention', 'High-importance concepts target slightly higher recall (0.93 by default); low-importance ones slightly lower (0.85).'],
  ['Idle detection', 'If the device sleeps or the page is closed for longer than your idle threshold while a timer runs, you choose whether that gap counts.'],
  ['Roadmap order', 'Subjects you mark as prerequisites come first, then priority, importance and your own order. Concepts follow their prerequisites. This is a planning rule, not an experimental finding.'],
  ['Roadmap phases', 'Foundation, coverage, practice, revision and final preparation, with lengths set by the time left: more than 180 days gets all five; under three weeks gets coverage, practice and final; the last week is always final preparation. The proportions are product rules.'],
  ['Workload estimate', 'New concepts at your minutes-per-concept setting (30 by default), lectures at their length plus self-study, practice per concept, expected reviews from the memory model, and mistake retries. Your own hour estimate for a subject replaces the structure-based figure. A subject with neither uses a default and says so.'],
  ['Feasibility', 'Compares the estimated work with your study time up to the day before the exam (rest days and unavailable dates excluded). Under 10% of spare time counts as tight. The options to close a gap are calculated, not recommended; you choose.'],
  ['Subjects per day', 'Chosen by time share deficit over the last 14 days, days since last studied, priority and importance, prerequisites, pending lectures, weak practice and due reviews. Yesterday\u2019s main subject gets a small penalty when the number of subjects is limited, so subjects rotate.'],
  ['Lecture pipeline', 'Watch, then self-study (0.6 minutes per lecture minute by default), then recall, then practice and spaced revision. A lecture counts as covered after watching plus self-study or recall, or when you mark it complete.'],
  ['Question review', 'Each saved question has its own spaced schedule, separate from the concept\u2019s memory. Right, partly right and wrong map to Good, Hard and Again (a quick, confident right answer to Easy). A wrong answer also creates a mistake that keeps the question.'],
  ['Practice signal', 'Recall at least moderate but practice accuracy under 60% over three or more questions marks a concept as weak on application: it gets more practice and less passive study. Accuracy over 85% with good recall reduces practice for it.'],
  ['Missed days', 'A planned day with under a fifth of the plan studied counts as missed. The backlog is spread over coming days with at most about 40% of each day going to catching up; missed work is not stacked onto today.'],
  ['Mistake retry stages', '1 day, 3 days, 7 days (a similar problem), 21 days. A failed retry restarts at 1 day. Question-linked mistakes show the saved question, answer and solution when retried.']
];

export const DATA_MODEL_TS = `// The progress file (schema version 2). Full definitions: lib/types.ts and lib/daylog.ts.
type ID = string; type DateKey = string /* YYYY-MM-DD */; type Level3 = 1 | 2 | 3;

type PrepWorkspace = {
  schemaVersion: 2; app: { name: "Logbook PrepOS"; format: "prep-workspace" };
  workspaceId: ID; createdAt: string; savedAt: string; updatedAt: number;
  overview: Overview;                               // derived on save: totals, streak, days left
  exam: Exam | null; exams: Exam[];                 // the active exam first
  settings: Settings; prep: PrepConfig; availability: StudyAvailability; roadmap: RoadmapBaseline | null;
  subjects: SyllabusNode[]; nodes: SyllabusNode[]; lectures: Lecture[]; resources: Resource[];
  sessions: StudySession[]; reviews: RecallAttempt[]; practiceAttempts: PracticeAttempt[];
  practiceQuestions: PracticeQuestion[]; questionAttempts: QuestionAttempt[];
  mistakes: Mistake[]; teachBacks: TeachBack[]; recallPrompts: Record<ID, RecallPrompt[]>;
  conceptMemory: Record<ID, MemoryRecord>;          // concept memory (FSRS)
  questionMemory: Record<ID, MemoryRecord>;         // question memory, separate
  activeSession: ActiveSession | null; plans: Record<DateKey, DailyPlan>; planHistory: Record<DateKey, PlanHistoryEntry>;
  deleted: { doc: string; id: ID; at: number }[];   // tombstones, so merges never resurrect deletions
  quarantine: unknown[];                            // unreadable items, set aside rather than deleted
  days: Record<DateKey, DayLog>;                    // derived on save: one readable record per study day
}; schemaVersion: 2;
  workspaceId: ID; createdAt: string; savedAt: string;
  exam: Exam | null; exams: Exam[];                 // the active exam first
  settings: Settings; prep: PrepConfig; availability: StudyAvailability;
  nodes: SyllabusNode[]; lectures: Lecture[]; resources: Resource[];
  memory: Record<ID, MemoryRecord>;                 // concept memory (FSRS)
  questionMemory: Record<ID, MemoryRecord>;         // question memory, separate
  sessions: StudySession[]; reviews: RecallAttempt[]; practice: PracticeAttempt[];
  practiceQuestions: PracticeQuestion[]; questionAttempts: QuestionAttempt[];
  mistakes: Mistake[]; teachBacks: TeachBack[]; prompts: Record<ID, RecallPrompt[]>;
  active: ActiveSession | null; plan: DailyPlan | null; plans: Record<DateKey, DailyPlan>;
  planHistory: Record<DateKey, PlanHistoryEntry>; roadmap: RoadmapBaseline | null;
  deleted: { doc: string; id: ID; at: number }[];   // tombstones, so merges never resurrect deletions
};

type Exam = { id: ID; name: string; desc?: string; date?: DateKey; time?: string; location?: string; startDate?: DateKey; archived?: boolean };

// One tree: subject > topic > subtopic > concept. A subject name alone is enough to plan with.
type SyllabusNode = { id: ID; kind: "subject" | "topic" | "subtopic" | "concept"; parentId?: ID; name: string; order: number;
  examIds?: ID[]; imp?: Level3; diff?: Level3; priority?: Level3; estHours?: number | null; targetDate?: DateKey | null;
  prereqSubjects?: ID[]; prereq?: ID[]; color?: string; share?: number; desc?: string; auto?: boolean; lectureId?: ID };

// Numbered per subject from position (L01, L02 ...); ids never change, so renames and reordering keep every link.
type Lecture = { id: ID; subjectId: ID; order: number; name: string; min?: number; url?: string; instructor?: string;
  conceptIds: ID[]; topicId?: ID; imp?: Level3; prereq?: ID[]; notes?: string;
  watchedAt?: number | null; studiedAt?: number | null; recalledAt?: number | null; practicedAt?: number | null; doneAt?: number | null };

type Resource = { id: ID; kind: "lecture" | "video" | "youtube" | "website" | "book" | "pdf" | "notes" | "questionbank" | "mock" | "other";
  title: string; url?: string; on: { kind: "exam" | "subject" | "topic" | "concept" | "lecture"; id: ID }[] };

type StudyAvailability = { weekday: { minutes: number; windows: { start: string; end: string }[] }; weekend: { minutes: number; windows: { start: string; end: string }[] };
  weekendDays: number[]; restDays: number[]; unavailable: DateKey[]; sessionsPerDay: number; minSession: number };

type PrepConfig = { mode: "self" | "lectures"; subjectsPerDay: { weekday: number; weekend: number }; maxSwitches: number;
  selfStudyRatio: number; defaultLectureMin: number; minPerNewConcept: number; practiceMinPerConcept: number; minPerQuestion: number;
  defaultSubjectHours: number; practiceScale: number; dropLowImportance: boolean; effort: "normal" | "extra"; extraMinPerDay: number;
  acceptIncomplete: boolean; setupDone: boolean };

type StudySession = { id: ID; subjectId: ID | null; topicId?: ID; conceptIds: ID[]; startedAt: number; endedAt: number;
  focusSec: number; pausedSec: number; idleExcludedSec: number; mode: string; source: "timer" | "manual" | "imported";
  planBlock?: string; taskId?: ID; lectureId?: ID; qids?: ID[]; questionsSolved?: number; questionsCorrect?: number; status: string };

type MemoryRecord = { S?: number; D?: number; last?: number; due: number; ivl?: number; reps: number; lapses: number; ok: number; fail: number; state: "new" | "review" | "relearning" };

type PracticeQuestion = { id: ID; text: string; subjectId?: ID; conceptId?: ID; lectureId?: ID; type: string; difficulty?: string;
  source?: string; ref?: string; url?: string; answer?: string; solution?: string; tags?: string[]; createdAt: number };
type QuestionAttempt = { id: ID; qid: ID; at: number; result: "correct" | "partial" | "incorrect"; timeSec?: number;
  confidence?: number; mistakeType?: string; mode: "log" | "review" | "retry"; sessionId?: ID };

type Mistake = { id: ID; cid?: ID; qid?: ID; at: number; question: string; type: string; why?: string; fix?: string;
  stage: 0 | 1 | 2 | 3; next: number; resolved?: boolean; retries: { at: number; ok: boolean; stage: number }[] };

type DayTask = { key: string; id?: ID; kind: "review" | "new" | "practice" | "mistakes" | "cumulative" | "break" | "lecture" | "selfstudy" | "recall" | "qreview";
  min: number; title: string; cids: ID[]; mids: ID[]; qids?: ID[]; lectureId?: ID; subjectId?: ID;
  start?: string; end?: string; status?: "todo" | "done" | "skipped"; locked?: boolean; manual?: boolean; why?: string[] };
type DailyPlan = { date: DateKey; avail: number; blocks: DayTask[]; progress: Record<string, number>; notes?: string[] };

// One study day, written on every save (the day starts at the "study day starts at" hour).
type DayLog = { date: DateKey; weekday: string; summary: string;
  exam?: { name: string; daysLeft?: number; phase?: string };
  time: { studiedMin: number; studied: string; sessions: number; plannedMin?: number; availableMin?: number; bySubject?: Record<string, number> };
  tasks?: { time?: string; title: string; kind: string; subject?: string; minutes: number; status: "done" | "skipped" | "to do" | "not done"; why?: string[] }[];
  sessions?: { time: string; focusMin: number; subject: string; topic?: string; concepts?: string[]; mode: string; lecture?: string; task?: string; notes?: string }[];
  newConcepts?: string[]; recall?: { count: number; remembered: number; items: { concept: string; grade: string }[] };
  questions?: { attempted: number; correct: number; partial: number; wrong: number; logged: number; attempts: { question: string; result: string }[] };
  lectures?: { lecture: string; steps: string[] }[]; mistakes?: { logged: object[]; retries: object[]; resolved: number };
  firstActivityAt?: string; lastActivityAt?: string };`;

export const ARCH_NOTES = [
  ['Storage', 'Your progress is one JSON file on your computer (schema version 2), created or linked in Settings, Store progress, and saved to automatically about a second and a half after each change. Kept in the progress folder of your repository, it is pushed with npm run progress:push, one commit per study day, using your own git login. The browser remembers the file between visits; after a restart it may ask for permission again. A copy is also kept in this browser for offline use and recovery. Browsers without direct file access (Firefox, Safari) download and upload copies instead.'],
  ['Safety', 'A file that cannot be read, or that now holds a different preparation, is never overwritten. If the file changed outside the app, both versions are merged item by item. A recovery copy is kept in the browser before one preparation replaces another.'],
  ['Older data', 'Logbook backups, the old browser copy and the per-file data from the GitHub data repository (core.json, ses-YYYY-MM.json and so on) are converted when opened. Nothing is dropped: settings, syllabus, memory, sessions, reviews, practice, mistakes, prompts and plans all carry over.'],
  ['Account sync (optional)', 'When the server is configured with sign-in, a copy is also synced through /api/docs and /api/sync to GitHub or a server folder. Each save names the version it was based on; conflicting copies are merged item by item and memory per concept, keeping the more advanced record.'],
  ['Timer reliability', 'The timer stores its start timestamp, pause totals and a heartbeat. Elapsed time is always derived from timestamps, never from counting ticks, so refreshes, route changes and background tabs do not lose time. Sleep or closed-page gaps longer than your idle threshold are shown to you to keep or exclude.'],
  ['Analytics', 'Sessions roll up into daily totals once; weekly, monthly and custom ranges sum those daily totals.'],
  ['Offline', 'After the first visit the app works without a connection: a service worker keeps the page and its code, and your data is local. Account sync and the AI features wait until you are online.'],
  ['AI (optional)', 'The coach, teach-back feedback, prompt drafting and natural-language logging call the Anthropic API from the server with a compact summary of your data, only when configured. The API key never reaches the browser. Everything else works without AI.'],
  ['Code layout', 'UI in client/ (ui.js shell and study views; setup-ui.js wizard; plan-ui.js today, roadmap and settings; study-ui.js lectures and practice). Domain logic in lib/ as pure, tested functions: engine.js (memory, mastery, planDay), roadmap.ts (phases, workload, feasibility, forecast), dayplan.ts (day planner), lectures.ts, practice.ts, syllabus-import.ts, dates.ts. Data in lib/workspace.ts (file format, migration) and lib/merge.js; storage in lib/storage/ (local-file.ts for the preparation file; github.ts and fs.ts for account sync).']
];
