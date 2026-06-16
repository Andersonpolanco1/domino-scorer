import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Image, ScrollView } from 'react-native';
import { useState, useRef } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { router } from 'expo-router';
import { useGameStore } from '@/hooks/useGameStore';
import { detectDominoDotsFromPixels } from '@/utils/dotDetection';
import { t } from '@/constants/i18n';

export default function CameraScreen() {
  const { theme, lang, names, addPoints, scores, target } = useGameStore();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ tiles: number; total: number; confidence: 'high' | 'medium' | 'low'; uri: string | null } | null>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const s = styles(theme);

  if (!permission) return <View style={s.safe} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.perm}>
          <View style={s.permIcon}><Ionicons name="camera-outline" size={40} color={theme.textMuted} /></View>
          <Text style={s.permTitle}>{t(lang, 'cameraPermission')}</Text>
          <Text style={s.permSub}>{t(lang, 'cameraPermissionSub')}</Text>
          <TouchableOpacity style={[s.permBtn, { backgroundColor: theme.accent }]} onPress={requestPermission}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t(lang, 'grantPermission')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const slotColor = (i: number) => [theme.team1, theme.team2, theme.accent, theme.success][i % 4];

  const capture = async () => {
    if (!cameraRef.current || loading) return;
    setLoading(true); setResult(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: true });
      if (!photo) throw new Error('no photo');
      const resized = await ImageManipulator.manipulateAsync(photo.uri, [{ resize: { width: 700 } }], { format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!resized.base64) throw new Error('no base64');
      const pixels = await decodeToPixels(resized.base64, resized.width, resized.height);
      const det = detectDominoDotsFromPixels(pixels, resized.width, resized.height);
      setResult({ tiles: det.tilesFound, total: det.totalDots, confidence: det.confidence, uri: resized.uri });
      Haptics.notificationAsync(det.totalDots > 0 ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    } catch (e) {
      Alert.alert(t(lang, 'camera'), t(lang, 'noDetection'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally { setLoading(false); }
  };

  const assign = (slot: 0 | 1) => {
    if (!result || result.total === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    addPoints(slot, result.total, 'camera');
    setResult(null);
    router.push('/');
  };

  const confColor = result?.confidence === 'high' ? theme.success : result?.confidence === 'medium' ? '#E0A030' : theme.danger;
  const confLabel = result ? t(lang, result.confidence) : '';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Text style={s.title}>{t(lang, 'detectPoints')}</Text>
        <TouchableOpacity onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} style={s.flip}><Ionicons name="camera-reverse-outline" size={20} color={theme.textMuted} /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
        <View style={s.camWrap}>
          <CameraView ref={cameraRef} style={s.cam} facing={facing}>
            <View style={s.guide}><View style={s.guideBox} /></View>
          </CameraView>
        </View>

        <View style={s.tipRow}>
          <Ionicons name="information-circle-outline" size={14} color={theme.textSubtle} />
          <Text style={s.tipTxt}>{t(lang, 'tip2')}</Text>
        </View>

        {!result && (
          <TouchableOpacity style={[s.capBtn, { backgroundColor: theme.accent, opacity: loading ? 0.7 : 1 }]} onPress={capture} disabled={loading}>
            {loading ? <><ActivityIndicator color="#fff" size="small" /><Text style={s.capTxt}>{t(lang, 'analyzing')}</Text></>
                     : <><Ionicons name="scan" size={20} color="#fff" /><Text style={s.capTxt}>{t(lang, 'detectPoints')}</Text></>}
          </TouchableOpacity>
        )}

        {result && (
          <View>
            {result.uri && <Image source={{ uri: result.uri }} style={s.thumb} resizeMode="cover" />}
            <View style={s.resCards}>
              <View style={s.resCard}><Ionicons name="grid-outline" size={18} color={theme.textMuted} /><Text style={s.resLabel}>{t(lang, 'tilesDetected')}</Text><Text style={[s.resVal, { color: theme.text }]}>{result.tiles}</Text></View>
              <View style={s.resCard}><Ionicons name="calculator-outline" size={18} color={theme.textMuted} /><Text style={s.resLabel}>{t(lang, 'pointsDetected')}</Text><Text style={[s.resVal, { color: theme.text }]}>{result.total}</Text></View>
              <View style={s.resCard}><Ionicons name="shield-checkmark-outline" size={18} color={confColor} /><Text style={s.resLabel}>{t(lang, 'accuracy')}</Text><Text style={[s.resVal, { color: confColor }]}>{confLabel}</Text></View>
            </View>

            {result.total > 0 ? (
              <>
                <Text style={s.assignLabel}>{t(lang, 'assignTo', { n: result.total })}</Text>
                <View style={s.assignGrid}>
                  {names.map((n, i) => (
                    <TouchableOpacity key={i} style={[s.assignBtn, { backgroundColor: slotColor(i) }]} onPress={() => assign(i as 0 | 1)}>
                      <Ionicons name="add-circle" size={16} color="#fff" /><Text style={s.assignTxt} numberOfLines={1}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : <Text style={s.noRes}>{t(lang, 'noDetection')}</Text>}

            <TouchableOpacity style={s.retry} onPress={() => setResult(null)}>
              <Ionicons name="refresh" size={16} color={theme.textMuted} /><Text style={[s.retryTxt, { color: theme.textMuted }]}>{t(lang, 'retry')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

async function decodeToPixels(base64: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const byteStr = atob(base64);
  const bytes = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
  const totalPixels = width * height;
  const pixels = new Uint8ClampedArray(totalPixels * 4);
  let dataStart = 2;
  for (let i = 0; i < bytes.length - 1; i++) { if (bytes[i] === 0xFF && bytes[i + 1] === 0xDA) { dataStart = i + 2; break; } }
  const stride = Math.max(1, Math.floor((bytes.length - dataStart) / totalPixels));
  for (let i = 0; i < totalPixels; i++) {
    const idx = dataStart + i * stride;
    const luma = idx < bytes.length ? bytes[idx] : 128;
    pixels[i * 4] = luma; pixels[i * 4 + 1] = luma; pixels[i * 4 + 2] = luma; pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

const styles = (t: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: t.text, letterSpacing: -0.5 },
  flip: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' },
  camWrap: { borderRadius: 14, overflow: 'hidden', aspectRatio: 4 / 3, backgroundColor: '#000' },
  cam: { flex: 1 },
  guide: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  guideBox: { width: '85%', height: '80%', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 12, borderStyle: 'dashed' },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 12 },
  tipTxt: { fontSize: 12, color: t.textSubtle, flex: 1 },
  capBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: 12 },
  capTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  thumb: { width: '100%', height: 120, borderRadius: 12, marginBottom: 12 },
  resCards: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  resCard: { flex: 1, padding: 10, borderRadius: 12, alignItems: 'center', gap: 4, backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
  resLabel: { fontSize: 11, color: t.textMuted },
  resVal: { fontSize: 20, fontWeight: '700' },
  assignLabel: { fontSize: 14, color: t.textMuted, textAlign: 'center', marginBottom: 10 },
  assignGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  assignBtn: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 14, borderRadius: 12 },
  assignTxt: { color: '#fff', fontWeight: '700', fontSize: 15, maxWidth: 100 },
  noRes: { fontSize: 13, color: t.textMuted, textAlign: 'center', marginBottom: 12, lineHeight: 20 },
  retry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: t.border },
  retryTxt: { fontSize: 13 },
  perm: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  permIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: t.cardAlt, alignItems: 'center', justifyContent: 'center' },
  permTitle: { fontSize: 20, fontWeight: '700', color: t.text, textAlign: 'center' },
  permSub: { fontSize: 14, color: t.textMuted, textAlign: 'center', lineHeight: 22 },
  permBtn: { width: '100%', padding: 16, borderRadius: 12, alignItems: 'center' },
});
