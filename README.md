# Logbook PrepOS

A personal preparation system for any exam. Tell it what you are preparing for, when the exam is, which subjects it
covers and how much time you have. It builds a roadmap to the exam date, checks whether the syllabus fits, and turns
it into a plan for each day: lectures, self-study, active recall, practice, revision and mistakes. Everything you do
feeds back into the plan.

Your progress is one JSON file on your own computer, ideally in the `progress` folder of this repository, pushed with
`npm run progress:push` (one commit per study day, no token). The app works offline, needs no account, and uses AI
only if you configure it.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Open the page and choose **Start a new preparation**. For a production build: `npm run build && npm start`.

With no sign-in configured, a production build runs entirely in the browser: no account, no server storage, only
your progress file and the browser's copy. Development mode (`npm run dev`) additionally syncs to `./.data`, which
is handy for testing account sync.

## The workflow

**Setup, plan, study, practise, review, adapt.**

1. **Setup wizard.** The first question is which exam you are preparing for. Then the exam date (the remaining days,
   weeks and months update as you type), optional time, location and preparation start date; how many subjects, each
   with importance, difficulty, an optional hour estimate, priority, colour, description, target date and
   prerequisite subjects; optionally topics and concepts per subject (an indented outline); whether you study on your
   own or follow lectures; lecture counts per subject; your study time (weekday and weekend minutes, time windows,
   sessions per day, shortest useful session, rest days and dates you cannot study); and how many subjects you want
   to study per day. The last step shows the roadmap phases and whether the work fits. The draft is kept in the
   browser, so a reload loses nothing.
2. **Today.** The countdown and the roadmap bar (preparation start to exam day, with phases, today, the syllabus
   target and the estimated finish), whether you are on track, what to do next, and today's tasks with times inside
   your study windows. Each task says why it was planned. Start a task and the timer is linked to its subject,
   concepts, lecture, plan task and questions.
3. **Plan.** The roadmap (phases, feasibility, the options for closing a shortfall, the normal and extra-effort
   plans, estimated work per subject), the next seven days, a calendar (click a date to mark it unavailable), a
   subject timeline, lecture pace and practice by subject.
4. **Study.** Lectures, reading, notes and practice with the timer; recall straight after. Concept memory uses an FSRS
   scheduler; the Review page brings each concept back just before you are likely to forget it.
5. **Practise.** Log individual questions with source, difficulty, answer and solution. Each question has its own
   spaced schedule, separate from the concept's memory. Wrong answers become mistakes with staged retries (1, 3, 7 and
   21 days). The review dashboard shows questions due, overdue, recently wrong, frequently failed, low confidence, not
   seen for 14 days, and concepts you recall well but apply badly.
6. **Adapt.** The plan is rebuilt from your real progress every day. Concepts with weak application get more
   practice; strong ones get less. Missed days do not stack onto today: the backlog is spread over the coming days.
   The weekly review compares planned and actual time, accuracy and subject balance, and sets next week's focus.

### Syllabus

A subject name alone is enough to plan with: subjects without topics are planned as whole-subject study (and
practice later in the roadmap). Add topics and concepts any time, or import them from **Subjects, Import syllabus**:
paste an indented outline or Markdown (a line with no indent is a subject, indented lines are topics, deeper lines
are concepts or subtopics) or JSON:

```json
{ "subjects": [ { "subject": "Mechanics", "importance": 3, "hours": 40,
    "topics": [ { "topic": "Kinematics", "concepts": ["Projectile motion", { "name": "Relative motion", "prereq": ["Projectile motion"] }] } ] } ] }
```

A preview shows what will be added. Existing subjects, topics and concepts with the same name are reused, never
duplicated. `examples/gate-electrical-syllabus.json` is a full example (the syllabus the original Logbook shipped
with).

### Lectures

In lecture mode, each subject gets numbered lectures (L01, L02 …, or L001 when there are 100 or more). Codes come
from position, and each lecture keeps a stable internal id, so renaming, inserting in the middle and reordering
renumber the codes while every link (sessions, tasks, concepts, resources) stays intact. Name them one by one or paste
all titles at once. A lecture is planned as watch, then self-study, then recall, then practice and spaced revision,
and counts as covered after watching plus self-study or recall, or when you mark it complete. The Lectures page shows
done, in progress, average length, pace, projected finish and how many lectures (and days) you are behind the
roadmap. Resources (lecture, video, YouTube, website, book, PDF, notes, question bank, mock test) can be attached to
lectures and concepts; links are stored as text and work offline.

### Roadmap and feasibility

Phases (foundation, coverage, practice, revision, final preparation) are sized from the time left: more than 180
days gets all five; 60 days or less compresses them; under three weeks keeps coverage, practice and final; the last
week is always final preparation. The workload estimate counts new concepts, lectures with self-study, practice,
expected reviews and mistake retries; your own hour estimate for a subject replaces the structure-based figure.
If it does not fit, the roadmap says how much time it requires, how much you have and how short you are, and offers
calculated options: more minutes a day, more on weekends, study on rest days, leave out low-importance content, a
lower practice target, important subjects first, or keep the schedule and accept incomplete coverage. You choose;
nothing is applied silently. **Re-plan from today** saves the current roadmap as the baseline that "behind" and
"ahead" are measured against. All of these figures are estimates and are labelled as such.

