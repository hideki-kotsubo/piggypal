# 67 — Working with several Claude sessions in parallel

Written 2026-10-09 at the user's request.

## Why not two sessions in the same folder

Two sessions in `~/projects/flowtab` share one git checkout. When one
switches branches, the files change under the other, and edits end up on
the wrong branch. Each extra session gets its own **git worktree**: a
second checkout of the same repo, in its own folder, on its own branch,
sharing the same history.

## Procedure

Create a worktree (on the dev server, from the main checkout):

```bash
cd ~/projects/flowtab
git worktree add ../flowtab-<topic> -b <type>/<topic>
cd ../flowtab-<topic>
npm ci
```

`npm ci` gives the worktree its own `node_modules` and runs the root
postinstall (the Capacitor plugin link, docs/64).

Open `../flowtab-<topic>` as its own VS Code window and start the second
Claude session there. It reads this repo's `CLAUDE.md` like any session.

When the work is done, merge from the main checkout and remove the
worktree:

```bash
cd ~/projects/flowtab
git checkout main
git merge --no-ff <type>/<topic>
git worktree remove ../flowtab-<topic>
git branch -d <type>/<topic>
```

## Rules while sessions run in parallel

- **Dev servers** (:3001 app, :3002 api) run from the main checkout only.
  A worktree session that needs to preview must use other ports, and
  should ask the user first.
- **Doc numbers**: agree up front which session takes which number
  (e.g. this one 68, the other 69), or they'll both pick the next one.
- **Shared files** (`docs/00-backlog.md`, `CLAUDE.md`) will conflict on
  merge; the conflicts are two edits in different places, so resolve by
  keeping both.
- **One dev database**: both sessions use the same dev Postgres. Only one
  session at a time should add a migration (`db/migrations/`).
- **Releases** (`scripts/deploy-app.sh`, `scripts/deploy-api.sh`) run only
  from the main checkout, on `main`, after merging. Never from a worktree.
- **Good splits** are work that touches different files, e.g. api +
  database in one session, `website/` or a single screen in the other.
