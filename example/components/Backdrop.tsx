import { LinearGradient } from 'expo-linear-gradient';
import { GlassBackdrop } from 'expo-adaptive-glass';
import React, { useEffect } from 'react';
import { StyleSheet, useColorScheme, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const BLOBS = [
  { color: ['#ff5f6d', '#ffc371'], x: -0.2, y: 0.05, size: 0.9 },
  { color: ['#36d1dc', '#5b86e5'], x: 0.45, y: 0.3, size: 0.8 },
  { color: ['#a18cd1', '#fbc2eb'], x: -0.1, y: 0.6, size: 0.85 },
  { color: ['#43e97b', '#38f9d7'], x: 0.5, y: 0.8, size: 0.7 },
] as const;

function Blob({
  blob,
  index,
  t,
  dark,
}: {
  blob: (typeof BLOBS)[number];
  index: number;
  t: SharedValue<number>;
  dark: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const size = blob.size * width;
  const dir = index % 2 ? -1 : 1;
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 0.5, 1], [0, dir * width * 0.25, 0]) },
      { rotate: `${t.value * dir * 40}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: blob.x * width,
          top: blob.y * height,
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          opacity: dark ? 0.75 : 0.9,
        },
        style,
      ]}>
      <LinearGradient
        colors={blob.color}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
    </Animated.View>
  );
}

// sibling behind the content, never around it: Android can't sample a backdrop a surface lives in
export function Backdrop({ animated = false }: { animated?: boolean }) {
  const dark = useColorScheme() === 'dark';
  const t = useSharedValue(0);

  useEffect(() => {
    if (!animated) return;
    t.value = withRepeat(
      withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.sin) }),
      -1,
      false
    );
    return () => cancelAnimation(t);
  }, [animated, t]);

  return (
    <GlassBackdrop
      style={[StyleSheet.absoluteFill, { backgroundColor: dark ? '#0b0b12' : '#f2f0f7' }]}>
      {BLOBS.map((b, i) => (
        <Blob key={i} blob={b} index={i} t={t} dark={dark} />
      ))}
    </GlassBackdrop>
  );
}
