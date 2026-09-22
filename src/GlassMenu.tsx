import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Modal,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';

import { GlassSurface } from './GlassSurface';
import { useOverlay } from './overlay';
import type { GlassMenuItem, GlassMenuProps } from './types';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Level {
  title?: string;
  items: GlassMenuItem[];
}

const MARGIN = 8;
const PANEL_RADIUS = 24;
const ROW_HEIGHT = 44;
const PANEL_PADDING = 6;
const ROW_INSET = 6;

/**
 * A round glass button that grows into a glass menu panel, like iOS 26. Items with `items`
 * open a submenu in the same panel, which resizes to fit.
 */
export function GlassMenu({
  trigger,
  items,
  size = 44,
  width = 250,
  tint = 'system',
  style,
  accessibilityLabel,
}: GlassMenuProps) {
  const overlay = useOverlay();
  const key = useId();
  const window = useWindowDimensions();
  const scheme = useColorScheme();
  const dark = tint === 'dark' || (tint !== 'light' && scheme === 'dark');
  const buttonRef = useRef<View>(null);

  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [stack, setStack] = useState<Level[]>([]);
  const [heights, setHeights] = useState<(number | undefined)[]>([]);
  // level the user asked for: 0 is the button, 1 the root menu, 2+ submenus
  const [level, setLevel] = useState(0);
  // what the glass shows, waits for the panel to be measured
  const [shown, setShown] = useState(0);
  // a long press opened the menu natively, the release that follows isn't a tap
  const longPressed = useRef(false);

  const open = useCallback(() => {
    buttonRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, width: w, height: h });
      setStack([{ items }]);
      setHeights([]);
      setShown(0);
      setLevel(1);
    });
  }, [items]);

  const reset = useCallback(() => {
    setAnchor(null);
    setStack([]);
    setHeights([]);
    setShown(0);
    setLevel(0);
  }, []);

  // the glass follows the level once its panel is measured
  const ready = level === 0 || heights[level - 1] !== undefined;
  if (anchor && ready && shown !== level) setShown(level);

  // closed before the glass left the button: no morph runs, so no end event will reset it
  const close = useCallback(() => (shown === 0 ? reset() : setLevel(0)), [shown, reset]);

  useEffect(() => {
    if (!anchor) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (level <= 1) close();
      else setLevel(level - 1);
      return true;
    });
    return () => sub.remove();
  }, [anchor, level, close]);

  const onMorphEnd = useCallback(
    (e: { nativeEvent: { index: number } }) => {
      const index = e.nativeEvent.index;
      if (index === 0 && level === 0) {
        reset();
      } else if (index > 0 && index === level) {
        // drop submenus we came back from
        setStack((s) => (s.length > index ? s.slice(0, index) : s));
        setHeights((h) => (h.length > index ? h.slice(0, index) : h));
      }
    },
    [level, reset]
  );

  const select = useCallback(
    (item: GlassMenuItem) => {
      if (item.items) {
        setStack((s) => [...s.slice(0, level), { title: item.label, items: item.items! }]);
        setLevel(level + 1);
        return;
      }
      close();
      item.onPress?.();
    },
    [level, close]
  );

  const measured = useCallback((i: number, e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setHeights((prev) => {
      if (prev[i] === h) return prev;
      const next = prev.slice();
      next[i] = h;
      return next;
    });
  }, []);

  // the panel opens from the button's corner nearest the screen's middle
  const panelRect = (i: number): Rect => {
    const a = anchor!;
    const h = heights[i] ?? 0;
    const right = a.x + a.width / 2 > window.width / 2;
    const bottom = a.y + a.height / 2 > window.height / 2;
    const x = right ? a.x + a.width - width : a.x;
    const y = bottom ? a.y + a.height - h : a.y;
    return {
      x: Math.min(Math.max(x, MARGIN), window.width - MARGIN - width),
      y: Math.min(Math.max(y, MARGIN), window.height - MARGIN - h),
      width,
      height: h,
    };
  };

  // what each row of level i does, the back row first in a submenu
  const actions = (i: number): (() => void)[] => {
    const l = stack[i];
    if (!l) return [];
    const back = i > 0 ? [() => setLevel(i)] : [];
    return [...back, ...l.items.map((item) => () => select(item))];
  };

  // rows have a fixed height, so the native side gets their rects without a measure pass
  const menuRows =
    anchor && shown > 0
      ? actions(shown - 1).map((_, j) => {
          const r = panelRect(shown - 1);
          return [
            r.x + ROW_INSET,
            r.y + PANEL_PADDING + j * ROW_HEIGHT,
            width - 2 * ROW_INSET,
            ROW_HEIGHT,
          ];
        })
      : [];

  const onMenuSelect = (e: { nativeEvent: { index: number } }) => {
    actions(shown - 1)[e.nativeEvent.index]?.();
  };

  const layer = anchor ? (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <GlassSurface
        priority="high"
        tint={tint}
        cornerRadius={PANEL_RADIUS}
        style={StyleSheet.absoluteFill}
        {...({
          glassOverlay: true,
          morphRect:
            shown === 0
              ? { ...anchor, radius: size / 2 }
              : { ...panelRect(shown - 1), radius: PANEL_RADIUS },
          morphIndex: shown,
          onMorphEnd,
          // the native view tracks the finger itself and draws the highlight
          menuRows,
          onMenuSelect,
          onMenuDismiss: close,
        } as object)}>
        <View pointerEvents="none" style={[styles.trigger, rectStyle(anchor)]}>
          {trigger}
        </View>
        {stack.map((l, i) => {
          const r = panelRect(i);
          return (
            <View
              key={i}
              pointerEvents="none"
              onLayout={(e) => measured(i, e)}
              style={[styles.panel, { left: r.x, top: r.y, width }]}>
              {i > 0 && (
                <Row
                  label={l.title ?? ''}
                  leading={
                    <Text style={[styles.chevron, { color: dark ? '#fff' : '#000' }]}>‹</Text>
                  }
                  dark={dark}
                  onActivate={() => setLevel(i)}
                  bold
                />
              )}
              {l.items.map((item, j) => (
                <Row
                  key={j}
                  label={item.label}
                  leading={item.icon}
                  trailing={
                    item.items ? (
                      <Text style={[styles.chevron, { color: dark ? '#fff' : '#000' }]}>›</Text>
                    ) : null
                  }
                  destructive={item.destructive}
                  dark={dark}
                  onActivate={() => select(item)}
                />
              ))}
            </View>
          );
        })}
      </GlassSurface>
    </View>
  ) : null;

  useLayoutEffect(() => {
    overlay?.set(key, layer);
  });
  useLayoutEffect(() => () => overlay?.set(key, null), [overlay, key]);

  return (
    <>
      <View
        ref={buttonRef}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: !!anchor }}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={open}
        // a tap opens, a long press is handled natively on the glass below
        onStartShouldSetResponder={() => true}
        onResponderGrant={() => {
          longPressed.current = false;
        }}
        onResponderRelease={() => {
          if (!longPressed.current && !anchor) open();
        }}
        style={[{ width: size, height: size, opacity: anchor ? 0 : 1 }, style]}>
        <GlassSurface
          interactive
          priority="high"
          tint={tint}
          cornerRadius={size / 2}
          style={[styles.button, { width: size, height: size }]}
          {...({
            // the same finger then drags through the list
            menuTrigger: true,
            onMenuLongPress: () => {
              longPressed.current = true;
              open();
            },
          } as object)}>
          {trigger}
        </GlassSurface>
      </View>
      {!overlay && anchor && (
        <Modal transparent visible animationType="none" onRequestClose={close}>
          {layer}
        </Modal>
      )}
    </>
  );
}

function Row({
  label,
  leading,
  trailing,
  destructive,
  dark,
  bold,
  onActivate,
}: {
  label: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  destructive?: boolean;
  dark: boolean;
  bold?: boolean;
  onActivate: () => void;
}) {
  const color = destructive ? '#ff3b30' : dark ? '#fff' : '#000';
  return (
    // touches go to the native menu, this only serves screen readers
    <View
      accessible
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={onActivate}
      style={styles.row}>
      {leading != null && <View style={styles.icon}>{leading}</View>}
      <Text numberOfLines={1} style={[styles.label, { color }, bold && styles.bold]}>
        {label}
      </Text>
      {trailing}
    </View>
  );
}

function rectStyle(r: Rect) {
  return { left: r.x, top: r.y, width: r.width, height: r.height };
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
  trigger: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  panel: { position: 'absolute', paddingVertical: PANEL_PADDING },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    marginHorizontal: ROW_INSET,
  },
  icon: { width: 22, alignItems: 'center' },
  label: { flex: 1, fontSize: 16, lineHeight: 21 },
  bold: { fontWeight: '600' },
  chevron: { fontSize: 22, lineHeight: 24, fontWeight: '300' },
});
