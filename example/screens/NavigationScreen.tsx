import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, NavigationIndependentTree } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassNavigationTabBar, GlassScreenBackdrop } from '@rbayuokt/expo-adaptive-glass/navigation';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTopSpace } from '../components/Layout';
import { useTheme } from '../theme';

const Tab = createBottomTabNavigator();

const PALETTES = {
  Home: ['#ff5f6d', '#ffc371'],
  Search: ['#36d1dc', '#5b86e5'],
  Library: ['#a18cd1', '#fbc2eb'],
  Profile: ['#43e97b', '#38f9d7'],
} as const;

function Page({ name }: { name: keyof typeof PALETTES }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const top = insets.top + 16 + useTopSpace();
  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingTop: top }]}>
      <Text style={[styles.title, { color: theme.text }]}>{name}</Text>
      <Text style={{ color: theme.muted }}>
        A React Navigation bottom-tabs navigator with GlassNavigationTabBar. Scroll and the cards
        pass under the glass.
      </Text>
      {Array.from({ length: 12 }, (_, i) => (
        <LinearGradient
          key={i}
          colors={i % 2 ? PALETTES[name] : [PALETTES[name][1], PALETTES[name][0]]}
          style={styles.card}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      ))}
    </ScrollView>
  );
}

const ICONS = { Home: 'home', Search: 'search', Library: 'library', Profile: 'person' } as const;

export function NavigationScreen() {
  return (
    <View style={styles.fill}>
      <NavigationIndependentTree>
        <NavigationContainer>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarIcon: ({ color, size }) => (
                <Ionicons
                  name={ICONS[route.name as keyof typeof ICONS]}
                  color={color}
                  size={size}
                />
              ),
            })}
            // Android blurs only what's inside a GlassBackdrop
            screenLayout={({ children }) => <GlassScreenBackdrop>{children}</GlassScreenBackdrop>}
            tabBar={(props) => <GlassNavigationTabBar {...props} style={styles.bar} />}>
            {(Object.keys(PALETTES) as (keyof typeof PALETTES)[]).map((name) => (
              <Tab.Screen
                key={name}
                name={name}
                options={name === 'Library' ? { tabBarBadge: 3 } : undefined}>
                {() => <Page name={name} />}
              </Tab.Screen>
            ))}
          </Tab.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // lifted above the example's own tab bar
  bar: { bottom: 104 },
  page: { padding: 16, gap: 14, paddingBottom: 220 },
  title: { fontSize: 30, fontWeight: '800' },
  card: { height: 120, borderRadius: 20 },
});
