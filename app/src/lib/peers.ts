import { useState } from 'react';

// docs/25: "remembering/managing paired peers... needed for a real UI but
// not designed here" — extended (still not the fully-designed feature
// that note flags — no rename/forget UI yet) to make a repeat sync with
// an already-known peer lighter: skipping the own-device/someone-else
// question the second time, since it's now remembered rather than
// re-asked.
export interface PairedPeer {
  id: string; // the peer's own getLocalUserId() — a stable identity, not
  // a throwaway per-sync id, so re-syncing with the same peer updates
  // this row instead of duplicating it.
  label: string;
  lastSyncedAt: string; // ISO timestamp
  identityMode: 'own-device' | 'someone-else';
}

const PEERS_KEY = 'piggypal:paired-peers';

// Local-device-only, same "pure client concern" reasoning as settings.ts —
// who this device has paired with is itself device-local bookkeeping, not
// data that goes through the sync/merge pipeline.
function readPeers(): PairedPeer[] {
  try {
    const raw = localStorage.getItem(PEERS_KEY);
    return raw ? (JSON.parse(raw) as PairedPeer[]) : [];
  } catch {
    return [];
  }
}

export function usePairedPeers(): [PairedPeer[], (peerLocalUserId: string, label: string, identityMode: PairedPeer['identityMode']) => void] {
  const [peers, setPeers] = useState<PairedPeer[]>(readPeers);

  // Upserts by the peer's real identity — a second sync with the same
  // peer updates their lastSyncedAt (and label, in case a device's
  // guessed name changed) in place rather than adding a duplicate row.
  function recordSync(peerLocalUserId: string, label: string, identityMode: PairedPeer['identityMode']) {
    const withoutThisPeer = peers.filter((p) => p.id !== peerLocalUserId);
    const next = [...withoutThisPeer, { id: peerLocalUserId, label, lastSyncedAt: new Date().toISOString(), identityMode }];
    localStorage.setItem(PEERS_KEY, JSON.stringify(next));
    setPeers(next);
  }

  return [peers, recordSync];
}
