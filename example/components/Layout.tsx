import { createContext, useContext } from 'react';

// room the top section bar takes on the Home tab, so screens can start below it
export const TopSpace = createContext(0);
export const useTopSpace = () => useContext(TopSpace);
