/*
 * Data model for Logbook PrepOS.
 *
 * Internally the app keeps data as a small set of documents (core + month buckets) so edits stay cheap and can be
 * merged item by item. The portable preparation file (PrepWorkspace) is a flattened, versioned view of the same data.
 * Pure modules in lib/ are written against these types; the browser UI (client/*.js) is plain JavaScript.
 */
export type ID = string;
/** Local calendar date, YYYY-MM-DD. */
export type DateKey = string;
/** Local clock time, HH:MM (24 h). */
export type ClockTime = string;
export type Level3 = 1 | 2 | 3;

export type StudyMode = "lecture" | "reading" | "notes" | "recall" | "practice"
  | "revision" | "mistakes" | "teachback" | "mock" | "mixed";
export type TimerStyle = "stopwatch" | "focus" | "pomodoro" | "deep" | "recall" | "practice" | "mock";

/* ------------------------------------------------------------------ exam and syllabus */

export type Exam = {
  id: ID; name: string; date?: DateKey; archived?: boolean;
  desc?: string; time?: ClockTime; location?: string;
  /** When preparation started; the roadmap timeline runs from here to the exam. */
  startDate?: DateKey;
};

/** One tree for every exam: subject > topic > subtopic > concept. */
export type SyllabusNode = {
  id: ID; kind: "subject" | "topic" | "subtopic" | "concept"; parentId?: ID | null;
  name: string; order: number; archived?: boolean; createdAt?: number;
  examIds?: ID[]; color?: string;
  /** Planned share of study time in percent. 0 or missing: derived from importance, difficulty and workload. */
  share?: number;
  imp?: Level3;             // importance for the exam
  desc?: string; prereq?: ID[]; notes?: string; formula?: string;
  resources?: { id: ID; title: string; url?: string; kind?: string }[];   // legacy per-concept resources
  // subject-only planning fields (v2)
  diff?: Level3;            // difficulty
  priority?: Level3;        // 3 = do first
  estHours?: number;        // user's estimate of total learning time
  targetDate?: DateKey;     // finish learning by
  prereqSubjects?: ID[];
  // auto-created concept that stands for one lecture (simple setup without topics)
  lectureId?: ID; auto?: "lectures";
};

/* ------------------------------------------------------------------ lectures and resources */

export type LectureStatus = "todo" | "in-progress" | "done";
export type Lecture = {
  id: ID;                   // stable, never shown
  subjectId: ID;
  order: number;            // position within the subject; the visible code (L01, L02) is derived from it
  name: string;             // user title; empty means "just the code"
  topicId?: ID | null; conceptIds: ID[];
  min?: number;             // duration in minutes
  url?: string; instructor?: string; notes?: string; imp?: Level3; prereq?: ID[];
  watchedAt?: number | null; studiedAt?: number | null; recalledAt?: number | null; practicedAt?: number | null;
  /** Marked complete by hand, whatever the steps say. */
  doneAt?: number | null;
  createdAt?: number; updatedAt?: number; gone?: boolean;
};

export type ResourceKind = "lecture" | "video" | "youtube" | "website" | "book" | "pdf" | "notes"
  | "questionbank" | "mock" | "other";
export type ResourceTarget = { kind: "exam" | "node" | "lecture"; id: ID };
export type Resource = { id: ID; kind: ResourceKind; title: string; url?: string; notes?: string;
  on: ResourceTarget[]; createdAt?: number; updatedAt?: number; gone?: boolean };

/* ------------------------------------------------------------------ availability and preparation settings */

export type TimeWindow = { start: ClockTime; end: ClockTime };
export type DayAvailability = { minutes: number; windows: TimeWindow[] };
export type StudyAvailability = {
  weekday: DayAvailability; weekend: DayAvailability;
  weekendDays: number[];            // 0 = Sunday … 6 = Saturday
  restDays: number[];               // weekdays with no study
  unavailable: DateKey[];           // dates with no study
  overrides?: Record<DateKey, number>;
  sessionsPerDay: number;           // 0 = not set
  minSession: number;               // minutes
};

export type PrepMode = "self" | "lectures";
export type PrepConfig = {
  mode: PrepMode;
  subjectsPerDay: { weekday: number; weekend: number };   // 0 = no limit
  maxSwitches: number;              // 0 = no limit
  selfStudyRatio: number;           // self-study minutes per lecture minute
  defaultLectureMin: number;
  minPerNewConcept: number;
  practiceMinPerConcept: number;
  minPerQuestion: number;           // re-solving one saved question
  defaultSubjectHours: number;      // used when a subject has no structure and no estimate
  practiceScale: number;            // 1 = full practice target
  dropLowImportance: boolean;       // leave low-importance content out of the workload
  effort: "normal" | "extra";
  extraMinPerDay: number;
  /** You chose to keep the schedule even though not everything fits; the shortfall stays visible, the warning does not nag. */
  acceptIncomplete: boolean;
  setupDone: boolean;
};

