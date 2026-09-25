/* Data model for the files stored in the repository (documentation types; the UI is plain JS). */
export type ID = string;
export type StudyMode = "lecture" | "reading" | "notes" | "recall" | "practice"
  | "revision" | "mistakes" | "teachback" | "mock" | "mixed";
export type TimerStyle = "stopwatch" | "focus" | "pomodoro" | "deep" | "recall" | "practice" | "mock";

export type Exam = { id: ID; name: string; date?: string /* YYYY-MM-DD */; archived?: boolean };

// One tree for every exam: subject > topic > subtopic > concept.
// A subject can belong to several exams (canonical concepts, exam relevance per subject).
export type SyllabusNode = {
  id: ID; kind: "subject" | "topic" | "subtopic" | "concept"; parentId?: ID;
  name: string; order: number; archived?: boolean;
  examIds?: ID[]; color?: string; share?: number /* planned % */;
  imp?: 1 | 2 | 3 /* importance */; desc?: string;
  prereq?: ID[]; notes?: string; formula?: string;
  resources?: { id: ID; title: string; url?: string }[];
};

export type StudySession = {
  id: ID; examId?: ID;
  subjectId: ID | null /* null = mixed */; topicId?: ID; subtopicId?: ID; conceptIds: ID[];
  startedAt: number; endedAt: number;           // epoch ms; time derived from timestamps
  elapsedSec: number;                           // wall clock
  pausedSec: number; breakSec: number;          // manual pauses, scheduled breaks
  idleExcludedSec: number;                      // sleep/closed gaps you chose to exclude
  focusSec: number;                             // primary analytics value
  selfReportedSec?: number;                     // never overwrites focusSec
  split: { s: ID | null; t?: ID; u?: ID; c?: ID; sec: number }[]; // time attribution
  mode: StudyMode; timerStyle: TimerStyle; targetSec?: number;
  source: "timer" | "manual" | "imported"; edited?: boolean; originalFocusSec?: number;
  questionsSolved?: number; questionsCorrect?: number;
  confidenceBefore?: number; confidenceAfter?: number; focusRating?: number; difficultyRating?: number;
  notes?: string; understood?: string; difficult?: string; planBlock?: string;
  status: "completed" | "stopped" | "discarded";
};

export type MemoryRecord = {            // per concept
  S?: number; D?: number;        // stability (days), difficulty (1-10)
  last?: number; due: number; ivl?: number;
  reps: number; lapses: number; ok: number; fail: number;
  state: "new" | "review" | "relearning"; first?: number;
};

export type RecallAttempt = {           // review log
  id: ID; cid: ID; at: number; g: 1 | 2 | 3 | 4;   // Again, Hard, Good, Easy
  o?: "correct" | "partial" | "incorrect"; hint?: boolean;
  rt?: number /* sec */; cf?: number /* confidence 1-5 */;
  R?: number /* estimated recall before review */; S: number; ivl: number; mixed?: boolean;
};

export type PracticeAttempt = { id: ID; cid: ID; at: number; n: number; c: number;
  lv: "basic" | "standard" | "advanced" | "unfamiliar"; sessionId?: ID };

export type Mistake = { id: ID; cid?: ID; at: number; question: string;
  type: "concept" | "formula" | "calculation" | "unit" | "sign" | "misreading"
      | "reasoning" | "memory" | "time" | "careless" | "guess";
  why?: string; fix?: string; remember?: string; conf?: number;
  stage: 0 | 1 | 2 | 3; next: number; resolved?: boolean;
  retries: { at: number; ok: boolean; stage: number }[] };

export type RecallPrompt = { id: ID; kind: "free" | "formula" | "blank" | "explain" | "compare"
  | "diagram" | "application" | "problem"; q: string; a?: string };

export type TeachBack = { id: ID; cid: ID; at: number; text: string; score?: number;
  correct?: string[]; missing?: string[]; misconceptions?: string[]; next?: string };

export type DailyPlan = { date: string; avail: number; base: number;
  blocks: { key: string; kind: string; min: number; title: string; cids: ID[]; mids: ID[] }[];
  progress: Record<string, number> };
