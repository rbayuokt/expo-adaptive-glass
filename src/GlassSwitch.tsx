import React from 'react';
import { StyleSheet, Switch, processColor } from 'react-native';

import { NativeSwitchView } from './NativeGlassView';
import { useGlassCapabilities } from './hooks/useGlassCapabilities';
import type { GlassSwitchProps } from './types';

/** iOS 26 style switch: the thumb turns into a glass lens while pressed and dragged. */
export function GlassSwitch({
  value,
  onValueChange,
  disabled = false,
  onColor,
  style,
  ...rest
}: GlassSwitchProps) {
  const caps = useGlassCapabilities();
  const color = onColor ? processColor(onColor) : null;

  if (!NativeSwitchView) {
    return (
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: onColor }}
        style={style}
        {...rest}
      />
    );
  }

  return (
    <NativeSwitchView
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      style={[styles.size, style]}
      value={value}
      disabled={disabled}
      onColor={typeof color === 'number' ? color : null}
      lens={caps.quality !== 'minimal'}
      onValueChange={(e) => onValueChange?.(e.nativeEvent.value)}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  size: { width: 64, height: 28 },
});
