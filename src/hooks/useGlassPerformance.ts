import { useSyncExternalStore } from 'react';

import { useGlassManager } from '../context';
import type { GlassPerformanceMetrics } from '../types';

/** Diagnostics for dev screens. Re-renders the caller about twice a second. */
export function useGlassPerformance(): GlassPerformanceMetrics {
  const m = useGlassManager();
  return useSyncExternalStore(m.subscribeMetrics, m.getMetrics, m.getMetrics);
}
