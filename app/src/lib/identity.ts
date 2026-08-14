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
