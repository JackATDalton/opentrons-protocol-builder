/**
 * Lets the deck preview rearrange labware without every view threading
 * callbacks through. The App owns the placements per tool and feeds them back
 * into the deck config, so the generator — and therefore the downloaded
 * protocol — uses exactly the layout on screen.
 */
import { createContext, useContext } from "react";

export interface DeckPlacementApi {
  /** Replace the whole arrangement: assignment id -> slot. */
  setPlacements: (placements: Record<string, string>) => void;
  reset: () => void;
  /** True once the user has moved anything for this tool. */
  customised: boolean;
}

export const DeckPlacementContext = createContext<DeckPlacementApi | null>(null);

export function useDeckPlacement(): DeckPlacementApi | null {
  return useContext(DeckPlacementContext);
}
