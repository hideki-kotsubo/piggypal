import { getLocalUserId } from './identity';
import { usePairedPeers } from './peers';
import { effectiveDeviceLabel } from './settings';
import { useStore } from './store';
import type { PairedPeer } from './peers';
import type { Account, Transaction } from './types';

export interface HouseholdMember {
  userId: string;
  label: string;
  isYou: boolean;
}

// docs/26 D121-124: "household" here isn't docs/24's still-unbuilt
// households/household_members table — there's no server-side household
// concept yet, and household_id itself is deliberately still absent from
// the schema (docs/24, docs/25 notes). It's derived instead from who this
// device has actually P2P-synced with as a distinct person: peers.ts'
// 'someone-else' peers. 'own-device' peers are excluded on purpose — per
// docs/25 D125-127 they're the same person under a unified identity
// (adopted getLocalUserId()), never a second household member. This is
// enough to answer D110's "is there anyone to show this UI for" gate
// without the data model docs/24 hasn't built yet.
function otherMembers(peers: PairedPeer[]): PairedPeer[] {
  return peers.filter((p) => p.identityMode === 'someone-else');
}

export function hasHousehold(peers: PairedPeer[]): boolean {
  return otherMembers(peers).length > 0;
}

export function householdMembers(peers: PairedPeer[]): HouseholdMember[] {
  return [
    { userId: getLocalUserId(), label: effectiveDeviceLabel(), isYou: true },
    ...otherMembers(peers).map((p) => ({ userId: p.id, label: p.label, isYou: false })),
  ];
}

// Falls back to a generic label rather than a raw id/blank — can only
// happen for a user id that arrived via merge from a peer this device no
// longer has a peers.ts row for (e.g. its own record got cleared).
export function personLabel(userId: string, peers: PairedPeer[]): string {
  if (userId === getLocalUserId()) return effectiveDeviceLabel();
  return otherMembers(peers).find((p) => p.id === userId)?.label ?? 'Household member';
}

// docs/00-backlog 2026-08-29 — P2P pairing (docs/25) isn't the only way a
// second household member's data reaches this device: magic-link sign-in
// has its own "someone else" fork (AuthVerifyScreen.tsx, docs/46
// D165/D166) that deliberately keeps identity and accounts unmerged for
// that case, so a real second person's paid_by_user_id/created_by_user_id/
// owner_user_id values sync down distinct from this device's own. Scanning
// the actual data for owner ids this device didn't write covers ids from
// before docs/48's profiles table existed, or any id that's somehow never
// gotten a profile row — a real profiles entry (docs/48 D175) is always
// preferred once one exists (see useHouseholdPeers below).
function observedOtherUserIds(accounts: Account[], transactions: Transaction[]): string[] {
  const localId = getLocalUserId();
  const ids = new Set<string>();
  // store.transactions is `SELECT * FROM transactions` with no
  // deleted_at filter (store.tsx's own watch query) — a real bug found
  // testing this: an old, already-deleted duplicate transaction's payer/
  // logger id kept showing up as a "Household member" forever, even
  // after the account that created it was cleaned up. Archived accounts
  // get the same treatment for the same reason — neither is "currently
  // relevant," just still sitting in history.
  for (const a of accounts) {
    if (!a.archived && a.ownerUserId !== localId) ids.add(a.ownerUserId);
  }
  for (const t of transactions) {
    if (t.deletedAt) continue;
    if (t.paidByUserId !== localId) ids.add(t.paidByUserId);
    if (t.createdByUserId !== localId) ids.add(t.createdByUserId);
  }
  return [...ids];
}

// The combined view every household.ts consumer should use in place of a
// bare usePairedPeers() — real paired peers, plus every other profile
// (docs/48 D175, a real chosen name) and any other id merely observed in
// synced data (pre-docs/48 fallback), synthesized as PairedPeer-shaped
// entries. Precedence for the label, when more than one source knows the
// same id: a real docs/25 P2P-paired peer's name wins first (an actual
// handshake, not just data inference), then a profiles.display_name, then
// the generic "Household member" catch-all for an id nothing names yet.
// Deliberately NOT used by SettingsScreen's own "Paired devices" list,
// which is P2P pairing management specifically (re-sync, lastSyncedAt) —
// a synthesized entry has no real pairing session behind it to manage.
export function useHouseholdPeers(): PairedPeer[] {
  const [peers] = usePairedPeers();
  const store = useStore();
  const localId = getLocalUserId();
  const known = new Set(peers.map((p) => p.id));
  const profileNameById = new Map(store.profiles.map((p) => [p.id, p.displayName]));
  const otherIds = new Set([
    ...observedOtherUserIds(store.accounts, store.transactions),
    ...store.profiles.map((p) => p.id),
  ]);
  otherIds.delete(localId);
  const synthesized: PairedPeer[] = [...otherIds]
    .filter((id) => !known.has(id))
    .map((id) => ({
      id,
      label: profileNameById.get(id) ?? 'Household member',
      lastSyncedAt: '',
      identityMode: 'someone-else',
    }));
  return synthesized.length > 0 ? [...peers, ...synthesized] : peers;
}

// D121's badge letter.
export function personInitial(label: string): string {
  return (label.trim()[0] ?? '?').toUpperCase();
}