/* ------------------------------------------------------------------ sessions, memory, practice */

export type StudySession = {
  id: ID; examId?: ID | null;
  subjectId: ID | null; topicId?: ID | null; subtopicId?: ID | null; conceptIds: ID[];
  startedAt: number; endedAt: number;
  elapsedSec: number; pausedSec: number; breakSec: number; idleExcludedSec: number;
  focusSec: number; selfReportedSec?: number | null;
  split?: { s: ID | null; t?: ID | null; u?: ID | null; c?: ID | null; sec: number }[];
  mode: StudyMode; timerStyle: TimerStyle | null; targetSec?: number | null;
  source: "timer" | "manual" | "imported"; edited?: boolean; originalFocusSec?: number;
  questionsSolved?: number; questionsCorrect?: number;
  confidenceBefore?: number | null; confidenceAfter?: number; focusRating?: number; difficultyRating?: number;
  notes?: string; understood?: string; difficult?: string;
  planBlock?: string | null; taskId?: ID | null; lectureId?: ID | null; qids?: ID[];
  status: "completed" | "stopped" | "discarded";
  updatedAt?: number; gone?: boolean;
};

/** FSRS memory for one concept or one question. */
export type MemoryRecord = {
  S?: number; D?: number; last?: number; due: number; ivl?: number;
  reps: number; lapses: number; ok: number; fail: number;
  state: "new" | "review" | "relearning"; first?: number;
};

export type RecallAttempt = {
  id: ID; cid: ID; at: number; g: 1 | 2 | 3 | 4;
  o?: "correct" | "partial" | "incorrect"; hint?: boolean;
  rt?: number; cf?: number; R?: number | null; S?: number; ivl: number; mixed?: boolean;
};

/** Aggregate practice for a concept (n questions, c correct). Question-level logs also write one of these. */
export type PracticeAttempt = { id: ID; cid: ID; at: number; n: number; c: number;
  lv: "basic" | "standard" | "advanced" | "unfamiliar"; ses?: ID | null; min?: number | null; src?: string; qid?: ID };

export type QuestionResult = "correct" | "partial" | "incorrect";
export type QuestionDifficulty = "easy" | "medium" | "hard";
export type QuestionType = "mcq" | "numerical" | "short" | "descriptive" | "coding" | "other";
export type PracticeQuestion = {
  id: ID; text: string;
  subjectId?: ID | null; topicId?: ID | null; subtopicId?: ID | null; conceptId?: ID | null;
  source?: string; ref?: string; difficulty?: QuestionDifficulty; type?: QuestionType;
  answer?: string; solution?: string; notes?: string; url?: string; image?: string; tags?: string[];
  createdAt: number; updatedAt?: number; gone?: boolean;
};
export type QuestionAttempt = {
  id: ID; qid: ID; at: number; result: QuestionResult;
  timeSec?: number | null; confidence?: number | null;
  mode: "practice" | "review" | "retry"; sessionId?: ID | null; grade: 1 | 2 | 3 | 4;
  ivl?: number; answer?: string;
};

export type Mistake = { id: ID; cid?: ID | null; sid?: ID | null; qid?: ID | null; at: number; q: string;
  type: "concept" | "formula" | "calculation" | "unit" | "sign" | "misreading"
      | "reasoning" | "memory" | "time" | "careless" | "guess";
  why?: string; fix?: string; remember?: string; src?: string;
  stage: number; next: number; resolved?: boolean; resolvedAt?: number;
  attempts?: { at: number; r: "right" | "partly" | "wrong"; stage: number }[];
  updatedAt?: number; gone?: boolean };

export type RecallPrompt = { id: ID; kind: "free" | "formula" | "blank" | "explain" | "compare"
  | "diagram" | "application" | "problem"; q: string; a?: string; hint?: string; lastAt?: number };

export type TeachBack = { id: ID; cid: ID; at: number; text: string; score?: number; ai?: boolean;
  correct?: string[]; missing?: string[]; misconceptions?: string[]; next?: string };

/* ------------------------------------------------------------------ plans, roadmap */

export type TaskKind = "review" | "new" | "practice" | "mistakes" | "cumulative" | "break"
  | "lecture" | "selfstudy" | "recall" | "qreview";
