// UI state that has to outlive a card's position on the page. A card is rendered from a different parent when its
// verdict changes (the build queue, or one of the groups under "Everything else"), so React mounts a new instance;
// anything kept in the card's own useState (like "plan expanded") would be lost. It lives here, keyed by series key.
import { createContext, useContext } from 'react';

export type CardUi = {
  isOpen: (key: string) => boolean;
  setOpen: (key: string, open: boolean) => void;
};

export const CardUiContext = createContext<CardUi>({
  isOpen: () => false,
  setOpen: () => {},
});

export function useCardUi(): CardUi {
  return useContext(CardUiContext);
}
