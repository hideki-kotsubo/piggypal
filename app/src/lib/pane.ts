import { createContext, useContext } from 'react';

// docs/80 — which pane a screen is rendered in (SplitLayout), and the
// Categories detail slot BottomSheet renders into (SlotSplit, D314).

export interface Pane {
  pane: 'list' | 'detail';
  // Where closing the detail pane goes (the list's own route).
  base: string;
}

export const PaneContext = createContext<Pane | null>(null);

// null when the screen has the whole window to itself (any phone, or a
// wide screen that isn't split).
export function usePane(): Pane | null {
  return useContext(PaneContext);
}

export const DetailSlotContext = createContext<HTMLElement | null>(null);

export function useDetailSlot(): HTMLElement | null {
  return useContext(DetailSlotContext);
}
