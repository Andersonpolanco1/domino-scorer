import { View, Text, StyleSheet } from 'react-native';
import { useGameStore } from '@/hooks/useGameStore';

/**
 * Ad banner PLACEHOLDER.
 * Renders a discreet bottom strip ONLY when the user is free and hasn't removed ads.
 * It never appears mid-game by design (user research showed pop-up ads kill ratings).
 *
 * To go live:
 *   import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
 *   import { AD_UNITS } from '@/hooks/useMonetization';
 *   return <BannerAd unitId={Platform.OS==='ios'?AD_UNITS.banner_ios:AD_UNITS.banner_android}
 *                    size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER} />;
 */
export default function AdBanner() {
  const { theme, isPro, adsRemoved } = useGameStore();
  if (isPro || adsRemoved) return null;

  const s = styles(theme);
  return (
    <View style={s.wrap}>
      <Text style={s.text}>Espacio publicitario</Text>
    </View>
  );
}

const styles = (t: any) => StyleSheet.create({
  wrap: { height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: t.cardAlt, borderTopWidth: 1, borderTopColor: t.border },
  text: { fontSize: 11, color: t.textSubtle, fontWeight: '500' },
});