export type TaskStatus = "todo" | "done" | "skipped";
/** One task in a day plan. Older plans called these blocks and had only key/kind/min/title/cids/mids. */
export type DayTask = {
  key: string; id?: ID; kind: TaskKind; min: number; title: string; cids: ID[]; mids: ID[];
  qids?: ID[]; lectureId?: ID | null; subjectId?: ID | null;
  start?: ClockTime | null; end?: ClockTime | null;
  status?: TaskStatus; locked?: boolean; manual?: boolean;
  why?: string[]; interleaved?: boolean; partOf?: string; fromDay?: DateKey;
};
export type DailyPlan = { date: DateKey; avail: number; base: number; phase?: string; roadmapPhase?: RoadmapPhaseKey;
  notes?: string[]; blocks: DayTask[]; progress: Record<string, number>; done?: Record<string, boolean>;
  subjects?: { id: ID; why: string[] }[]; generatedAt?: number };
/** What remains of a day's plan once the day is over (kept for 400 days). Older entries have only kind, min and status. */
export type PlanHistoryEntry = { date: DateKey; plannedMin: number; doneMin: number; studiedMin?: number; avail?: number; notes?: string[];
  tasks: { kind: TaskKind; min: number; status: TaskStatus; subjectId?: ID | null; lectureId?: ID | null;
    key?: string; title?: string; start?: ClockTime | null; end?: ClockTime | null; why?: string[]; locked?: boolean; manual?: boolean; fromDay?: DateKey; progressMin?: number }[] };

export type RoadmapPhaseKey = "foundation" | "coverage" | "practice" | "revision" | "final";
export type RoadmapPhase = { key: RoadmapPhaseKey; name: string; start: DateKey; end: DateKey; desc: string;
  mixKey: "early" | "middle" | "final" };
export type RoadmapBaseline = { at: number; examDate: DateKey;
  subjects: Record<ID, { start: DateKey | null; end: DateKey | null }>;
  lectures: Record<ID, DateKey>; coverageEnd: DateKey | null; requiredMin: number; availableMin: number };

/* ------------------------------------------------------------------ the core document (v2) */

export type Settings = Record<string, unknown> & { activeExamId: ID | null; dayStartHour: number;
  retention: number; minPerReview: number; dailyMin: number; avail: number | null; theme: string };
export type ActiveSession = Record<string, unknown> & { id: ID; startedAt: number };

export type CoreDoc = {
  v: 2; wsid: ID; settings: Settings; exams: Exam[]; nodes: SyllabusNode[];
  mem: Record<ID, MemoryRecord>; qmem: Record<ID, MemoryRecord>;
  lectures: Lecture[]; resources: Resource[];
  prep: PrepConfig; availability: StudyAvailability;
  roadmap: RoadmapBaseline | null;
  active: ActiveSession | null; plan: DailyPlan | null;
  dayPlans: Record<DateKey, DailyPlan>; planHistory: Record<DateKey, PlanHistoryEntry>;
  quarantine?: { collection: string; item: unknown; reason: string }[];
  createdAt: number; updatedAt: number;
};

/* ------------------------------------------------------------------ the portable preparation file */

export const SCHEMA_VERSION = 2;
export type PrepWorkspace = {
  schemaVersion: number;
  app: { name: string; format: "prep-workspace"; savedWith?: string };
  workspaceId: ID;
  createdAt: string; savedAt: string; updatedAt: number;
  exam: Exam | null;               // the active exam, for readers that only want one
  exams: Exam[];
  subjects: SyllabusNode[];        // subject nodes (also present in nodes), for easy reading
  nodes: SyllabusNode[];
  lectures: Lecture[]; resources: Resource[];
  prep: PrepConfig; availability: StudyAvailability;
  roadmap: RoadmapBaseline | null;
  plans: Record<DateKey, DailyPlan>;
  planHistory: Record<DateKey, PlanHistoryEntry>;
  sessions: StudySession[];
  reviews: RecallAttempt[];
  practiceAttempts: PracticeAttempt[];
  practiceQuestions: PracticeQuestion[];
  questionAttempts: QuestionAttempt[];
  mistakes: Mistake[];
  teachBacks: TeachBack[];
  recallPrompts: Record<ID, RecallPrompt[]>;
  conceptMemory: Record<ID, MemoryRecord>;
  questionMemory: Record<ID, MemoryRecord>;
  activeSession: ActiveSession | null;
  settings: Settings;
  deleted: { doc: string; id: ID; at: number; field?: string }[];
  /** Date of the plan that was "today's plan" when the file was saved. */
  currentPlan?: DateKey | null;
  quarantine: { collection: string; item: unknown; reason: string }[];
  /** Documents this version does not understand, kept so nothing is lost. */
  extra: Record<string, unknown>;
};

/** The browser's record of which preparation file is linked. The path is never known to the page. */
export type StorageMeta = { workspaceId: ID; fileName: string; linkedAt: number;
  lastSavedAt?: number; lastModified?: number; lastSize?: number };
export type SaveState = "idle" | "saving" | "saved" | "unsaved" | "unavailable" | "permission" | "failed"
  | "nofile" | "blocked";
