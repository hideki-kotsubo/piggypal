# 69 — "Sync now" button for cloud data sync

2026-10-13. Implemented the same day (`app/src/lib/syncNow.ts`, `db.ts`'s
`forceSync()`/`usePendingUploadCount()`, Settings' Account section).
Not yet run against a real PowerSync sync; see "Verification" below.

## The gap

Settings → Account → **Cloud sync** shows the connection status and has a
**Reconnect** button (`SettingsScreen.tsx`'s `handleReconnect`), but that
button only appears while the status is *not* "Connected". When the
status says "Connected" and the data still looks stale, for example
because a change from another device hasn't arrived or a local entry
seems stuck, the user can't do anything except reload the app. Nothing
on screen says when the last sync happened, or whether the device is
offline.

This is about **data sync** (PowerSync), not about updating the PWA or
service worker.

## What "force sync" can mean with PowerSync

The PowerSync SDK (`@powersync/common` 2.2) has no public "sync now" call.
Uploads start on their own when local writes happen. Downloads follow the
server's checkpoint stream. The only on-demand lever is to restart the
connection with `db.disconnect()` and then `db.connect(connector)`. That
does three things:

- calls `fetchCredentials()` again, so the device gets a fresh JWT;
- retries the pending upload queue right away (`uploadData`);
- opens a new stream and gets a fresh checkpoint from the server.

`handleReconnect()` already does this restart, and it also checks the
session first. When the session is dead (docs/68 D244), it drops the
user into the sign-in form instead.

SDK facts this plan relies on, checked in `node_modules`:

- `SyncStatus.lastSyncedAt` is **saved on the device**. At startup the SDK
  reads it back from local SQLite with
  `powersync_offline_sync_status()` (`BasePowerSyncDatabase.resolveOfflineSyncStatus`),
  so it is available offline and after a restart, and the app doesn't
  need its own storage for it. It changes when a download checkpoint
  completes. A finished upload alone doesn't change it.
- `SyncStatus.downloadProgress` (`downloadedOperations` /
  `totalOperations`) reports progress while a download is running.
- `db.getUploadQueueStats()` returns how many local changes are still
  waiting to upload.

## Plan

| # | Decision | Why |
|---|---|---|
| D245 | Add `forceSync()` to `app/src/lib/db.ts`. It records `currentStatus.lastSyncedAt`, runs disconnect then `connectSync()`, and resolves when a `statusChanged` event shows a newer `lastSyncedAt`. It uses an **idle timeout** (about 20s with no progress), not a fixed total: any change in `downloadProgress` or in the uploading/downloading flags restarts the timer. On timeout it resolves `'still-running'`, which is not an error. | The button can report a sync that actually finished. The connection isn't cancelled on timeout, so a big first download keeps going: picture a new device joining an account after a year of history. The user's answer on 2026-10-13 was that 15s probably works but isn't certain, so the deadline only applies while nothing is moving. |
| D246 | Settings' Cloud sync row shows a **Sync now** chip whenever the device is signed in and no sync is already running. The chip sits next to the existing Reconnect button. Both go through the same handler. That handler keeps `handleReconnect`'s dead-session check and then awaits `forceSync()`. | One code path. The dead-session handling from docs/68 still applies. |
| D247 | The button gives feedback. While it waits it reads "Syncing…", or "Downloading… 40%" when `downloadProgress` is set. A completed sync shows "Synced just now". If `uploadError` or `downloadError` is set, it shows a short error line. On the idle timeout it shows "Still syncing in the background". | The current Reconnect button was once reported as "does nothing" because it gave no feedback (see the comment above `handleReconnect`). A slow sync shouldn't look like a failed one. |
| D248 | **"You're offline"** shows **only to signed-in users** (`authAccount` set), in the Cloud sync status line. It replaces "Not connected" while `navigator.onLine` is false (tracked with `online`/`offline` events). While offline, Sync now is disabled with that reason shown. Local-only users never see it. | User's call, 2026-10-13: a local-only user isn't missing anything when offline. `navigator.onLine` can say "online" on a network with no internet; then the normal "Not connected" / error path covers it, so this message is only a clearer label for the obvious case. |
| D249 | **Last sync date and time** shows under the Cloud sync row for signed-in users: "Last synced today 14:32" or "Last synced 3 Oct, 09:10", formatted for the app's locale (docs/09). The source is `syncStatus.lastSyncedAt`, and the row shows "Never synced" before the first sync completes. It is always visible, not only after tapping Sync now. | User's request, 2026-10-13. The time is saved by the SDK and survives restarts and offline use, so it's a single read with no new storage. An absolute time is clearer than "X ago" for "did my phone get yesterday's changes?". |
| D250 | When changes are waiting to upload (`getUploadQueueStats().count > 0`), show the count. As built, it's its own row ("Waiting to upload · 3 changes") under "Last synced", because one combined line was too long at phone width. Refresh the count on status changes. | Confirmed by the user, 2026-10-13. It pairs naturally with D248 ("You're offline · 3 changes waiting to upload") and answers the other half of "is my data safe?". `lastSyncedAt` only covers downloads. |

Shape of the helper:

```ts
export type ForceSyncResult = 'synced' | 'still-running' | 'error';

export async function forceSync(idleMs = 20000): Promise<ForceSyncResult> {
  const before = db.currentStatus.lastSyncedAt?.getTime() ?? 0;
  await db.disconnect();
  await connectSync();
  return new Promise((resolve) => {
    let timer = setTimeout(done, idleMs, 'still-running');
    const off = db.registerListener({
      statusChanged: (s) => {
        if ((s.lastSyncedAt?.getTime() ?? 0) > before) return done('synced');
        if (s.dataFlowStatus.uploadError || s.dataFlowStatus.downloadError) return done('error');
        clearTimeout(timer);
        timer = setTimeout(done, idleMs, 'still-running');
      },
    });
    function done(r: ForceSyncResult) { clearTimeout(timer); off(); resolve(r); }
  });
}
```

## Out of scope

- **Retrying rejected rows.** The "N items didn't sync" line
  (`useSkippedSyncOps`, docs/46 D163) lists rows the server refused. A
  restart doesn't change those. Retrying or discarding them would be a
  separate feature.
- **Pull-to-refresh on Home.** It could call the same `forceSync()`
  later. The Settings button comes first.
- **Showing sync status on Home.** Home already has the docs/68 D244
  "Sync paused" banner. The offline line and last-sync time stay in
  Settings for now.
- **P2P pairing sync** (docs/25). That sync is a manual session already.

## Open questions

- Copy for the new strings, in pt-BR and English, once docs/09's UI
  translation pass covers Settings.

## As built

- One chip, three labels: "Sync now" when connected, "Reconnect" when
  not, "Sign in again" when the session is dead. One handler for all
  three (D246).
- Rows under Cloud sync, signed-in only: "Last synced" (hidden while the
  session is dead), "Waiting to upload" (only when > 0), and a "Sync" row
  after a tap that didn't end in a completed sync: "Still running in the
  background" or "Didn't finish, retrying". The raw SDK error is
  server JSON, so it goes in the row's tooltip, not the text.
- `.chip:disabled` styling added (none existed).
- Checked: 7 unit tests (`syncNow.test.ts`), full suite 127/127, `tsc`,
  `oxlint`. Headless Chromium at 390px against the dev server, with a
  faked sign-in and stubbed token endpoints: offline label + disabled
  chip, "never", the pending count, and the error row after a failed
  sync all render correctly. **Not checked:** a sync that actually
  completes ("Last synced just now"), and download progress. Both need a
  real signed-in account against a real PowerSync Service.

## Verification still to do

- Unit tests for `forceSync()` with a fake `db`:
  - it resolves `'synced'` when a newer `lastSyncedAt` arrives;
  - progress events keep it waiting past `idleMs`;
  - it resolves `'still-running'` when nothing moves for `idleMs`;
  - it resolves `'error'` on an upload or download error.
- Dev server: edit a row on device A, tap Sync now on device B, then see
  the change arrive and the "Last synced" time update.
- Offline: with DevTools network set to offline and the device signed
  in, the row shows "You're offline" and Sync now is disabled. When
  signed out, nothing new appears.
- Restart: reload the app offline. "Last synced" still shows the
  previous time.
- Large account: a fresh device signs in to an account with a lot of
  history. Progress shows, and the button never reports an error just
  because the download is slow.
- Native: the same checks on the iPhone build, because the docs/68
  refresh path runs there.
- Shipping: app release, then iOS and Android builds (no api change).
