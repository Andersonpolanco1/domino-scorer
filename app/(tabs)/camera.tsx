/**
 * camera.tsx — FIXED VERSION
 *
 * Key fix: the original decodeToPixels() was reading raw JPEG-compressed bytes
 * as if they were pixel values. JPEG bytes are Huffman/DCT encoded — not RGB.
 * The result was passing garbage data to the dot-detection algorithm.
 *
 * Solution: use a hidden WebView that renders the image on an HTML canvas
 * and returns real getImageData() RGBA values back to React Native.
 * This works 100% offline on both iOS and Android.
 */

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  ScrollView,
} from "react-native";
import { useState, useRef, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import { WebView } from "react-native-webview"; // ← NEW IMPORT
import { router } from "expo-router";
import { useGameStore } from "@/hooks/useGameStore";
import { detectDominoDotsFromPixels } from "@/utils/dotDetection";
import { t } from "@/constants/i18n";

// ─── WebView-based pixel decoder ─────────────────────────────────────────────
//
// We embed a tiny HTML page that:
//  1. Receives a base64 JPEG string via postMessage
//  2. Draws it on a canvas
//  3. Calls getImageData() to get real RGBA pixels
//  4. Posts the result back as a JSON array
//
// This is the ONLY reliable way to decode a JPEG to pixels on React Native
// without adding a native module or using internet.

const DECODER_HTML = `
<!DOCTYPE html>
<html>
<body style="margin:0;background:#000">
<canvas id="c"></canvas>
<script>
window.addEventListener('message', function(e) {
  var data = e.data;
  if (!data || !data.base64) return;
  var img = new Image();
  img.onload = function() {
    var c = document.getElementById('c');
    c.width = img.width;
    c.height = img.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var id = ctx.getImageData(0, 0, img.width, img.height);
    // Transfer as regular array (Uint8ClampedArray can't be JSON-serialized directly)
    window.ReactNativeWebView.postMessage(JSON.stringify({
      width: img.width,
      height: img.height,
      pixels: Array.from(id.data)
    }));
  };
  img.onerror = function() {
    window.ReactNativeWebView.postMessage(JSON.stringify({ error: 'img load failed' }));
  };
  img.src = 'data:image/jpeg;base64,' + data.base64;
});
</script>
</body>
</html>
`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function CameraScreen() {
  const { theme, lang, names, addPoints, scores, target } = useGameStore();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const webViewRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    tiles: number;
    total: number;
    confidence: "high" | "medium" | "low";
    uri: string | null;
  } | null>(null);
  const [facing, setFacing] = useState<"back" | "front">("back");

  // Holds a promise resolver so we can await the WebView response
  const pendingResolve = useRef<
    ((pixels: Uint8ClampedArray, w: number, h: number) => void) | null
  >(null);
  const pendingReject = useRef<((e: Error) => void) | null>(null);

  const s = styles(theme);

  // ── Called when WebView posts decoded pixels back ──
  const onWebViewMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.error || !msg.pixels) {
        pendingReject.current?.(new Error(msg.error ?? "decode failed"));
        return;
      }
      const pixels = new Uint8ClampedArray(msg.pixels);
      pendingResolve.current?.(pixels, msg.width, msg.height);
    } catch (err) {
      pendingReject.current?.(new Error(String(err)));
    }
    pendingResolve.current = null;
    pendingReject.current = null;
  }, []);

  // ── Decode JPEG base64 → real RGBA pixels via WebView canvas ──
  const decodeToPixels = (
    base64: string,
    width: number,
    height: number,
  ): Promise<Uint8ClampedArray> => {
    return new Promise((resolve, reject) => {
      pendingResolve.current = resolve;
      pendingReject.current = reject;
      // Send base64 to the WebView
      webViewRef.current?.postMessage(JSON.stringify({ base64 }));
      // Timeout fallback
      setTimeout(() => {
        if (pendingResolve.current) {
          pendingResolve.current = null;
          pendingReject.current = null;
          reject(new Error("WebView decode timeout"));
        }
      }, 8000);
    });
  };

  if (!permission) return <View style={s.safe} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.perm}>
          <View style={s.permIcon}>
            <Ionicons name="camera-outline" size={40} color={theme.textMuted} />
          </View>
          <Text style={s.permTitle}>{t(lang, "cameraPermission")}</Text>
          <Text style={s.permSub}>{t(lang, "cameraPermissionSub")}</Text>
          <TouchableOpacity
            style={[s.permBtn, { backgroundColor: theme.accent }]}
            onPress={requestPermission}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
              {t(lang, "grantPermission")}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const slotColor = (i: number) =>
    [theme.team1, theme.team2, theme.accent, theme.success][i % 4];

  const capture = async () => {
    if (!cameraRef.current || loading) return;
    setLoading(true);
    setResult(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: true,
      });
      if (!photo) throw new Error("no photo");

      // Resize to manageable size for processing
      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 600 } }],
        { format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!resized.base64) throw new Error("no base64");

      // ✅ FIXED: decode via WebView canvas (real pixels, not raw JPEG bytes)
      const pixels = await decodeToPixels(
        resized.base64,
        resized.width,
        resized.height,
      );

      const det = detectDominoDotsFromPixels(
        pixels,
        resized.width,
        resized.height,
      );
      setResult({
        tiles: det.tilesFound,
        total: det.totalDots,
        confidence: det.confidence,
        uri: resized.uri,
      });
      Haptics.notificationAsync(
        det.totalDots > 0
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
    } catch (e) {
      console.error("capture error", e);
      Alert.alert("Error", String(e));
    } finally {
      setLoading(false);
    }
  };

  const assign = (playerIdx: 0 | 1) => {
    if (!result) return;
    addPoints(playerIdx, result.total, "camera");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setResult(null);
    router.replace("/");
  };

  return (
    <SafeAreaView style={s.safe}>
      {/* Hidden WebView for pixel decoding — invisible, height 0 */}
      <WebView
        ref={webViewRef}
        style={{ width: 1, height: 1, position: "absolute", opacity: 0 }}
        source={{ html: DECODER_HTML }}
        onMessage={onWebViewMessage}
        javaScriptEnabled
        originWhitelist={["*"]}
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>{t(lang, "camera")}</Text>
          <TouchableOpacity
            style={s.flip}
            onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
          >
            <Ionicons
              name="camera-reverse-outline"
              size={20}
              color={theme.text}
            />
          </TouchableOpacity>
        </View>

        {!result ? (
          <>
            {/* Camera preview */}
            <View style={s.camWrap}>
              <CameraView ref={cameraRef} style={s.cam} facing={facing}>
                <View style={s.guide}>
                  <View style={s.guideBox} />
                </View>
              </CameraView>
            </View>

            {/* Tips */}
            <View style={s.tipsCard}>
              <Text style={s.tipsTitle}>{t(lang, "cameraTips")}</Text>
              {(
                [
                  { icon: "sunny-outline", key: "tip1" },
                  { icon: "contrast-outline", key: "tip2" },
                  { icon: "tablet-landscape-outline", key: "tip3" },
                  { icon: "scan-outline", key: "tip4" },
                ] as const
              ).map(({ icon, key }) => (
                <View key={key} style={s.tipRow}>
                  <Ionicons name={icon} size={15} color={theme.accent} />
                  <Text style={s.tipTxt}>{t(lang, key)}</Text>
                </View>
              ))}
            </View>

            {/* Capture button */}
            <TouchableOpacity
              style={[
                s.capBtn,
                { backgroundColor: theme.accent, opacity: loading ? 0.7 : 1 },
              ]}
              onPress={capture}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="scan-outline" size={22} color="#fff" />
              )}
              <Text style={s.capTxt}>
                {loading ? t(lang, "analyzing") : t(lang, "detectPoints")}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View>
            {result.uri && (
              <Image
                source={{ uri: result.uri }}
                style={s.thumb}
                resizeMode="cover"
              />
            )}

            {/* Result cards */}
            <View style={s.resCards}>
              <View style={s.resCard}>
                <Text style={s.resLabel}>{t(lang, "tilesDetected")}</Text>
                <Text style={[s.resVal, { color: theme.accent }]}>
                  {result.tiles}
                </Text>
              </View>
              <View style={s.resCard}>
                <Text style={s.resLabel}>{t(lang, "pointsDetected")}</Text>
                <Text style={[s.resVal, { color: theme.team1 }]}>
                  {result.total}
                </Text>
              </View>
              <View style={s.resCard}>
                <Text style={s.resLabel}>{t(lang, "accuracy")}</Text>
                <Text
                  style={[
                    s.resVal,
                    {
                      color:
                        result.confidence === "high"
                          ? theme.success
                          : result.confidence === "medium"
                            ? theme.accent
                            : theme.team2,
                      fontSize: 14,
                    },
                  ]}
                >
                  {t(lang, result.confidence)}
                </Text>
              </View>
            </View>

            {result.total > 0 ? (
              <>
                <Text style={s.assignLabel}>
                  {t(lang, "assignTo", { n: result.total })}
                </Text>
                <View style={s.assignGrid}>
                  {names.map((n, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[s.assignBtn, { backgroundColor: slotColor(i) }]}
                      onPress={() => assign(i as 0 | 1)}
                    >
                      <Ionicons name="add-circle" size={16} color="#fff" />
                      <Text style={s.assignTxt} numberOfLines={1}>
                        {n}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <Text style={s.noRes}>{t(lang, "noDetection")}</Text>
            )}

            <TouchableOpacity style={s.retry} onPress={() => setResult(null)}>
              <Ionicons name="refresh" size={16} color={theme.textMuted} />
              <Text style={[s.retryTxt, { color: theme.textMuted }]}>
                {t(lang, "retry")}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (t: any) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 0,
      paddingTop: 8,
      paddingBottom: 12,
    },
    title: {
      fontSize: 24,
      fontWeight: "700",
      color: t.text,
      letterSpacing: -0.5,
    },
    flip: {
      width: 36,
      height: 36,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
      alignItems: "center",
      justifyContent: "center",
    },
    camWrap: {
      borderRadius: 14,
      overflow: "hidden",
      aspectRatio: 4 / 3,
      backgroundColor: "#000",
    },
    cam: { flex: 1 },
    guide: { flex: 1, alignItems: "center", justifyContent: "center" },
    guideBox: {
      width: "85%",
      height: "80%",
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.5)",
      borderRadius: 12,
      borderStyle: "dashed",
    },
    tipsCard: {
      backgroundColor: t.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      gap: 10,
    },
    tipsTitle: {
      fontSize: 12,
      fontWeight: "600",
      color: t.textMuted,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 2,
    },
    tipRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    tipTxt: { fontSize: 13, color: t.text, flex: 1, lineHeight: 18 },
    capBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: 16,
      borderRadius: 12,
    },
    capTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
    thumb: { width: "100%", height: 120, borderRadius: 12, marginBottom: 12 },
    resCards: { flexDirection: "row", gap: 8, marginBottom: 14 },
    resCard: {
      flex: 1,
      padding: 10,
      borderRadius: 12,
      alignItems: "center",
      gap: 4,
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
    },
    resLabel: { fontSize: 11, color: t.textMuted },
    resVal: { fontSize: 20, fontWeight: "700" },
    assignLabel: {
      fontSize: 14,
      color: t.textMuted,
      textAlign: "center",
      marginBottom: 10,
    },
    assignGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginBottom: 10,
    },
    assignBtn: {
      flexBasis: "47%",
      flexGrow: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      padding: 14,
      borderRadius: 12,
    },
    assignTxt: {
      color: "#fff",
      fontWeight: "700",
      fontSize: 15,
      maxWidth: 100,
    },
    noRes: {
      fontSize: 13,
      color: t.textMuted,
      textAlign: "center",
      marginBottom: 12,
      lineHeight: 20,
    },
    retry: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
    },
    retryTxt: { fontSize: 13 },
    perm: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      gap: 14,
    },
    permIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: t.cardAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    permTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: t.text,
      textAlign: "center",
    },
    permSub: {
      fontSize: 14,
      color: t.textMuted,
      textAlign: "center",
      lineHeight: 22,
    },
    permBtn: {
      width: "100%",
      padding: 16,
      borderRadius: 12,
      alignItems: "center",
    },
  });
