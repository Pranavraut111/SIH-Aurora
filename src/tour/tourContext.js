/* Aurora — tour context: lets a page header offer "Tour this page". */
import { createContext, useContext } from 'react';

export const TourContext = createContext({ start: () => {}, active: false });

/** { start(kind), active }: kind is 'main' or a module id with a page tour. */
export const useTour = () => useContext(TourContext);
