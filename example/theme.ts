import { useColorScheme } from 'react-native';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    text: dark ? '#f5f5f7' : '#111114',
    muted: dark ? 'rgba(245,245,247,0.6)' : 'rgba(17,17,20,0.55)',
    accent: '#5b5bf0',
  };
}
