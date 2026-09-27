# Progress

This folder holds your Logbook PrepOS progress, so it is kept in git with the rest of the repository.

1. In the app, open **Settings, Store progress** and choose **Create a new progress file** (save it in this folder,
   for example `progress/physics-finals-progress.json`) or **Link an existing progress file** (any `.json` here, even an
   empty one made with `touch progress/progress.json`).
2. Study as usual. Every change is written to the file within a couple of seconds: the full preparation (syllabus,
   lectures, memory, sessions, questions, mistakes, plans) plus an `overview` and a readable record for each study
   day under `days`.
3. At the end of the day, from the repository folder:

   ```bash
   npm run progress:push
   ```

   This writes `progress/days/YYYY-MM-DD.json` for each day, commits every new or changed day **separately, dated
   that day**, commits the progress file, and runs `git push` with your own git login. No GitHub token is needed.
   If you forget to push for a day or two, each day still gets its own commit on its own date.
   Use `-- --dry-run` to see what would be committed, or `-- --no-push` to commit without pushing.

Working on two computers: run `git pull` before you open the app, and push before you switch. If the file changes on
disk while the app is open, the app merges both versions instead of overwriting.

The files in `days/` are generated; edit your progress in the app, not by hand.
