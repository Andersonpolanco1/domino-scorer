import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, Modal, Switch } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useGameStore } from '@/hooks/useGameStore';
import { THEMES } from '@/constants/themes';
import { t } from '@/constants/i18n';
import { purchaseProduct, restorePurchases, PRODUCT_IDS } from '@/hooks/useMonetization';
import { exportBackupFile, importBackupFile } from '@/utils/backup';
import { hasGeminiApiKey } from '@/utils/geminiDetection';
import AdBanner from '@/components/AdBanner';

/**
 * Una fila de calibración: etiqueta + valor actual + botones -/+.
 * Declarativo en vez de 13 bloques de JSX casi idénticos a mano — cada
 * campo numérico de `Calibration` (useGameStore.ts) se describe una vez
 * (paso, decimales, rango) y se renderiza con esto.
 */
function CalRow({
  theme, label, value, step, decimals = 0, min, max, onChange,
}: {
  theme: any; label: string; value: number; step: number; decimals?: number;
  min: number; max: number; onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const round = (v: number) => {
    // Evita el clásico "0.1 + 0.2 = 0.30000000000000004" de floats al
    // acumular pasos pequeños (0.05) muchas veces.
    const factor = Math.pow(10, decimals);
    return Math.round(v * factor) / factor;
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
      <Text style={{ flex: 1, fontSize: 13, color: theme.textMuted }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TouchableOpacity
          style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardAlt, alignItems: 'center', justifyContent: 'center' }}
          onPress={() => onChange(clamp(round(value - step)))}
        >
          <Ionicons name="remove" size={14} color={theme.text} />
        </TouchableOpacity>
        <Text style={{ fontSize: 14, fontWeight: '700', color: theme.text, minWidth: 44, textAlign: 'center' }}>
          {value.toFixed(decimals)}
        </Text>
        <TouchableOpacity
          style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardAlt, alignItems: 'center', justifyContent: 'center' }}
          onPress={() => onChange(clamp(round(value + step)))}
        >
          <Ionicons name="add" size={14} color={theme.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const { theme, themeIndex, names, target, lang, isPro, adsRemoved,
          capicuaEnabled, capicuaPoints, paseEnabled, pasePoints, detectionMode, calibration,
          setName, setTarget, setTheme, setLang, setPro, setAdsRemoved, setCapicua, setPase, setDetectionMode,
          setQualityCalibrationValue, setMinTileRectHeightPx, resetCalibration, archiveAndReset,
          exportBackup, importBackup } = useGameStore();
  const [showPro, setShowPro] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const geminiAvailable = hasGeminiApiKey();
  const s = styles(theme);

  const handleReset = () => {
    Alert.alert(t(lang, 'resetConfirmTitle'), t(lang, 'resetConfirmMsg'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      { text: t(lang, 'reset'), style: 'destructive', onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); archiveAndReset('reset', null); } },
    ]);
  };

  const doExportBackup = async () => {
    const snapshot = exportBackup();
    await exportBackupFile(snapshot);
  };

  const doImportBackup = async () => {
    const data = await importBackupFile();
    if (data === null) return; // user cancelled or read error (silent)
    Alert.alert(t(lang, 'importConfirmTitle'), t(lang, 'importConfirmMsg'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      { text: t(lang, 'importBackup'), onPress: () => {
        const ok = importBackup(data);
        Alert.alert('', ok ? t(lang, 'importOk') : t(lang, 'importFail'));
      }},
    ]);
  };

  const selectTheme = (i: number) => {
    if (THEMES[i].pro && !isPro) { setShowPro(true); return; }
    Haptics.selectionAsync(); setTheme(i);
  };

  const doPurchasePro = async () => {
    const ok = await purchaseProduct(PRODUCT_IDS.pro);
    if (ok) { setPro(true); setAdsRemoved(true); setShowPro(false); }
    else Alert.alert(t(lang, 'pro'), 'Compras en proceso de configuración. (Placeholder)');
  };
  const doRemoveAds = async () => {
    const ok = await purchaseProduct(PRODUCT_IDS.removeAds);
    if (ok) setAdsRemoved(true);
    else Alert.alert(t(lang, 'removeAds'), 'Compras en proceso de configuración. (Placeholder)');
  };
  const doRestore = async () => {
    const owned = await restorePurchases();
    if (owned.includes(PRODUCT_IDS.pro)) { setPro(true); setAdsRemoved(true); }
    if (owned.includes(PRODUCT_IDS.removeAds)) setAdsRemoved(true);
  };

  const adjustPts = (current: number, delta: number) => Math.max(0, Math.min(200, current + delta));

  const selectDetectionMode = (mode: 'local' | 'gemini') => {
    if (mode === 'gemini' && !geminiAvailable) {
      Alert.alert(t(lang, 'detectionModeGemini'), t(lang, 'detectionModeGeminiNoKeyHint'));
      return;
    }
    Haptics.selectionAsync();
    setDetectionMode(mode);
  };

  const handleResetCalibration = () => {
    Alert.alert(t(lang, 'calResetConfirmTitle'), t(lang, 'calResetConfirmMsg'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      { text: t(lang, 'calReset'), style: 'destructive', onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); resetCalibration(); } },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.pageTitle}>{t(lang, 'settings')}</Text>

        {!isPro && (
          <TouchableOpacity style={s.proBanner} onPress={() => setShowPro(true)} activeOpacity={0.85}>
            <View style={s.proIcon}><Ionicons name="star" size={18} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.proTitle}>{t(lang, 'unlockPro')}</Text>
              <Text style={s.proSub} numberOfLines={2}>{t(lang, 'proDesc')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.accent} />
          </TouchableOpacity>
        )}

        {/* Teams */}
        <Text style={s.sectionLabel}>{t(lang, 'teams').toUpperCase()}</Text>
        <View style={s.card}>
          {[0, 1].map(i => (
            <View key={i} style={[s.row, i > 0 && s.divider]}>
              <View style={[s.dot, { backgroundColor: i === 0 ? theme.team1 : theme.team2 }]} />
              <Text style={s.rowLabel}>{t(lang, 'teams')} {i + 1}</Text>
              <TextInput style={s.input} value={names[i]} onChangeText={v => setName(i as 0 | 1, v)} maxLength={15} placeholderTextColor={theme.textSubtle} />
            </View>
          ))}
        </View>

        {/* Target */}
        <Text style={s.sectionLabel}>{t(lang, 'pointsToWin').toUpperCase()}</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={[s.rowLabel, { flex: 1 }]}>{t(lang, 'pointsToWin')}</Text>
            <View style={s.stepper}>
              <TouchableOpacity style={s.stepBtn} onPress={() => setTarget(Math.max(50, target - 50))}><Ionicons name="remove" size={16} color={theme.text} /></TouchableOpacity>
              <Text style={s.stepVal}>{target}</Text>
              <TouchableOpacity style={s.stepBtn} onPress={() => setTarget(Math.min(1000, target + 50))}><Ionicons name="add" size={16} color={theme.text} /></TouchableOpacity>
            </View>
          </View>
          <View style={s.presetRow}>
            {[100, 150, 200, 300].map(v => (
              <TouchableOpacity key={v} style={[s.preset, target === v && { backgroundColor: theme.accent, borderColor: theme.accent }]} onPress={() => setTarget(v)}>
                <Text style={[s.presetTxt, { color: target === v ? '#fff' : theme.textMuted }]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Special plays */}
        <Text style={s.sectionLabel}>{t(lang, 'specialPlays').toUpperCase()}</Text>
        <View style={s.card}>
          {/* Capicúa */}
          <View style={s.specialBlock}>
            <View style={s.specialHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>{t(lang, 'capicua')}</Text>
                <Text style={s.specialDesc}>{t(lang, 'capicuaDesc')}</Text>
              </View>
              <Switch value={capicuaEnabled} onValueChange={v => setCapicua(v)} trackColor={{ true: theme.accent, false: theme.borderStrong }} thumbColor="#fff" />
            </View>
            {capicuaEnabled && (
              <View style={s.ptsConfig}>
                <Text style={s.ptsConfigLabel}>{t(lang, 'pointValue')}</Text>
                <View style={s.stepper}>
                  <TouchableOpacity style={s.stepBtn} onPress={() => setCapicua(true, adjustPts(capicuaPoints, -5))}><Ionicons name="remove" size={15} color={theme.text} /></TouchableOpacity>
                  <Text style={s.stepVal}>{capicuaPoints}</Text>
                  <TouchableOpacity style={s.stepBtn} onPress={() => setCapicua(true, adjustPts(capicuaPoints, 5))}><Ionicons name="add" size={15} color={theme.text} /></TouchableOpacity>
                </View>
              </View>
            )}
          </View>
          <View style={s.divider} />
          {/* Pase corrido */}
          <View style={s.specialBlock}>
            <View style={s.specialHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowLabel}>{t(lang, 'pase')}</Text>
                <Text style={s.specialDesc}>{t(lang, 'paseDesc')}</Text>
              </View>
              <Switch value={paseEnabled} onValueChange={v => setPase(v)} trackColor={{ true: theme.accent, false: theme.borderStrong }} thumbColor="#fff" />
            </View>
            {paseEnabled && (
              <View style={s.ptsConfig}>
                <Text style={s.ptsConfigLabel}>{t(lang, 'pointValue')}</Text>
                <View style={s.stepper}>
                  <TouchableOpacity style={s.stepBtn} onPress={() => setPase(true, adjustPts(pasePoints, -5))}><Ionicons name="remove" size={15} color={theme.text} /></TouchableOpacity>
                  <Text style={s.stepVal}>{pasePoints}</Text>
                  <TouchableOpacity style={s.stepBtn} onPress={() => setPase(true, adjustPts(pasePoints, 5))}><Ionicons name="add" size={15} color={theme.text} /></TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Language */}
        <Text style={s.sectionLabel}>{t(lang, 'language').toUpperCase()}</Text>
        <View style={s.card}>
          <View style={s.segRow}>
            <TouchableOpacity style={[s.seg, lang === 'es' && s.segActive]} onPress={() => setLang('es')}><Text style={[s.segTxt, lang === 'es' && s.segTxtActive]}>Español</Text></TouchableOpacity>
            <TouchableOpacity style={[s.seg, lang === 'en' && s.segActive]} onPress={() => setLang('en')}><Text style={[s.segTxt, lang === 'en' && s.segTxtActive]}>English</Text></TouchableOpacity>
          </View>
        </View>

        {/* Detection mode — TEMPORAL, solo desarrollo. Ver detectionModeDesc. */}
        <Text style={s.sectionLabel}>{t(lang, 'detectionModeSection').toUpperCase()}</Text>
        <View style={s.card}>
          <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
            <Text style={s.specialDesc}>{t(lang, 'detectionModeDesc')}</Text>
          </View>
          <View style={s.segRow}>
            <TouchableOpacity style={[s.seg, detectionMode === 'local' && s.segActive]} onPress={() => selectDetectionMode('local')}>
              <Text style={[s.segTxt, detectionMode === 'local' && s.segTxtActive]}>{t(lang, 'detectionModeLocal')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.seg, detectionMode === 'gemini' && s.segActive, !geminiAvailable && { opacity: 0.5 }]} onPress={() => selectDetectionMode('gemini')}>
              <Text style={[s.segTxt, detectionMode === 'gemini' && s.segTxtActive]}>{t(lang, 'detectionModeGemini')}</Text>
            </TouchableOpacity>
          </View>
          {!geminiAvailable && (
            <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
              <Text style={[s.specialDesc, { color: theme.team2 }]}>{t(lang, 'detectionModeGeminiNoKeyHint')}</Text>
            </View>
          )}
        </View>

        {/* Calibración de captura — TEMPORAL, solo desarrollo. Colapsada
            por defecto: son 13 valores técnicos que no le interesan a un
            usuario normal, solo a quien está calibrando en campo. */}
        <Text style={s.sectionLabel}>{t(lang, 'calSection').toUpperCase()}</Text>
        <View style={s.card}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 }}
            onPress={() => { Haptics.selectionAsync(); setShowCalibration(v => !v); }}
          >
            <Text style={[s.rowLabel, { flex: 1 }]}>{t(lang, showCalibration ? 'calHide' : 'calShow')}</Text>
            <Ionicons name={showCalibration ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textMuted} />
          </TouchableOpacity>

          {showCalibration && (
            <>
              <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
                <Text style={s.specialDesc}>{t(lang, 'calIntro')}</Text>
              </View>

              <View style={s.divider} />
              <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 }}>
                <Text style={[s.rowLabel, { marginBottom: 2 }]}>{t(lang, 'calLocalProfile')}</Text>
                <Text style={s.specialDesc}>{t(lang, 'calLocalProfileDesc')}</Text>
              </View>
              <CalRow theme={theme} label={t(lang, 'calMinBrightness')} value={calibration.local.minMeanBrightness} step={5} min={0} max={255} onChange={v => setQualityCalibrationValue('local', 'minMeanBrightness', v)} />
              <CalRow theme={theme} label={t(lang, 'calMaxBrightness')} value={calibration.local.maxMeanBrightness} step={5} min={0} max={255} onChange={v => setQualityCalibrationValue('local', 'maxMeanBrightness', v)} />
              <CalRow theme={theme} label={t(lang, 'calMaxSaturated')} value={calibration.local.maxSaturatedRatio} step={0.05} decimals={2} min={0} max={1} onChange={v => setQualityCalibrationValue('local', 'maxSaturatedRatio', v)} />
              <CalRow theme={theme} label={t(lang, 'calMaxDark')} value={calibration.local.maxDarkRatio} step={0.05} decimals={2} min={0} max={1} onChange={v => setQualityCalibrationValue('local', 'maxDarkRatio', v)} />
              <CalRow theme={theme} label={t(lang, 'calMinContrast')} value={calibration.local.minContrastRange} step={5} min={0} max={255} onChange={v => setQualityCalibrationValue('local', 'minContrastRange', v)} />
              <CalRow theme={theme} label={t(lang, 'calMaxShadow')} value={calibration.local.maxShadowUnevenness} step={5} min={0} max={255} onChange={v => setQualityCalibrationValue('local', 'maxShadowUnevenness', v)} />
              <CalRow theme={theme} label={t(lang, 'calMinSharpness')} value={calibration.local.minSharpness} step={0.5} decimals={1} min={0} max={50} onChange={v => setQualityCalibrationValue('local', 'minSharpness', v)} />

              <View style={s.divider} />
              <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 }}>
                <Text style={[s.rowLabel, { marginBottom: 2 }]}>{t(lang, 'calGeminiProfile')}</Text>
                <Text style={s.specialDesc}>{t(lang, 'calGeminiProfileDesc')}</Text>
              </View>
              <CalRow theme={theme} label={t(lang, 'calMinBrightness')} value={calibration.gemini.minMeanBrightness} step={5} min={0} max={255} onChange={v => setQualityCalibrationValue('gemini', 'minMeanBrightness', v)} />
              <CalRow theme={theme} label={t(lang, 'calMaxBrightness')} value={calibration.gemini.maxMeanBrightness} step={5} min={0} max={255} onChange={v => setQualityCalibrationValue('gemini', 'maxMeanBrightness', v)} />
              <CalRow theme={theme} label={t(lang, 'calMaxSaturated')} value={calibration.gemini.maxSaturatedRatio} step={0.05} decimals={2} min={0} max={1} onChange={v => setQualityCalibrationValue('gemini', 'maxSaturatedRatio', v)} />
              <CalRow theme={theme} label={t(lang, 'calMaxDark')} value={calibration.gemini.maxDarkRatio} step={0.05} decimals={2} min={0} max={1} onChange={v => setQualityCalibrationValue('gemini', 'maxDarkRatio', v)} />
              <CalRow theme={theme} label={t(lang, 'calMinSharpness')} value={calibration.gemini.minSharpness} step={0.5} decimals={1} min={0} max={50} onChange={v => setQualityCalibrationValue('gemini', 'minSharpness', v)} />

              <View style={s.divider} />
              <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 }}>
                <Text style={s.rowLabel}>{t(lang, 'calMarkerSection')}</Text>
                <Text style={s.specialDesc}>{t(lang, 'calMarkerSectionDesc')}</Text>
              </View>
              <CalRow theme={theme} label={t(lang, 'calDividerTolerance')} value={calibration.marker.dividerToleranceRatio} step={0.05} decimals={2} min={0.05} max={0.6} onChange={v => setQualityCalibrationValue('marker', 'dividerToleranceRatio', v)} />
              <CalRow theme={theme} label={t(lang, 'calMaxLineThickness')} value={calibration.marker.maxThicknessRatio} step={0.02} decimals={2} min={0.05} max={0.4} onChange={v => setQualityCalibrationValue('marker', 'maxThicknessRatio', v)} />
              <CalRow theme={theme} label={t(lang, 'calMinLineCoverage')} value={calibration.marker.minLineCoverage} step={0.05} decimals={2} min={0.1} max={0.9} onChange={v => setQualityCalibrationValue('marker', 'minLineCoverage', v)} />
              <CalRow theme={theme} label={t(lang, 'calMinRectHeight')} value={calibration.minTileRectHeightPx} step={5} min={0} max={300} onChange={setMinTileRectHeightPx} />

              <View style={s.divider} />
              <TouchableOpacity style={[s.dangerBtn, { marginHorizontal: 14, marginTop: 12 }]} onPress={handleResetCalibration}>
                <Ionicons name="refresh" size={16} color={theme.team2} />
                <Text style={[s.dangerTxt, { color: theme.team2 }]}>{t(lang, 'calReset')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Themes */}
        <Text style={s.sectionLabel}>{t(lang, 'appearance').toUpperCase()}</Text>
        <View style={s.themeGrid}>
          {THEMES.map((th, i) => {
            const locked = th.pro && !isPro;
            return (
              <TouchableOpacity key={i} style={[s.themeCard, themeIndex === i && { borderColor: theme.accent, borderWidth: 2 }]} onPress={() => selectTheme(i)} activeOpacity={0.8}>
                <View style={[s.themePrev, { backgroundColor: th.bg, borderColor: th.border }]}>
                  <View style={[s.themePill, { backgroundColor: th.accent }]} />
                  <View style={[s.themeLine, { backgroundColor: th.border }]} />
                </View>
                <View style={s.themeFooter}>
                  <Text style={s.themeName}>{lang === 'es' ? th.name : th.nameEn}</Text>
                  {locked ? <Ionicons name="lock-closed" size={13} color={theme.textSubtle} />
                          : themeIndex === i ? <Ionicons name="checkmark-circle" size={15} color={theme.accent} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Backup */}
        <Text style={s.sectionLabel}>{t(lang, 'backup').toUpperCase()}</Text>
        <View style={s.card}>
          <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
            <Text style={s.specialDesc}>{t(lang, 'backupDesc')}</Text>
          </View>
          <TouchableOpacity style={[s.row, s.divider]} onPress={doExportBackup}>
            <Ionicons name="cloud-upload-outline" size={18} color={theme.accent} />
            <Text style={[s.rowLabel, { flex: 1 }]}>{t(lang, 'exportBackup')}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textSubtle} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.divider]} onPress={doImportBackup}>
            <Ionicons name="cloud-download-outline" size={18} color={theme.accent} />
            <Text style={[s.rowLabel, { flex: 1 }]}>{t(lang, 'importBackup')}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textSubtle} />
          </TouchableOpacity>
        </View>

        {!adsRemoved && !isPro && (
          <TouchableOpacity style={s.lineBtn} onPress={doRemoveAds}>
            <Ionicons name="remove-circle-outline" size={16} color={theme.text} /><Text style={s.lineBtnTxt}>{t(lang, 'removeAds')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.lineBtn} onPress={doRestore}>
          <Ionicons name="refresh-circle-outline" size={16} color={theme.text} /><Text style={s.lineBtnTxt}>{t(lang, 'restorePurchases')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.dangerBtn} onPress={handleReset}>
          <Ionicons name="trash-outline" size={15} color={theme.danger} /><Text style={[s.dangerTxt, { color: theme.danger }]}>{t(lang, 'reset')}</Text>
        </TouchableOpacity>

        <Text style={s.version}>{t(lang, 'appName')} · v1.0.0{isPro ? ' Pro' : ''}</Text>
      </ScrollView>
      <AdBanner />

      <Modal transparent visible={showPro} animationType="fade">
        <View style={s.overlay}>
          <View style={s.modal}>
            <View style={s.proModalIcon}><Ionicons name="star" size={28} color="#fff" /></View>
            <Text style={s.modalTitle}>{t(lang, 'unlockPro')}</Text>
            <Text style={s.proModalDesc}>{t(lang, 'proDesc')}</Text>
            <TouchableOpacity style={[s.btnPrimary, { width: '100%' }]} onPress={doPurchasePro}><Text style={{ color: '#fff', fontWeight: '700' }}>{t(lang, 'unlockPro')}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPro(false)}><Text style={{ color: theme.textMuted, fontWeight: '600' }}>{t(lang, 'cancel')}</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = (t: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  scroll: { padding: 16, paddingBottom: 32 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: t.text, marginBottom: 16, marginTop: 4, letterSpacing: -0.5 },
  proBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.accent, backgroundColor: t.accentSoft, marginBottom: 20 },
  proIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  proTitle: { fontSize: 15, fontWeight: '700', color: t.text },
  proSub: { fontSize: 12, color: t.textMuted, marginTop: 2, lineHeight: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: t.textSubtle, letterSpacing: 0.8, marginBottom: 8, marginTop: 8 },
  card: { backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, marginBottom: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  divider: { borderTopWidth: 1, borderTopColor: t.border },
  dot: { width: 9, height: 9, borderRadius: 5 },
  rowLabel: { fontSize: 14, color: t.text, fontWeight: '500' },
  input: { marginLeft: 'auto', minWidth: 120, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7, borderWidth: 1, borderColor: t.border, fontSize: 14, textAlign: 'right', color: t.text, backgroundColor: t.cardAlt },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 30, height: 30, borderRadius: 7, borderWidth: 1, borderColor: t.border, backgroundColor: t.cardAlt, alignItems: 'center', justifyContent: 'center' },
  stepVal: { fontSize: 16, fontWeight: '700', color: t.text, minWidth: 40, textAlign: 'center' },
  presetRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  preset: { flex: 1, paddingVertical: 8, borderRadius: 7, borderWidth: 1, borderColor: t.border, alignItems: 'center', backgroundColor: t.cardAlt },
  presetTxt: { fontSize: 13, fontWeight: '600' },
  specialBlock: { paddingHorizontal: 14, paddingVertical: 12 },
  specialHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  specialDesc: { fontSize: 12, color: t.textSubtle, marginTop: 2 },
  ptsConfig: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.border },
  ptsConfigLabel: { fontSize: 13, color: t.textMuted, fontWeight: '500' },
  segRow: { flexDirection: 'row', padding: 6, gap: 6 },
  seg: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', backgroundColor: t.cardAlt },
  segActive: { backgroundColor: t.accent },
  segTxt: { fontSize: 13, fontWeight: '600', color: t.textMuted },
  segTxtActive: { color: '#fff' },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  themeCard: { width: '47%', flexGrow: 1, backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, padding: 10, gap: 8 },
  themePrev: { height: 50, borderRadius: 8, borderWidth: 1, padding: 8, gap: 5, justifyContent: 'center' },
  themePill: { width: 26, height: 6, borderRadius: 3 },
  themeLine: { width: '70%', height: 4, borderRadius: 2 },
  themeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  themeName: { fontSize: 13, fontWeight: '600', color: t.text },
  lineBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, marginBottom: 10 },
  lineBtnTxt: { fontSize: 14, fontWeight: '600', color: t.text },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, marginTop: 6, marginBottom: 16 },
  dangerTxt: { fontSize: 13, fontWeight: '600' },
  version: { fontSize: 12, textAlign: 'center', color: t.textSubtle },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { width: '100%', maxWidth: 340, backgroundColor: t.card, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: t.border, gap: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: t.text, textAlign: 'center' },
  proModalIcon: { width: 56, height: 56, borderRadius: 16, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  proModalDesc: { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 19 },
  btnPrimary: { paddingVertical: 13, borderRadius: 10, alignItems: 'center', backgroundColor: t.accent },
});
