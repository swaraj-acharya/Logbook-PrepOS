# Logbook

A study OS for competitive exams (GATE, ESE, PSU, RRB/SSC JE): a reliable study timer, active recall with adaptive
spaced review, a mistake notebook, a daily plan that fits the time you have, and analytics that separate time spent
from learning. Your data is stored as JSON files in a GitHub repository you control.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

With no configuration, development mode skips sign-in and stores data in `./.data`. To try GitHub storage locally,
copy `.env.example` to `.env.local` and fill in the GitHub settings.

## Set up GitHub storage

1. Create a **private** repository for data only, for example `yourname/logbook-data`. It can be empty; the app
   initialises it on first use.
2. Create a fine-grained personal access token (GitHub > Settings > Developer settings > Personal access tokens >
   Fine-grained tokens). Repository access: **only** the data repository. Permissions: **Contents: Read and write**.
3. Set `GITHUB_TOKEN`, `GITHUB_REPO` (owner/name), and optionally `GITHUB_BRANCH` (default `main`) and
   `GITHUB_DATA_DIR` (default `data`).

The token is used only on the server; the browser never sees it.

## Sign-in

Pick one:

- **Password, for one person.** Set `APP_PASSWORD`. Data goes to `data/users/me/`.
- **GitHub sign-in, for one or more people.** Create a GitHub OAuth App with the callback URL
  `https://<your-domain>/api/auth/callback`, then set `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` and
  `ALLOWED_GITHUB_USERS` (comma-separated usernames). Each person gets `data/users/gh-<github id>/`. Sign-in only asks
  for `read:user`; storage still uses the server token, so everyone allowed shares one data repository, in separate
  folders. Anyone with access to the repository can read every folder.

Both need `SESSION_SECRET` (32+ random characters) in production.

## AI features (optional)

Set `ANTHROPIC_API_KEY` to enable the coach, teach-back checks, recall-prompt drafting, "explain it simply" during
recovery, and reading free-text study logs. `ANTHROPIC_MODEL` defaults to `claude-sonnet-5`.
`AI_REQUESTS_PER_10_MIN` (default 40) caps requests per person. Without a key, everything else works and the coach
still answers data questions (time, plans, risk, mistakes) on the device.

## Deploy

Any Node host works. On Vercel: import the project, add the environment variables, deploy. The AI route streams and
allows up to 120 seconds.

## How storage works

```
data/users/<uid>/core.json          settings, exams, syllabus, review memory, running timer, today's plan
data/users/<uid>/ses-2026-09.json   sessions started in September 2026
data/users/<uid>/rev-2026-09.json   recall reviews and practice attempts
data/users/<uid>/mis-2026-09.json   mistakes
data/users/<uid>/tb-2026-09.json    teach-back explanations
data/users/<uid>/pr-<subject>.json  recall prompts for one subject
```

- **Browser first.** Every change is saved to the browser immediately, so the app opens instantly and keeps working
  offline. Changed files are sent to `/api/sync` in batches: a few seconds after timer starts and stops, about eight
  seconds after other edits, and when the tab is hidden.
- **One commit per batch.** The server writes all changed files in a single commit with the Git Data API (tree,
  commit, fast-forward branch update). If the branch moved in the meantime, the commit is rebuilt on the new head.
  A typical study day produces tens of commits, well under GitHub's content-creation limits.
- **No silent overwrites.** Each file is sent with the version (blob sha) the browser last saw. If another device
  changed it first, the server returns the newer copy instead of writing. The browser merges and saves again: sessions,
  reviews, practice and mistakes are merged item by item, review memory per concept, and deletions are kept as
  tombstones so they do not come back.
- **Caching.** File contents are cached on the server by blob sha, which never changes, so repeat loads cost a few
  API calls.
- **History.** Git keeps every version, so you can see or restore any past state of your data. It also means
  "Erase everything" removes the current files but not the history; to remove all traces, delete the repository or
  rewrite its history. The repository grows slowly over time; a fresh data repository each exam season is a simple
  way to reset it.

## Tests

```bash
npm test             # engine, merging, GitHub store (against an in-memory GitHub), AI streaming
npm run typecheck
```

For a full run against a fake GitHub API:

```bash
node tests/fake-github-server.js 4010 &
GITHUB_TOKEN=test-token GITHUB_REPO=me/logbook-data GITHUB_API_URL=http://127.0.0.1:4010 \
APP_PASSWORD=pw SESSION_SECRET=$(openssl rand -base64 48) npm run build && npm start
```

## Project layout

```
app/                 Next.js App Router: page, login, API routes (docs, sync, ai, auth)
components/Logbook   client component that provides the app shell and mounts the UI
client/ui.js         browser UI: views, dialogs, timer, review flow, analytics, coach
lib/engine.js        pure logic: FSRS-based scheduler, mastery, concept states, planner, text parser
lib/seed.js          GATE EE syllabus template, evidence table, method notes
lib/merge.js         merging two copies of a data file
lib/storage/         GitHub store, local-folder store, shared types
lib/session.ts       signed session cookie, sign-in modes
lib/ai.ts            Anthropic Messages API calls and streaming
lib/types.ts         data model types
tests/               unit tests and the fake GitHub API
```

The UI in `client/ui.js` renders HTML strings into the shell and handles events by delegation. It is the same code
as the tested single-file version, with storage and AI swapped for the server routes. Views can be moved into React
components one at a time without touching the engine or storage.

## Research and heuristics

The Method page in the app lists the research each feature draws on (retrieval practice, spacing, successive
relearning, feedback, interleaving, self-explanation and others) separately from product rules the app invents
(mastery weights, plan mix, roadmap order). The scheduler uses FSRS v4.5 formulas with default weights, which were
fitted on general flashcard users, not on you.
# Logbook-PrepOS
