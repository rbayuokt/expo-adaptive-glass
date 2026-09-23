import type { GlassQuality } from '@rbayuokt/expo-adaptive-glass';
import { createContext, useContext } from 'react';

// what the Settings tab edits, fed straight into GlassProvider
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface GlassSettingsValue {
  theme: ThemeChoice;
  quality: GlassQuality;
  clarity: number;
  adaptivePerformance: boolean;
  respectLowPowerMode: boolean;
  respectReduceTransparency: boolean;
}

export const DEFAULT_SETTINGS: GlassSettingsValue = {
  theme: 'system',
  quality: 'ultra',
  clarity: 1,
  adaptivePerformance: true,
  respectLowPowerMode: true,
  respectReduceTransparency: true,
};

export const GlassSettings = createContext<{
  settings: GlassSettingsValue;
  update: (patch: Partial<GlassSettingsValue>) => void;
}>({ settings: DEFAULT_SETTINGS, update: () => {} });

export const useGlassSettings = () => useContext(GlassSettings);
