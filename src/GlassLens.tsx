import React from 'react';
import { View } from 'react-native';

import { NativeMagnifierView } from './NativeGlassView';
import { useGlassCapabilities } from './hooks/useGlassCapabilities';
import type { GlassLensProps } from './types';

/** Hold the content to lift a clear glass lens that follows the finger and magnifies it. */
export function GlassLens({
  children,
  lensWidth = 96,
  lensHeight = 64,
  magnification = 1.4,
  lift = 0,
  disabled = false,
  ...rest
}: GlassLensProps) {
  const caps = useGlassCapabilities();

  if (!NativeMagnifierView || caps.quality === 'minimal') {
    return <View {...rest}>{children}</View>;
  }

  return (
    <NativeMagnifierView
      lensWidth={lensWidth}
      lensHeight={lensHeight}
      magnification={magnification}
      lift={lift}
      refraction={caps.refraction}
      disabled={disabled}
      {...rest}>
      {children}
    </NativeMagnifierView>
  );
}
