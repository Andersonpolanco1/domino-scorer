import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { useGameStore } from '@/hooks/useGameStore';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { loadFromStorage, theme } = useGameStore();
  useEffect(() => { loadFromStorage().finally(() => SplashScreen.hideAsync()); }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} />
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
