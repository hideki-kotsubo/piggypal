const LOCAL_USER_ID_KEY = 'piggypal:local-user-id';

// docs/05 D11: a client-generated user_id, created once on first launch and
// persisted locally — the identity that later doubles as the Postgres
// users.id on first sign-up, so there's no rekey on the common
// single-device-upgrade path. Never implemented until now because nothing
// needed it yet; docs/24's paid_by_user_id/created_by_user_id (transactions)
// and owner_user_id (accounts) are the first things that do, even before
// any server/household exists — a single local user is still "a user."
//
// Deliberately not settings.ts: that module is documented as "local-device
// preferences, never synced" (theme, picker mode). This value has the
// opposite trajectory — it's the identity that's meant to leave the device
// the moment sync/auth exists.
export function getLocalUserId(): string {
  let id = localStorage.getItem(LOCAL_USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LOCAL_USER_ID_KEY, id);
  }
  return id;
}

// docs/25 D126: "own device" pairing unifies identity by having the
// joining device adopt the other device's id, rather than keeping the one
// it generated on first launch. Also the mechanism `AuthVerifyScreen`'s
// "my own device" branch uses on sign-in (docs/46 D165) — every other read
// goes through getLocalUserId() above.
export function setLocalUserId(id: string): void {
  localStorage.setItem(LOCAL_USER_ID_KEY, id);
}

// docs/46 — a real bug found testing this for real: `resetLocalData()`
// wipes every local row but was never clearing this. A device that had
// ever adopted a real account's id (any earlier "Merge into my account")
// kept carrying that id across every subsequent reset — so a *reset*
// device's next sign-in saw `result.userId === getLocalUserId()` already
// true, treated it as "nothing to reconcile, already the same identity,"
// and skipped straight past both the household fork and the whole merge
// cascade, even though the fresh post-reset local data had never actually
// been reconciled with anything. `getLocalUserId()` regenerates a fresh
// random id on next access once this is cleared, matching what a
// genuinely new device would have — exactly what "reset" should mean.
export function clearLocalUserId(): void {
  localStorage.removeItem(LOCAL_USER_ID_KEY);
}

const DEVICE_ID_KEY = 'piggypal:device-id';

// docs/05 D12/D13: refresh tokens are tracked per (user, device), keyed by
// a client-generated device_id — a separate identity from the user id
// above, and deliberately never rewritten by the own-device pairing merge
// (setLocalUserId's case): two devices that just unified their *user*
// identity are still two distinct devices for refresh-token/revocation
// purposes. Flagged by docs/41 as the one piece nothing in app/ generated
// yet — everything else that endpoint needs already existed.
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// docs/48 D177 — superseded docs/46 D165/D166's own-device-vs-someone-else
// fork (and its DEVICE_ROLE_KEY "remembered, don't ask again" flag,
// removed): the fork generalizes into "pick your profile, or someone
// new," and "don't ask again" no longer needs a separate remembered flag
// at all — it falls out for free from checking whether getLocalUserId()
// already matches an existing profiles row (AuthVerifyScreen.tsx). A
// fresh getLocalUserId() (a genuinely new device, or one just reset via
// clearLocalUserId() below) naturally matches no profile and gets asked;
// one that already adopted or created a profile naturally doesn't.
