import React, { useEffect, useLayoutEffect, useState } from 'react';

import { GlassClarityContext, GlassContext, createGlassManager } from './context';
import { OverlayHost } from './overlay';
import type { ManagerOptions } from './quality/GlassQualityManager';
import type { GlassProviderProps } from './types';

export function GlassProvider({
  children,
  quality = 'auto',
  maxLiveSurfaces,
  adaptivePerformance = true,
  respectLowPowerMode = true,
  respectReduceTransparency = true,
  clarity = 0,
}: GlassProviderProps) {
  const options: ManagerOptions = {
    quality,
    maxLiveSurfaces: maxLiveSurfaces ?? Infinity,
    adaptivePerformance,
    respectLowPowerMode,
    respectReduceTransparency,
  };
  const [manager] = useState(() => {
    const m = createGlassManager();
    m.setOptions(options);
    return m;
  });

  useLayoutEffect(() => {
    manager.setOptions(options);
  }, [
    manager,
    quality,
    maxLiveSurfaces,
    adaptivePerformance,
    respectLowPowerMode,
    respectReduceTransparency,
  ]);

  useEffect(() => {
    manager.attach();
    return () => manager.dispose();
  }, [manager]);

  return (
    <GlassContext.Provider value={manager}>
      <GlassClarityContext.Provider value={Math.max(0, Math.min(1, clarity))}>
        <OverlayHost>{children}</OverlayHost>
      </GlassClarityContext.Provider>
    </GlassContext.Provider>
  );
}
