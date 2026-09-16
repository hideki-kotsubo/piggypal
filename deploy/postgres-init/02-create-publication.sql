-- Required for PowerSync's logical replication — it does not create this
-- itself. Without it, PowerSync fails on startup with
-- "PSYNC_S1141: Publication 'powersync' does not exist" — a real problem
-- hit deploying this for the first time (see deploy/powersync/README.md's
-- "Real problems hit and fixed" #2). Runs automatically on first container
-- start via docker-entrypoint-initdb.d, right after 01-schema.sql (Postgres
-- runs init scripts in filename order, and only ever on an empty data
-- directory — this never re-runs against an existing volume).
create publication powersync for all tables;
