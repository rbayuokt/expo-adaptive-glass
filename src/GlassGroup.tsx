import React from 'react';
import { View } from 'react-native';

import { parseTint } from './GlassSurface';
import { clearer, useGlassClarity } from './context';
import { NativeGroupView } from './NativeGlassView';
import type { GlassGroupProps } from './types';

/** Surfaces inside, at any depth, merge when they come within `spacing` of each other. */
export function GlassGroup({
  children,
  spacing = 20,
  tint = 'system',
  intensity = 0.6,
  ...rest
}: GlassGroupProps) {
  const clarity = useGlassClarity();
  const { tintScheme, tintColor } = parseTint(tint);
  if (!NativeGroupView) return <View {...rest}>{children}</View>;
  return (
    <NativeGroupView
      collapsable={false}
      spacing={spacing}
      intensity={clearer(intensity, clarity)}
      tintColor={tintColor}
      tintScheme={tintScheme}
      {...rest}>
      {children}
    </NativeGroupView>
  );
}
