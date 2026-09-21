import { useSyncExternalStore } from 'react';

import { useGlassManager } from '../context';
import type { GlassCapabilities } from '../types';

export function useGlassCapabilities(): GlassCapabilities {
  const m = useGlassManager();
  return useSyncExternalStore(m.subscribeQuality, m.getCapabilities, m.getCapabilities);
}
