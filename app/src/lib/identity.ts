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
// it generated on first launch. This is the only place that value is
// meant to change after the fact — every other read goes through
// getLocalUserId() above.
export function setLocalUserId(id: string): void {
  localStorage.setItem(LOCAL_USER_ID_KEY, id);
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

const DEVICE_ROLE_KEY = 'piggypal:device-role';
export type DeviceRole = 'own' | 'someone-else';

// docs/46 D165/D166 — mirrors docs/25 D125-127's own-device-vs-someone-
// else fork for P2P pairing, now added to sign-in too: whether *this
// device* signing into an already-used account is the same person's own
// second device (identity unifies via getLocalUserId adopting the
// account's id) or a different household member (identity stays
// distinct). Remembered per device once answered (D166, same "known
// peer skips the question" UX docs/25 D138-139 already shipped) so a
// repeat sign-in on the same device doesn't ask again.
export function getDeviceRole(): DeviceRole | null {
  return localStorage.getItem(DEVICE_ROLE_KEY) as DeviceRole | null;
}

export function setDeviceRole(role: DeviceRole): void {
  localStorage.setItem(DEVICE_ROLE_KEY, role);
}

export function clearDeviceRole(): void {
  localStorage.removeItem(DEVICE_ROLE_KEY);
}
