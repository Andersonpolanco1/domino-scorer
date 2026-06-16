import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGameStore } from '@/hooks/useGameStore';
import { t } from '@/constants/i18n';

export default function TabLayout() {
  const { theme, lang } = useGameStore();
  const insets = useSafeAreaInsets();
  const opts = (title: string, icon: any) => ({
    title,
    tabBarIcon: ({ color, size, focused }: any) => (<Ionicons name={focused ? icon : `${icon}-outline`} size={size - 2} color={color} />),
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.tabBar, borderTopColor: theme.border, borderTopWidth: 1,
          height: 58 + insets.bottom, paddingBottom: insets.bottom > 0 ? insets.bottom : 8, paddingTop: 8,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSubtle,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: 2 },
        tabBarIconStyle: { marginTop: 2 },
      }}
    >
      <Tabs.Screen name="index" options={opts(t(lang, 'scoreboard'), 'grid')} />
      <Tabs.Screen name="camera" options={opts(t(lang, 'camera'), 'scan')} />
      <Tabs.Screen name="history" options={opts(t(lang, 'tournaments'), 'trophy')} />
      <Tabs.Screen name="stats" options={opts(t(lang, 'stats'), 'stats-chart')} />
      <Tabs.Screen name="settings" options={opts(t(lang, 'settings'), 'settings')} />
    </Tabs>
  );
}
