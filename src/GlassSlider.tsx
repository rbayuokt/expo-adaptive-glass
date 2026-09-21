import React, { useRef } from 'react';
import { StyleSheet, processColor } from 'react-native';

import { NativeSliderView } from './NativeGlassView';
import { useGlassCapabilities } from './hooks/useGlassCapabilities';
import type { GlassSliderProps } from './types';

/** iOS 26 style slider: the thumb turns into a glass lens while it's held and dragged. */
export function GlassSlider({
  value,
  minimumValue = 0,
  maximumValue = 1,
  step = 0,
  onValueChange,
  onSlidingComplete,
  disabled = false,
  fillColor,
  style,
  ...rest
}: GlassSliderProps) {
  const caps = useGlassCapabilities();
  const color = fillColor ? processColor(fillColor) : null;
  const span = maximumValue - minimumValue || 1;
  // native drags in 0..1, onValueChange only fires when the stepped value changes
  const last = useRef(value);
  last.current = value;
  const toValue = (f: number) => {
    const v = minimumValue + f * span;
    const snapped = step > 0 ? Math.round((v - minimumValue) / step) * step + minimumValue : v;
    return Math.min(maximumValue, Math.max(minimumValue, snapped));
  };

  // no RN slider to fall back to
  if (!NativeSliderView) return null;

  return (
    <NativeSliderView
      accessibilityRole="adjustable"
      accessibilityValue={{ min: minimumValue, max: maximumValue, now: value }}
      style={[styles.size, style]}
      value={(value - minimumValue) / span}
      disabled={disabled}
      fillColor={typeof color === 'number' ? color : null}
      lens={caps.quality !== 'minimal'}
      onValueChange={(e) => {
        const v = toValue(e.nativeEvent.value);
        if (v !== last.current) {
          last.current = v;
          onValueChange?.(v);
        }
      }}
      onSlidingComplete={(e) => onSlidingComplete?.(toValue(e.nativeEvent.value))}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  size: { height: 44, alignSelf: 'stretch' },
});
