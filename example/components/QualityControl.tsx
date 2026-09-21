import type { GlassQuality } from 'expo-adaptive-glass';
import { createContext, useContext } from 'react';

export const QualityControl = createContext<{
  quality: GlassQuality;
  setQuality: (q: GlassQuality) => void;
}>({ quality: 'auto', setQuality: () => {} });

export const useQualityControl = () => useContext(QualityControl);
