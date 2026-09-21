import { useSyncExternalStore } from 'react';

import { useGlassManager } from '../context';
import type { GlassQualityState } from '../quality/GlassQualityManager';

/** Re-renders only when the tier or the downgrade reason changes. */
export function useGlassQuality(): GlassQualityState {
  const m = useGlassManager();
  return useSyncExternalStore(m.subscribeQuality, m.getQualityState, m.getQualityState);
}
