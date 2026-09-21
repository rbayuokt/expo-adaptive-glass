import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';

interface OverlayApi {
  set(key: string, node: ReactNode | null): void;
}

const OverlayContext = createContext<OverlayApi | null>(null);

export function useOverlay() {
  return useContext(OverlayContext);
}

/** Top layer for GlassMenu panels, so they draw over the app and take the taps. */
export function OverlayHost({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, ReactNode>>({});
  const set = useCallback((key: string, node: ReactNode | null) => {
    setEntries((prev) => {
      if (node == null) {
        if (!(key in prev)) return prev;
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: node };
    });
  }, []);
  const api = useMemo(() => ({ set }), [set]);
  const keys = Object.keys(entries);

  return (
    <OverlayContext.Provider value={api}>
      {children}
      {keys.length > 0 && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {keys.map((k) => (
            <React.Fragment key={k}>{entries[k]}</React.Fragment>
          ))}
        </View>
      )}
    </OverlayContext.Provider>
  );
}
