import React from 'react';
import { View } from 'react-native';

import { NativeBackdropView } from './NativeGlassView';
import type { GlassBackdropProps } from './types';

// Android records this once per frame into a RenderNode every surface samples, so it has to be a
// sibling behind the surfaces, not their parent. On iOS it's a plain View.
export function GlassBackdrop(props: GlassBackdropProps) {
  if (NativeBackdropView) return <NativeBackdropView collapsable={false} {...props} />;
  return <View {...props} />;
}
