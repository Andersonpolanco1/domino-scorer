/**
 * Monetization layer — PLACEHOLDERS ready for real integration.
 *
 * ADS (Google AdMob):
 *   1. npm install react-native-google-mobile-ads
 *   2. Add your app IDs to app.json (see comments below)
 *   3. Replace the AdBanner placeholder in components/AdBanner.tsx
 *
 * IN-APP PURCHASES (Pro unlock + remove ads):
 *   1. npm install react-native-iap   (or expo-in-app-purchases)
 *   2. Configure products in App Store Connect + Google Play Console
 *   3. Wire purchaseProduct() / restorePurchases() below
 *
 * Product IDs to create in the stores:
 *   - "domino_pro_lifetime"   (non-consumable)  -> unlocks Pro
 *   - "domino_remove_ads"     (non-consumable)  -> removes ads
 */

export const PRODUCT_IDS = {
  pro: 'domino_pro_lifetime',
  removeAds: 'domino_remove_ads',
};

// AdMob unit IDs — replace with your real ones from AdMob console.
// These are Google's official TEST IDs (safe to ship while testing).
export const AD_UNITS = {
  banner_android: 'ca-app-pub-3940256099942544/6300978111',
  banner_ios: 'ca-app-pub-3940256099942544/2934735716',
};

// Placeholder purchase flow. Replace internals with react-native-iap.
export async function purchaseProduct(productId: string): Promise<boolean> {
  console.log('[IAP placeholder] purchase', productId);
  // TODO: integrate real IAP. For now simulate failure so nothing unlocks by accident.
  return false;
}

export async function restorePurchases(): Promise<string[]> {
  console.log('[IAP placeholder] restore');
  // TODO: return array of owned productIds from the store.
  return [];
}