### Day plan

Subjects for the day are chosen by time-share deficit over the last 14 days, days since last studied, priority,
importance, prerequisites, target dates, pending lectures, weak practice and due reviews, within your subjects-per-day
limit, so they rotate through the week. Due reviews, saved questions and mistakes can mix subjects on any day. You can
complete, skip, resize, re-time, change the subject of, lock, move to another day, add and remove tasks; tasks you
touched are kept when the plan is regenerated.

## Your data: the progress file

Your progress lives in one JSON file on your computer, ideally inside this repository so git keeps it. The browser
keeps a copy only for offline use and recovery.

**Settings, Store progress** (also the save indicator at the bottom of the menu, or **More** on phones) has two
choices:

- **Create a new progress file:** choose a folder and a name, for example `progress/physics-finals-progress.json` in
  your local copy of this repository. The last setup step offers the same.
- **Link an existing progress file:** pick a progress `.json` you already have. It is loaded (merged if it is the
  same preparation, otherwise it replaces what is open, with a recovery copy kept). An empty file, for example one
  made with `touch progress/progress.json`, is linked and filled with your current progress.

After that:

- **Autosave:** every change (a task done or skipped, a session, a recall, a question, a lecture step, a mistake, a
  setting) is written about a second and a half later, and when you leave the page. The indicator shows *Saving*,
  *Saved*, *Unsaved changes*, *Permission required*, *File unavailable* or *Save failed*.
- **Reconnect:** the browser remembers the file between visits. After a browser restart it may ask for permission
  again: click **Reconnect file**. Your changes are safe in the browser copy meanwhile.
- **Safety:** a file that cannot be read (for example during a git merge conflict), or that now holds a different
  preparation, is never overwritten. If the file changed on disk while the app was open (for example after
  `git pull`), both versions are merged. Opening an uploaded copy of a different preparation unlinks the current
  file first.
- **Other browsers:** Chrome, Edge and other Chromium browsers write to the file directly. In Firefox and Safari use
  **Download a copy** (save it into the repository folder) and **Import**.
- **Privacy:** web pages are not told which folder a file is in, so the app shows only the file name. Nothing leaves
  your computer unless you use account sync or the AI features.

### What the file contains

Everything, in one document (`schemaVersion: 2`, see `lib/types.ts`):

- `overview`: exam and days left, total study time, study days, current streak, concepts recalled, lectures covered,
  question accuracy, open mistakes, last activity.
- `exam`, `exams`, `settings`, `prep` (how you prepare, subjects per day, planning assumptions, effort),
  `availability` (study time, windows, rest and unavailable days), `roadmap` (the saved baseline).
- `subjects` and `nodes` (the syllabus), `lectures`, `resources`.
- `sessions`, `reviews`, `practiceAttempts`, `practiceQuestions`, `questionAttempts`, `mistakes`, `teachBacks`,
  `recallPrompts`, `conceptMemory`, `questionMemory`, `activeSession` (a running timer).
- `plans` (today's plan and tasks you moved to later days), `planHistory` (every past day's plan with each task's
  title, time, status and reason), `deleted` (tombstones, so merges never bring deletions back), `quarantine`
  (anything unreadable, set aside rather than deleted).
- `days`: one readable record per study day: date and weekday, a one-line summary, days to the exam and the roadmap
  phase, time studied (by subject), planned and available time, every task with its time, status (done, skipped, not
  done) and reason, every session (time, subject, topic, concepts, mode, lecture, task, questions, notes), new
  concepts, recalls with grades, questions attempted with results, lecture steps, mistakes logged, retried and
  resolved, teach-backs, and the first and last activity time.

A study day starts at the hour set in Settings (4:00 by default), so late-night study counts for the day it belongs
to. `overview` and `days` are recalculated from the data on every save and ignored when the file is opened: edit in
the app, not in the file.

### Pushing to GitHub with git (no token)

At the end of the day, in a terminal in the repository folder:

```bash
npm run progress:push                 # commit each new or changed day, then git push
npm run progress:push -- --dry-run    # show what would be committed
npm run progress:push -- --no-push    # commit without pushing
npm run progress:push -- --dir other  # a different progress folder (default: progress)
```

The script (`scripts/progress-push.mjs`, no dependencies) writes `progress/days/YYYY-MM-DD.json` for each day in the
file, then commits every new or changed day **on its own, dated at that day's last activity**, then commits the
progress file, then runs `git push` with your normal git login (SSH key or credential helper). If you forget to push
for a day or two, each day still gets its own commit on its own date, so the history and GitHub's activity graph show
the work where it happened. Other changes in your working tree are left alone. If the push is rejected because the
remote has newer commits, run `git pull --rebase` and the script again.

Using two computers: `git pull` before opening the app, and push before switching.

### Moving from the older Logbook

