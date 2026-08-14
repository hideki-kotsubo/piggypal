import { useState } from 'react';

// docs/25: "remembering/managing paired peers... needed for a real UI but
// not designed here" — this is the minimum needed to render docs/27's
// frame 1/5 peer list, not the fully-designed feature that note flags.
// No rename/forget/manual-resync affordances yet.
export interface PairedPeer {
  id: string; // this device's own random id for the peer row, not a real identity
  label: string;
  lastSyncedAt: string; // ISO timestamp
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

export function usePairedPeers(): [PairedPeer[], (label: string) => void] {
  const [peers, setPeers] = useState<PairedPeer[]>(readPeers);

  function recordSync(label: string) {
    const next = [...peers, { id: crypto.randomUUID(), label, lastSyncedAt: new Date().toISOString() }];
    localStorage.setItem(PEERS_KEY, JSON.stringify(next));
    setPeers(next);
  }

  return [peers, recordSync];
}
