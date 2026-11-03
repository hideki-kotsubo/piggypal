# Website analytics (Umami)

Visitor counts for the **website only** (`myflowtab.com`). The apps contain
no analytics, and the privacy policy says so; keep it that way unless the
policy and the App Store / Play privacy labels are updated first.

| | |
|---|---|
| Dashboard | https://stats.myflowtab.com |
| Runs on | the **prod server**, in `~/umami` (its own compose stack + Postgres) |
| Tracker script | `https://stats.myflowtab.com/insights.js` |
| Website ID | `095ba6af-b80e-4045-8b0c-d40cd0426bb4` |
| Set up | 2026-11-03 |

Why Umami: cookieless, no personal data, no consent banner, self-hosted —
fits the "simple, light, private" positioning. Google Analytics was ruled
out (cookies, consent banner, contradicts the privacy policy). Google Search
Console is fine to add alongside it (no script on the site).

All commands below run on the **prod server** unless stated otherwise.

## 1. DNS

A record `stats` → prod server IP (`stats.myflowtab.com`).

## 2. Create the stack

```bash
mkdir -p ~/umami && cd ~/umami
```

Secrets (only on first install — re-running this overwrites them and the
app loses access to its existing database):

```bash
cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 .env
```

```bash
cat > docker-compose.yaml <<'EOF'
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    container_name: umami
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://umami:${POSTGRES_PASSWORD}@umami-db:5432/umami
      DATABASE_TYPE: postgresql
      APP_SECRET: ${APP_SECRET}
      TRACKER_SCRIPT_NAME: insights.js
    depends_on:
      umami-db:
        condition: service_healthy
    networks:
      - internal
      - docker-stack_frontend

  umami-db:
    image: postgres:16-alpine
    container_name: umami-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U umami -d umami"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks:
      - internal

networks:
  internal:
  docker-stack_frontend:
    external: true
EOF
```

```bash
docker compose up -d
docker compose logs -f umami
```

Wait for it to report listening on port 3000, then Ctrl+C.

Notes:

- No ports are published: Umami is reached only through
  nginx-proxy-manager on `docker-stack_frontend` (same pattern as api /
  PowerSync). The database is on a private network. If the proxy network
  has another name on the server, check `docker network ls` and adjust.
- `TRACKER_SCRIPT_NAME: insights.js` — ad blockers block `umami.js`;
  the neutral name avoids undercounting. If you change it, change the
  script tag on the website too (step 5).
- Image tag: `postgresql-latest`. If a pull ever fails (Umami v3 changed
  tags), check https://github.com/umami-software/umami/releases and pin
  a version, e.g. `ghcr.io/umami-software/umami:3.0.1`.

## 3. Proxy host (nginx-proxy-manager)

- Domain: `stats.myflowtab.com`
- Forward: `http` → host `umami`, port `3000`
- Block Common Exploits: on · Websockets Support: on
- SSL: new Let's Encrypt certificate, Force SSL, HTTP/2

## 4. First login

1. Open https://stats.myflowtab.com, log in with `admin` / `umami`.
2. Change the password immediately (Settings → Profile).
3. Settings → Websites → Add website: name `Flowtab website`, domain
   `myflowtab.com`.
4. Edit → copy the Website ID. (Current one is in the table at the top.
   A reinstall with a fresh database gives a **new** ID — update step 5.)

## 5. Script tag on the website (repo, dev machine)

Already done in commit `9f39fe7`. For reference, this line sits right
before `</head>` in:

- `website/index.html`
- `website/privacy.html`
- `website/changelog.html`
- `scripts/build-changelog.mts` (template that generates changelog.html —
  without it, `npm run changelog` would drop the tag)

```html
<script defer src="https://stats.myflowtab.com/insights.js" data-website-id="095ba6af-b80e-4045-8b0c-d40cd0426bb4" data-domains="myflowtab.com"></script>
```

`data-domains` keeps staging and localhost visits out of the stats.

Any new website page needs the same line.

The privacy policy (`website/privacy.html`, "What we do not collect")
discloses website-only, self-hosted, cookieless analytics. If the
analytics setup ever changes, update that paragraph and the effective date.

## 6. Ship website changes to prod

The prod checkout sits on a detached release tag, so `git pull` fails
there ("You are not currently on a branch"). Use fetch + checkout instead.

Dev machine:

```bash
cd ~/projects/flowtab
git checkout main
git merge --no-ff <branch>
git push origin main
```

Prod server, in the Flowtab checkout:

```bash
git fetch --tags
git checkout <commit-or-tag>
```

nginx serves `website/` straight from the checkout — no rebuild or
restart. Only check out a plain commit when `main` has no unreleased
app/api changes beyond the current release tags (compare with
`git log app-vX.Y.Z..main` and `git log api-vX.Y.Z..main`); otherwise
wait for the next release tag, which includes the website change.

Check:

```bash
grep -c insights.js website/index.html
```

Should print `1`.

## 7. Verify tracking

1. Open https://myflowtab.com in a normal browser window (ad blocker off).
2. Umami → Websites → Flowtab website → Realtime: the visit shows up
   within seconds.

If not, open the browser dev tools → Network:

- `insights.js` fails to load → proxy host / SSL in nginx-proxy-manager.
- `insights.js` is 200 but `POST /api/send` fails → `cd ~/umami && docker compose logs umami`.

## 8. Backups

Test once by hand:

```bash
docker exec umami-db pg_dump -U umami umami | gzip > $HOME/umami/backup-test.sql.gz
ls -lh $HOME/umami/backup-test.sql.gz
zcat $HOME/umami/backup-test.sql.gz | head -20
rm $HOME/umami/backup-test.sql.gz
```

Expect a few KB or more and lines starting with `--` / `SET`.

Schedule daily at 03:00 (server time):

```bash
crontab -e
```

Pick nano if asked, add this as one line at the bottom, then Ctrl+O,
Enter, Ctrl+X:

```
0 3 * * * docker exec umami-db pg_dump -U umami umami | gzip > $HOME/umami/backup-$(date +\%a).sql.gz
```

Confirm with:

```bash
crontab -l
```

- Files are named by weekday (`backup-Mon.sql.gz` …), so the last 7 days
  are kept and each is overwritten a week later.
- The `\%` is required **only inside crontab** (cron treats a bare `%`
  as special). Don't use the backslash when running the command by hand.
- Backups live on the same server: they cover mistakes and corruption,
  not losing the server. Copy one off occasionally with `scp` if wanted.

Restore:

```bash
zcat $HOME/umami/backup-Mon.sql.gz | docker exec -i umami-db psql -U umami umami
```

## 9. Updating Umami

Back up first (step 8, manual command), then:

```bash
cd ~/umami
docker compose pull umami
docker compose up -d
docker compose logs -f umami
```

Rollback: put the previous image tag back in `docker-compose.yaml`,
`docker compose up -d`, and restore the backup if the database was
migrated.
