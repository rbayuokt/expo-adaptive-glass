import { Ionicons } from '@expo/vector-icons';
import { GlassGroup, GlassSurface } from 'expo-adaptive-glass';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Screen, Section } from '../components/Screen';
import { useTheme } from '../theme';

const ACTIONS = ['camera', 'image', 'mic'] as const;

function Action({
  icon,
  index,
  burst,
  open,
}: {
  icon: (typeof ACTIONS)[number];
  index: number;
  burst: SharedValue<number>;
  open: boolean;
}) {
  const theme = useTheme();
  const move = useAnimatedStyle(() => ({
    transform: [
      { translateX: burst.value * 72 * (index + 1) },
      { scale: interpolate(burst.value, [0, 1], [0.6, 1]) },
    ],
  }));
  // fade the icon, not the glass: iOS stops rendering glass under an animated opacity
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.35, 1], [0, 1, 1]),
  }));
  return (
    <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.action, move]}>
      <GlassSurface interactive cornerRadius={28} style={styles.small}>
        <Animated.View style={fade}>
          <Ionicons name={icon} size={22} color={theme.text} />
        </Animated.View>
      </GlassSurface>
    </Animated.View>
  );
}

export function MergeScreen() {
  const theme = useTheme();
  const drift = useSharedValue(0);
  const burst = useSharedValue(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    drift.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true
    );
    return () => cancelAnimation(drift);
  }, [drift]);
  const drifting = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(drift.value, [0, 1], [150, 0]) }],
  }));

  const toggle = () => {
    burst.value = withSpring(open ? 0 : 1, { dampingRatio: 1, duration: 450 });
    setOpen(!open);
  };

  return (
    <Screen
      title="Merge"
      subtitle="Glass inside a GlassGroup melts together when close and stretches apart when it separates.">
      <Section title="Join and split">
        <GlassGroup spacing={24} style={styles.stage}>
          <GlassSurface cornerRadius={40} style={styles.ball} />
          <Animated.View style={[styles.mover, drifting]}>
            <GlassSurface cornerRadius={40} style={styles.ball} />
          </Animated.View>
        </GlassGroup>
      </Section>

      <Section title="Drag">
        <GlassGroup spacing={24} style={styles.dragStage}>
          <GlassSurface cornerRadius={40} style={styles.ball} />
          <GlassSurface draggable cornerRadius={40} style={[styles.ball, styles.dragRight]} />
        </GlassGroup>
        <Text style={{ color: theme.muted }}>
          Drag the right circle into the left one. It springs back when you let go.
        </Text>
      </Section>

      <Section title="Detach">
        <GlassGroup spacing={22} style={styles.stage}>
          {ACTIONS.map((icon, i) => (
            <Action key={icon} icon={icon} index={i} burst={burst} open={open} />
          ))}
          <Pressable onPress={toggle} style={styles.action}>
            <GlassSurface interactive priority="high" cornerRadius={28} style={styles.small}>
              <Ionicons name={open ? 'close' : 'add'} size={26} color={theme.accent} />
            </GlassSurface>
          </Pressable>
        </GlassGroup>
        <Text style={{ color: theme.muted }}>
          Tap + to split the actions off; tap again to pull them back in.
        </Text>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: { height: 120, justifyContent: 'center' },
  dragStage: { height: 200, justifyContent: 'center' },
  ball: { width: 80, height: 80 },
  mover: { position: 'absolute', left: 0 },
  dragRight: { position: 'absolute', left: 170 },
  action: { position: 'absolute', left: 8 },
  small: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