Nothing needs converting by hand. **Open a file** or **Import** accepts a Logbook backup (`{ "app": "logbook",
"docs": … }`), the data files from the GitHub data repository (select `core.json`, `ses-*.json`, `rev-*.json` and the
others together) or a single `core.json`. Settings, exams, syllabus, memory, sessions, reviews, practice, mistakes,
teach-backs, prompts and plans carry over; daily time becomes weekday and weekend study time. A browser that already
held Logbook data from an account picks it up automatically in browser-only mode (as a copy). Invalid exam dates are
cleared with a warning rather than guessed. Files from a newer version are refused without being changed.

## Optional: account sync

Configure sign-in and the server keeps an additional copy, synced through `/api/docs` and `/api/sync`.

- **Storage:** a private GitHub repository (`GITHUB_TOKEN` with Contents read and write on that repository only,
  `GITHUB_REPO`, optionally `GITHUB_BRANCH` and `GITHUB_DATA_DIR`), or a server folder (`STORAGE=fs`, `DATA_DIR`).
  Files per user: `core.json`, `ses-YYYY-MM.json`, `rev-YYYY-MM.json`, `mis-YYYY-MM.json`, `tb-YYYY-MM.json`,
  `qs-YYYY-MM.json`, `pr-<subject>.json`. Each save names the version it was based on; conflicting copies are merged
  item by item, memory per concept or question, with deletions kept as tombstones. The token stays on the server.
- **Sign-in:** `APP_PASSWORD` for one person, or a GitHub OAuth app (`GITHUB_OAUTH_CLIENT_ID`,
  `GITHUB_OAUTH_CLIENT_SECRET`, `ALLOWED_GITHUB_USERS`, callback `https://<your-domain>/api/auth/callback`). Both need
  `SESSION_SECRET` (32+ random characters) in production. See `.env.example`.

The progress file remains the main copy either way.

## Optional: AI

Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`, `AI_REQUESTS_PER_10_MIN`) together with sign-in to enable
the coach, teach-back checks, recall-prompt drafting, "explain it simply" and reading free-text study logs. Prompts use
your exam's name, not a built-in exam. Everything else works without AI, and the coach still answers questions about
your own data on the device.

## Offline

After the first visit, a service worker (`public/sw.js`, production builds only) keeps the page and its code, so the
app opens without a connection. Your data is local already. Account sync and AI wait until you are online.

## Tests

```bash
npm test             # all unit tests (Vitest)
npm run typecheck
```

The tests cover dates and countdowns, lecture numbering and progress, syllabus import, the workspace format and v1
migration, the progress file controller (autosave, permissions, external changes, unreadable files, opening and
merging, empty files), the day-by-day records and the per-day git commits, roadmap phases, workload, feasibility and
forecasts, the day planner (subject selection, lectures, windows, locked tasks, missed days, subjects without topics),
question memory and practice signals, the engine, merging, the GitHub store and AI streaming.

## Project layout

```
app/                   Next.js App Router: page (browser-only or signed-in), login, API routes (docs, sync, ai, auth)
components/Logbook     the app shell; mounts the browser UI
client/ui.js           shell, timer, recall review, subjects, mistakes, history, insights, coach, settings, storage glue
client/setup-ui.js     welcome screen and setup wizard
client/plan-ui.js      today, plan and roadmap, weekly review, preparation settings, storage menu, syllabus import
client/study-ui.js     lectures, practice questions, question review
client/prep-ui.js      gathers the three modules above for ui.js
lib/types.ts           the data model (schema version 2)
lib/engine.js          FSRS memory, mastery, concept states, the core day mix, text parser (pure)
lib/roadmap.ts         capacity, phases, workload, feasibility, forecasts, subject order and timeline, weekly review
lib/dayplan.ts         the day planner: subjects per day, lecture pipeline, time windows, projections, missed days
lib/lectures.ts        lecture numbering, editing and progress
lib/practice.ts        question memory, attempts, review buckets, practice signals
lib/syllabus-import.ts outline and JSON syllabus import
lib/dates.ts           calendar dates, countdowns, time windows
lib/daylog.ts          the progress file's overview and day-by-day records
lib/workspace.ts       the progress file format, validation and migration from older data
lib/merge.js           merging two copies of the data
lib/storage/           local-file.ts (the progress file), github.ts and fs.ts (account sync)
lib/seed.js            Method page texts and the colour palette (no built-in exam)
examples/              an example syllabus to import
scripts/progress-push.mjs  commits progress to git one day at a time, then pushes (npm run progress:push)
progress/              where your progress file lives (see progress/HOW-TO.md)
tests/                 unit tests
```

UI modules render HTML strings and handle events by delegation (`data-a` actions, `data-c` fields); planning,
estimation and storage logic lives in `lib/` as pure functions with tests.

## Research and heuristics

The Method page lists the research each feature draws on (retrieval practice, spacing, successive relearning,
feedback, interleaving, self-explanation and others) separately from the product rules the app invents (mastery
weights, plan mix, roadmap phases, workload assumptions, subject rotation). The scheduler uses FSRS v4.5 formulas
with default weights, which were fitted on general flashcard users, not on you.
