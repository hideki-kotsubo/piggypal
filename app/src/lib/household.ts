import { getLocalUserId } from './identity';
import { effectiveDeviceLabel } from './settings';
import type { PairedPeer } from './peers';

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

// D121's badge letter.
export function personInitial(label: string): string {
  return (label.trim()[0] ?? '?').toUpperCase();
}
