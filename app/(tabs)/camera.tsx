/**
 * camera.tsx
 *
 * Flujo completo:
 *  1. Mientras la cámara está abierta, se toman fotos de muestreo MUY
 *     ligeras (baja resolución, ~80x60) cada ~800ms, se decodifican vía
 *     WebView→canvas (igual que la foto final) y se analiza su calidad
 *     con `analyzeImageQuality` (luz, sombra, contraste, nitidez) — todo
 *     matemático, 100% offline, sin modelos de IA.
 *  2. El resultado de calidad se muestra en tiempo real como un indicador
 *     (semáforo + mensaje específico) sobre la vista de la cámara.
 *  3. El botón de captura permanece DESHABILITADO mientras la calidad no
 *     sea aceptable — esto evita que el usuario capture en condiciones
 *     que producirían un conteo de puntos no confiable.
 *  4. Al capturar, se vuelve a validar la calidad sobre la foto real (no
 *     solo el último muestreo) antes de proceder al cálculo, como defensa
 *     adicional.
 *  5. Detección de puntos (dotDetection) + identificación de fichas
 *     individuales con su valor (tileIdentification), mostrando un
 *     desglose ficha por ficha además del total.
 *
 * El decodificador JPEG→píxeles vía WebView+canvas sigue siendo necesario
 * porque React Native no expone getImageData() de forma nativa; es la
 * única vía 100% offline sin añadir módulos nativos adicionales.
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
  AppState,
} from "react-native";
import { useState, useRef, useCallback, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import { WebView } from "react-native-webview";
import { router } from "expo-router";
import { useGameStore } from "@/hooks/useGameStore";
import { detectDominoDotsFromGray, otsuThreshold } from "@/utils/dotDetection";
import { identifyTiles, IdentifiedTile } from "@/utils/tileIdentification";
import { analyzeImageQuality, QualityReport } from "@/utils/imageQuality";
import {
  detectTileLayout,
  TileLayoutResult,
  TileLayoutFailureReason,
} from "@/utils/lineDetection";
import {
  identifyTotalWithGemini,
  GeminiDetectionError,
  GeminiDetectionErrorCode,
} from "@/utils/geminiDetection";
import { t } from "@/constants/i18n";

// ─── WebView-based pixel decoder ─────────────────────────────────────────────
//
// Página HTML embebida que recibe un JPEG en base64, lo dibuja en un
// canvas, y devuelve los píxeles reales (vía getImageData) ya convertidos
// a escala de grises — único método 100% offline para decodificar JPEG a
// píxeles reales en React Native sin módulos nativos adicionales.
const DECODER_HTML = `
<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#000">
<canvas id="c"></canvas>
<script>
function send(obj) {
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(JSON.stringify(obj));
  }
}

function handle(raw) {
  var data;
  try { data = JSON.parse(raw); } catch (err) { send({ error: 'bad json' }); return; }
  if (!data || !data.base64) return;
  var img = new Image();
  img.onload = function() {
    try {
      var c = document.getElementById('c');
      c.width = img.width;
      c.height = img.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      var id = ctx.getImageData(0, 0, img.width, img.height);
      var rgba = id.data;
      var n = img.width * img.height;
      var gray = new Array(n);
      for (var i = 0; i < n; i++) {
        var r = rgba[i*4], g = rgba[i*4+1], b = rgba[i*4+2];
        gray[i] = (r*299 + g*587 + b*114) / 1000 | 0;
      }
      send({ width: img.width, height: img.height, gray: gray, reqId: data.reqId });
    } catch (err) {
      send({ error: 'process failed: ' + err.message, reqId: data.reqId });
    }
  };
  img.onerror = function() { send({ error: 'img load failed', reqId: data.reqId }); };
  img.src = 'data:image/jpeg;base64,' + data.base64;
}

document.addEventListener('message', function(e) { handle(e.data); });
window.addEventListener('message', function(e) { handle(e.data); });

send({ ready: true });
</script>
</body>
</html>
`;

type DecodedFrame = { gray: Uint8ClampedArray; width: number; height: number };

/**
 * Recorta un buffer en escala de grises a la sub-región
 * [minX, maxX) × [minY, maxY), devolviendo un nuevo buffer más pequeño con
 * sus propias dimensiones — usado para reducir el ÁREA REAL que el
 * detector de puntos procesa, no solo el área que el overlay de
 * marcadores muestra visualmente. Esto reduce el ruido de procesamiento
 * (menos píxeles de mesa vacía considerados) cuando el bloque real de
 * fichas es más angosto que la imagen completa capturada.
 *
 * Los límites se acotan (`clamp`) a los bordes reales del buffer de
 * origen, por si el mapeo de marcadores a coordenadas de imagen produce
 * un valor ligeramente fuera de rango (redondeo, aproximación de mapeo
 * pantalla→imagen) — preferible recortar al borde disponible que fallar
 * silenciosamente o leer fuera de los límites del array.
 */
function cropGrayBuffer(
  gray: Uint8Array,
  width: number,
  height: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): { gray: Uint8Array; width: number; height: number } | null {
  const x0 = Math.max(0, Math.min(minX, width));
  const x1 = Math.max(0, Math.min(maxX, width));
  const y0 = Math.max(0, Math.min(minY, height));
  const y1 = Math.max(0, Math.min(maxY, height));

  const cropW = x1 - x0;
  const cropH = y1 - y0;
  if (cropW <= 0 || cropH <= 0) return null;

  const out = new Uint8Array(cropW * cropH);
  for (let y = 0; y < cropH; y++) {
    const srcOffset = (y0 + y) * width + x0;
    const dstOffset = y * cropW;
    for (let x = 0; x < cropW; x++) {
      out[dstOffset + x] = gray[srcOffset + x];
    }
  }
  return { gray: out, width: cropW, height: cropH };
}

interface IdentifiedResult {
  tiles: number;
  total: number;
  confidence: "high" | "medium" | "low";
  uri: string | null;
  breakdown: IdentifiedTile[];
  allMatched: boolean;
  /** Qué motor produjo este resultado — usado por la UI para decidir
   * mensajes y comportamientos específicos de cada modo. */
  mode: "local" | "gemini";
}

/**
 * Recorta una región (en coordenadas de la imagen ya redimensionada para
 * trabajo, no de pantalla) y devuelve un JPEG en base64 — usado SOLO por
 * el modo Gemini, que necesita la imagen real en color (no el buffer en
 * escala de grises que usa el detector local) para enviarla a la API.
 *
 * A diferencia de `cropGrayBuffer`, el recorte aquí es nativo (vía
 * `ImageManipulator`), no se hace a mano sobre un array de píxeles — es
 * mucho más rápido y no requiere pasar por el WebView.
 */
async function cropToJpegBase64(
  uri: string,
  frameWidth: number,
  frameHeight: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Promise<string | null> {
  const x0 = Math.max(0, Math.min(Math.round(minX), frameWidth - 1));
  const y0 = Math.max(0, Math.min(Math.round(minY), frameHeight - 1));
  const x1 = Math.max(x0 + 1, Math.min(Math.round(maxX), frameWidth));
  const y1 = Math.max(y0 + 1, Math.min(Math.round(maxY), frameHeight));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  const cropped = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop: { originX: x0, originY: y0, width: w, height: h } }],
    { format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  return cropped.base64 ?? null;
}

// Intervalo de muestreo de calidad en vivo. Suficientemente frecuente para
// sentirse en tiempo real, suficientemente espaciado para no sobrecargar
// el hilo de JS ni el hardware de la cámara con capturas constantes.
//
// LIMITACIÓN CONOCIDA: expo-camera (sin librerías nativas adicionales como
// react-native-vision-camera + frame processors) no expone un callback de
// frame de preview accesible desde JS. La única vía 100% offline dentro
// del stack actual (Expo managed) es tomar fotos reales periódicas de muy
// baja calidad/resolución. En algunos dispositivos esto puede producir un
// parpadeo breve del preview en cada muestreo. Si esto resulta molesto en
// pruebas reales, la mejora futura sería migrar a vision-camera con un
// frame processor en C++ (requiere development build, ya no Expo Go).
//
// IMPORTANTE — NO usar `skipProcessing: true` en takePictureAsync: esta
// opción salta el pipeline de procesamiento de imagen del hardware (según
// la documentación oficial de Expo, incluso la rotación EXIF se omite si
// está activa). En la práctica, en varios dispositivos Android (reportado
// en tablets) esto produce fotos sistemáticamente más oscuras que la
// escena real, sin importar la luz ambiente — el chequeo de calidad
// detectaba "poca luz" incluso con sol directo porque el frame analizado
// no representaba la luz real, solo el sensor crudo sin el ajuste
// automático de exposición que normalmente se aplica. Quitar este flag
// hace la captura algo más lenta, pero es necesario para que el análisis
// de luminancia sea fiel a la escena real.
const QUALITY_SAMPLE_INTERVAL_MS = 1000;
// Tamaño del frame de muestreo: pequeño a propósito — la calidad de
// iluminación/sombra/contraste no necesita resolución alta, y mantener
// el frame pequeño hace que cada chequeo sea casi instantáneo.
const QUALITY_SAMPLE_WIDTH = 120;

// Altura mínima aceptable (en píxeles de la foto de trabajo, resize a
// 700px de ancho) del recuadro de encuadre antes de intentar el modo
// Gemini. Por debajo de esto, los puntos de cada ficha ocuparían muy
// pocos píxeles reales — heurística, no medición exacta, pensada para
// bloquear el caso obvio (usuario fotografiando muchas fichas desde muy
// lejos) sin gastar una llamada de red que de todas formas no sería
// confiable.
//
// El valor ya NO vive aquí como constante fija — se movió a
// `calibration.minTileRectHeightPx` (useGameStore.ts) para poder
// ajustarlo desde Settings sin rebuild. Ver uso en `captureWithGemini`.

/**
 * Una fila del panel de diagnóstico de calibración: muestra el valor
 * REAL medido en este instante junto al umbral configurado, con un punto
 * de color (pasa/no pasa) y un botón para fijar el umbral directamente
 * desde ese valor real (con margen de seguridad ya aplicado) — pensado
 * para resolver "no sé qué número poner en cada campo": en vez de
 * adivinar con los +/- de Settings, se apunta la cámara a la condición
 * real que se quiere soportar y se toca el botón ahí mismo.
 */
type DiagRowSpec = {
  calKey: string;
  label: string;
  metricValue: number | null;
  metricDisplay: string;
  thresholdDisplay: string;
  pass: boolean | null;
  decimals: number;
  margin: number;
  kind: "min" | "max";
};

function DiagRow({
  theme,
  row,
  onApply,
}: {
  theme: any;
  row: DiagRowSpec;
  onApply: (row: DiagRowSpec) => void;
}) {
  const dotColor =
    row.pass === null ? theme.textMuted : row.pass ? theme.success : theme.team2;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 6,
        gap: 8,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: dotColor,
        }}
      />
      <Text style={{ flex: 1, fontSize: 12, color: theme.text }}>
        {row.label}
      </Text>
      <Text
        style={{
          fontSize: 12,
          fontWeight: "700",
          color: theme.text,
          minWidth: 42,
          textAlign: "right",
        }}
      >
        {row.metricDisplay}
      </Text>
      <Text
        style={{
          fontSize: 11,
          color: theme.textMuted,
          minWidth: 56,
          textAlign: "right",
        }}
      >
        {row.thresholdDisplay}
      </Text>
      <TouchableOpacity
        disabled={row.metricValue === null}
        onPress={() => onApply(row)}
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.cardAlt,
          alignItems: "center",
          justifyContent: "center",
          opacity: row.metricValue === null ? 0.4 : 1,
        }}
      >
        <Ionicons name="checkmark" size={14} color={theme.accent} />
      </TouchableOpacity>
    </View>
  );
}

export default function CameraScreen() {
  const {
    theme,
    lang,
    names,
    addPoints,
    detectionMode,
    setDetectionMode,
    calibration,
    setQualityCalibrationValue,
  } = useGameStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // ── Re-chequeo activo del permiso de cámara ──
  //
  // `useCameraPermissions()` por sí solo refleja el estado del permiso al
  // momento de montar el hook — si Android lo revoca en silencio DURANTE
  // la sesión (el caso real: el usuario concedió "Solo esta vez", que
  // expira al salir de la app), `permission.granted` se queda con el
  // valor viejo en el estado de React para siempre, mientras esta misma
  // pantalla siga montada. El resultado: la cámara sigue mostrándose como
  // si nada, pero cada `takePictureAsync` falla en silencio (atrapado por
  // el try/catch de `sampleQualityOnce`, solo visible en la consola) —
  // exactamente el bug reportado ("dejó de capturar, sin aviso, ni
  // reinstalando ni reiniciando el dispositivo lo arregla", porque cada
  // vez que se vuelve a abrir la app, Android pide el permiso de nuevo y
  // si se elige otra vez "Solo esta vez", el ciclo se repite).
  //
  // `requestPermission()` es seguro de llamar repetidamente: si el
  // permiso YA está concedido de forma estable, el sistema operativo lo
  // resuelve de inmediato sin mostrar ningún diálogo — solo vuelve a
  // preguntar cuando de verdad ya no está concedido. Por eso es seguro
  // dispararlo en cada vuelta a foreground/foco, no solo al montar.
  useFocusEffect(
    useCallback(() => {
      requestPermission();
    }, [requestPermission]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") requestPermission();
    });
    return () => sub.remove();
  }, [requestPermission]);

  const cameraRef = useRef<CameraView>(null);
  const webViewRef = useRef<any>(null);
  const [webViewReady, setWebViewReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IdentifiedResult | null>(null);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [sampling, setSampling] = useState(false);
  const [captureAttempt, setCaptureAttempt] = useState(0);

  // ── Nivel de escala de marcadores (cuántas fichas espera el usuario) ──
  //
  // Como no hay zoom óptico/digital de cámara en este diseño (el usuario
  // ajusta la distancia alejándose o acercándose físicamente con el
  // cuerpo), la app no puede inferir de forma fiable qué tan grande se ve
  // una ficha en la imagen sin antes tener una referencia — intentarlo
  // reintroduciría el mismo problema de detección ambigua (bbox por
  // contraste que se diluye con pocas fichas en un encuadre ancho) que ya
  // se descartó en el diseño del detector de líneas.
  //
  // En vez de eso, el USUARIO controla explícitamente, con un control
  // simple de niveles discretos, qué tan alto debe ser el rectángulo de
  // marcadores — los marcadores nunca desaparecen (siguen siendo la guía
  // de cómo encuadrar), solo cambian de tamaño/posición en pantalla según
  // este nivel. Niveles bajos = pocas fichas (rectángulo más alto, el
  // usuario se acerca). Niveles altos = muchas fichas (rectángulo más
  // bajo y angosto, el usuario se aleja).
  const TILE_SCALE_LEVELS = 5;
  const [tileScaleLevel, setTileScaleLevel] = useState(2); // nivel medio por defecto (0-indexado, 3er de 5)

  // Dimensiones reales del contenedor de cámara en pantalla, capturadas
  // con onLayout — necesarias para calcular las posiciones de los
  // marcadores en píxeles de pantalla concretos, no solo porcentajes.
  const [camLayout, setCamLayout] = useState({ width: 0, height: 0 });

  /**
   * Calcula la geometría de los 4 marcadores en píxeles de pantalla,
   * dado el nivel de escala actual y el tamaño real del contenedor.
   *
   * Mecánica: en el nivel más bajo (pocas fichas, usuario cerca), el
   * rectángulo de marcadores es ALTO — ocupa casi todo el alto
   * disponible, porque cada ficha individual se ve grande en pantalla.
   * En el nivel más alto (muchas fichas, usuario lejos), el rectángulo es
   * más BAJO (cada ficha ocupa menos alto en pantalla a esa distancia).
   *
   * El ANCHO del rectángulo y la posición de `startX` son CONSTANTES en
   * todos los niveles — confirmado explícitamente: no deben cambiar con
   * el nivel de escala. `startX` se ancla a un margen fijo desde el borde
   * izquierdo de la pantalla, nunca se centra ni se desplaza.
   *
   * BUG CORREGIDO: la versión anterior calculaba `startX` centrando el
   * rectángulo (`(width - rectWidthPx) / 2`) y reducía `rectWidthPx` con
   * más fichas — esto causaba que, al subir el nivel de escala (alejarse
   * para fotografiar más fichas), el borde izquierdo del marcador de
   * inicio se desplazara hacia la derecha, dejando cada vez menos espacio
   * real para las fichas en vez de más. Confirmado y reportado
   * directamente por el usuario probando en dispositivo. Ahora `startX`
   * es un margen fijo y `rectWidthPx` no varía con el nivel.
   *
   * Los valores de alto relativo del rectángulo van desde 70% del
   * contenedor (pocas fichas) hasta un mínimo calculado dinámicamente
   * para que `MAX_TILES_AT_FARTHEST` fichas quepan con margen de
   * seguridad, sin importar el aspect ratio real del contenedor —
   * confirmado con el usuario: deben caber cómodamente 15 fichas en el
   * nivel más alejado.
   *
   * CORRECCIÓN 1: el valor anterior del nivel más alejado (heightRatio=0.4)
   * NO dejaba espacio suficiente para 15 fichas en un contenedor de
   * cámara típico en orientación vertical (más alto que ancho).
   *
   * CORRECCIÓN 2 (progresión pareja entre niveles): interpolar
   * directamente `heightRatio` de forma lineal entre el extremo cercano y
   * el extremo lejano produce un control que se SIENTE roto — porque la
   * cantidad de fichas que caben es inversamente proporcional a
   * `heightRatio`, no lineal. Confirmado con números reales: una
   * interpolación lineal de heightRatio dejaba los niveles 0-2 casi sin
   * cambio útil (1-3 fichas) y todo el salto concentrado entre el nivel 2
   * y el 4 (de ~3 a ~16 fichas). En su lugar, se define una progresión
   * pareja de CANTIDAD DE FICHAS OBJETIVO por nivel
   * (`TARGET_TILES_BY_LEVEL`), y `heightRatio` se DERIVA de esa cantidad
   * en cada nivel — así el control se siente proporcional en todo su
   * rango, no solo en el extremo.
   *
   * Fórmula de derivación (ficha con proporción 2:1, ancho = alto/2): el
   * ancho total de N fichas en fila es N × (alto de ficha / 2). Para que
   * ese ancho quepa dentro de `rectWidthPx × (1 − margen)`, el alto de
   * ficha en píxeles es:
   *
   *   tileHeightPx = (rectWidthPx × (1 − margen) × 2) / N
   *
   * Despejado como fracción del alto del contenedor (heightRatio), esto
   * depende del aspect ratio real (width/height) del contenedor — por
   * eso se calcula en cada llamada en vez de usar una constante fija que
   * solo sería correcta para una proporción de pantalla específica.
   */
  // Progresión pareja de cuántas fichas debería caber cómodamente en cada
  // nivel — de esto se deriva heightRatio, no al revés. Ajustable según
  // pruebas reales; el último valor es el confirmado explícitamente con
  // el usuario (15 fichas en el nivel más alejado).
  const TARGET_TILES_BY_LEVEL = [2, 4, 7, 11, 15];
  const FARTHEST_LEVEL_MARGIN = 0.1; // 10% de aire, no usar el 100% del ancho disponible

  const getMarkerGeometry = useCallback(
    (level: number) => {
      const { width, height } = camLayout;
      if (width === 0 || height === 0) return null;

      // Ancho del rectángulo: CONSTANTE en todos los niveles (confirmado
      // explícitamente con el usuario) — no varía con la cantidad de
      // fichas esperada.
      const widthRatio = 0.9;
      const rectWidthPx = width * widthRatio;

      const targetTiles =
        TARGET_TILES_BY_LEVEL[level] ??
        TARGET_TILES_BY_LEVEL[TARGET_TILES_BY_LEVEL.length - 1];

      // heightRatio derivado directamente de cuántas fichas deben caber
      // en este nivel específico — no interpolado linealmente entre dos
      // extremos, lo que evitaba la progresión pareja (ver nota arriba).
      const heightRatioForTarget =
        (rectWidthPx * (1 - FARTHEST_LEVEL_MARGIN) * 2) /
        (targetTiles * height);
      // Acotado a un rango razonable: no más del 75% del alto disponible
      // (con 1-2 fichas no hace falta ocupar casi toda la pantalla) ni
      // menos del 6% (un rectángulo más bajo que eso deja de ser una guía
      // visual útil, incluso si matemáticamente "cabrían" más fichas).
      const heightRatio = Math.max(0.06, Math.min(0.75, heightRatioForTarget));

      const tileHeightPx = height * heightRatio;

      const centerY = height / 2;
      const topY = centerY - tileHeightPx / 2;
      const bottomY = centerY + tileHeightPx / 2;
      const dividerY = centerY;

      // Margen fijo desde el borde izquierdo — NO se centra, NO depende
      // del nivel de escala. Esto es lo que mantiene la marca de inicio
      // siempre en el mismo lugar visual sin importar cuántas fichas se
      // esperen fotografiar.
      const startX = (width - rectWidthPx) / 2;
      const endX = startX + rectWidthPx;

      // Grosor visual de las líneas de marcador en pantalla: más fino con
      // más fichas (nivel alto), para no verse desproporcionado respecto
      // al tamaño más pequeño de cada ficha a esa distancia. Puramente
      // estético — no afecta el algoritmo de detección, que ya usa
      // umbrales relativos al alto de ficha real en la imagen, no a
      // píxeles de pantalla. A diferencia de heightRatio, aquí sí tiene
      // sentido una interpolación simple por nivel (no hay un objetivo
      // matemático real que derivar, es solo una preferencia visual).
      const lineLevelT = level / (TILE_SCALE_LEVELS - 1);
      const lineWidthPx = 3 - lineLevelT * 1.5; // 3px → 1.5px

      return {
        startX,
        endX,
        topY,
        bottomY,
        dividerY,
        tileHeightPx,
        rectWidthPx,
        lineWidthPx,
      };
    },
    [camLayout],
  );

  const markerGeometry = getMarkerGeometry(tileScaleLevel);

  /**
   * Convierte la geometría de marcadores (en píxeles de PANTALLA, basada
   * en `camLayout`) a las coordenadas equivalentes dentro de la imagen
   * ya capturada y redimensionada para procesamiento (`frameWidth` /
   * `frameHeight`, normalmente distintos a `camLayout`).
   *
   * APROXIMACIÓN CONOCIDA, no mapeo geométrico exacto: se asume que el
   * preview de `CameraView` llena su contenedor (comportamiento estándar,
   * similar a `resizeMode: cover`) y que la foto capturada conserva la
   * misma proporción de aspecto que el preview — por lo que un escalado
   * proporcional simple (posición relativa × dimensión del frame) es una
   * aproximación razonable. Esto puede necesitar calibración fina con
   * pruebas en dispositivo real si el hardware de la cámara recorta el
   * sensor de forma distinta al preview — documentado aquí para no asumir
   * precisión perfecta sin haberla verificado.
   */
  const mapMarkersToFrame = useCallback(
    (
      geometry: NonNullable<ReturnType<typeof getMarkerGeometry>>,
      frameWidth: number,
      frameHeight: number,
    ) => {
      const { width: camW, height: camH } = camLayout;
      if (camW === 0 || camH === 0) return null;

      const scaleX = frameWidth / camW;
      const scaleY = frameHeight / camH;

      return {
        startX: geometry.startX * scaleX,
        endX: geometry.endX * scaleX,
        topY: geometry.topY * scaleY,
        dividerY: geometry.dividerY * scaleY,
        bottomY: geometry.bottomY * scaleY,
      };
    },
    [camLayout],
  );

  const s = styles(theme);

  // Cola de promesas pendientes del decoder, indexadas por reqId — permite
  // que el muestreo de calidad en vivo y la captura final no se pisen
  // entre sí si llegan a superponerse.
  const pendingRequests = useRef<
    Map<
      string,
      { resolve: (f: DecodedFrame) => void; reject: (e: Error) => void }
    >
  >(new Map());
  const reqCounter = useRef(0);
  const samplingActive = useRef(false);
  const samplingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinto de `samplingActive`: ese solo evita que ARRANQUE un nuevo
  // ciclo de muestreo, pero el `loop` de abajo se sigue reprogramando
  // cada `QUALITY_SAMPLE_INTERVAL_MS` de todas formas mientras tanto — si
  // justo en ese instante un muestreo liviano ya estaba en curso (su
  // propio `takePictureAsync` en pleno vuelo) cuando el usuario presiona
  // capturar, ese ciclo termina, ve `samplingActive` en false otra vez, y
  // el loop programa OTRO ciclo 1s después — exactamente la foto de
  // muestreo "molesta" disparándose en medio del análisis real, que es lo
  // reportado. `isCapturing` se marca de forma SÍNCRONA al inicio de
  // `capture()` (antes de cualquier `await`), así que ninguna ejecución
  // intermedia puede colarse entre esa marca y el primer `takePictureAsync`
  // real — y el propio `loop` deja de reprogramarse mientras esté en true,
  // en vez de solo saltarse un ciclo y seguir el reloj.
  const isCapturing = useRef(false);

  const onWebViewMessage = useCallback((event: any) => {
    let msg: any;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (msg.ready) {
      setWebViewReady(true);
      return;
    }

    const reqId = msg.reqId as string | undefined;
    if (!reqId) return;
    const pending = pendingRequests.current.get(reqId);
    if (!pending) return;
    pendingRequests.current.delete(reqId);

    if (msg.error || !msg.gray) {
      pending.reject(new Error(msg.error ?? "decode failed"));
    } else {
      pending.resolve({
        gray: new Uint8ClampedArray(msg.gray),
        width: msg.width,
        height: msg.height,
      });
    }
  }, []);

  const decodeBase64 = (base64: string): Promise<DecodedFrame> => {
    return new Promise((resolve, reject) => {
      const reqId = `r${reqCounter.current++}`;
      pendingRequests.current.set(reqId, { resolve, reject });
      webViewRef.current?.postMessage(JSON.stringify({ base64, reqId }));
      setTimeout(() => {
        if (pendingRequests.current.has(reqId)) {
          pendingRequests.current.delete(reqId);
          reject(new Error("WebView decode timeout"));
        }
      }, 8000);
    });
  };

  // ── Muestreo periódico de calidad en tiempo real ──
  //
  // Toma una foto MUY ligera y pequeña, la decodifica, y analiza su
  // calidad (luz, sombra, contraste, nitidez). Se repite mientras la
  // pantalla de cámara esté visible y no haya un resultado mostrado.
  const sampleQualityOnce = useCallback(async () => {
    if (
      !cameraRef.current ||
      !webViewReady ||
      samplingActive.current ||
      isCapturing.current
    )
      return;
    samplingActive.current = true;
    setSampling(true);
    const t0 = Date.now();
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.2,
        imageType: "jpg",
      });
      console.log(
        `[quality] takePictureAsync: ${Date.now() - t0}ms, photo=${!!photo}, uri=${photo?.uri}`,
      );
      if (!photo) {
        console.warn(
          "[quality] takePictureAsync devolvió null/undefined — abortando este ciclo",
        );
        return;
      }

      const tResize0 = Date.now();
      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: QUALITY_SAMPLE_WIDTH } }],
        {
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
          compress: 0.5,
        },
      );
      console.log(
        `[quality] resize: ${Date.now() - tResize0}ms, base64Len=${resized.base64?.length ?? 0}, w=${resized.width}, h=${resized.height}`,
      );
      if (!resized.base64) {
        console.warn(
          "[quality] resize no produjo base64 — abortando este ciclo",
        );
        return;
      }

      const tDecode0 = Date.now();
      const frame = await decodeBase64(resized.base64);
      console.log(
        `[quality] decode: ${Date.now() - tDecode0}ms, frameW=${frame.width}, frameH=${frame.height}, grayLen=${frame.gray.length}`,
      );

      const report = analyzeImageQuality(
        frame.gray,
        frame.width,
        frame.height,
        detectionMode,
        calibration[detectionMode],
      );
      console.log(
        `[quality] report: ok=${report.ok} issue=${report.issue} meanBrightness=${report.metrics.meanBrightness.toFixed(1)} darkRatio=${report.metrics.darkRatio.toFixed(2)} totalMs=${Date.now() - t0}`,
      );
      setQuality(report);
    } catch (err) {
      // Un fallo de muestreo no debe interrumpir el flujo de la app — se
      // reintenta en el próximo ciclo. Pero SÍ se registra el error real
      // en consola (a diferencia de antes, donde se tragaba en silencio
      // total) — necesario para diagnosticar por qué el indicador de
      // calidad puede quedarse atascado indefinidamente sin que el
      // usuario o el desarrollador tengan ninguna pista de la causa real.
      console.error(
        "[quality] sampleQualityOnce falló:",
        err,
        `(tras ${Date.now() - t0}ms)`,
      );
    } finally {
      samplingActive.current = false;
      setSampling(false);
    }
  }, [webViewReady, detectionMode, calibration]);

  useEffect(() => {
    if (!permission?.granted || !webViewReady || result) {
      // No muestrear mientras no haya permiso, el decoder no esté listo,
      // o ya se esté mostrando un resultado (la cámara no es visible).
      return;
    }

    let cancelled = false;
    const loop = async () => {
      if (cancelled || isCapturing.current) return;
      await sampleQualityOnce();
      if (cancelled || isCapturing.current) return;
      samplingTimer.current = setTimeout(loop, QUALITY_SAMPLE_INTERVAL_MS);
    };
    loop();

    return () => {
      cancelled = true;
      if (samplingTimer.current) clearTimeout(samplingTimer.current);
    };
    // `captureAttempt` fuerza un reinicio limpio del loop tras cualquier
    // intento de captura (exitoso o no) — sin esto, una captura fallida
    // (ej. bloqueada por mala calidad de último momento) dejaría el
    // muestreo en vivo detenido permanentemente, ya que `result` seguiría
    // siendo null y las demás dependencias no habrían cambiado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    permission?.granted,
    webViewReady,
    result,
    sampleQualityOnce,
    captureAttempt,
  ]);

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

  // La captura solo es posible cuando hay un reporte de calidad reciente
  // Y ese reporte indica que la imagen es apta. Sin reporte (aún
  // muestreando) tampoco se permite, para no arriesgar un falso positivo
  // de "todo bien" antes de tener una lectura real.
  const canCapture = quality?.ok === true && !loading;

  /**
   * Traduce un error del módulo de Gemini a un mensaje i18n específico y
   * ofrece, en el mismo Alert, la salida que se confirmó como deseada:
   * cambiar a modo local en vez de solo cerrar el diálogo y dejar al
   * usuario atascado en un modo que está fallando.
   */
  const handleGeminiError = (err: unknown) => {
    console.error("[gemini] capture error", err);
    const code: GeminiDetectionErrorCode =
      err instanceof GeminiDetectionError ? err.code : "network";
    const messageKey: Record<
      GeminiDetectionErrorCode,
      Parameters<typeof t>[1]
    > = {
      no_api_key: "geminiErrorNoApiKey",
      network: "geminiErrorNetwork",
      timeout: "geminiErrorTimeout",
      http_error: "geminiErrorHttp",
      invalid_response: "geminiErrorInvalidResponse",
    };
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Alert.alert(t(lang, "geminiErrorTitle"), t(lang, messageKey[code]), [
      { text: t(lang, "closeAction"), style: "cancel" },
      {
        text: t(lang, "switchToLocalMode"),
        onPress: () => setDetectionMode("local"),
      },
    ]);
  };

  /**
   * Camino de captura cuando `detectionMode === "gemini"`.
   *
   * A propósito NO llama a `detectTileLayout` (la validación geométrica
   * que sí corre en el modo local) — decisión de producto confirmada:
   * el recuadro aquí solo define la región a recortar, nunca rechaza la
   * foto por geometría fina, porque Gemini es más tolerante a un
   * encuadre imperfecto que el algoritmo local (que necesita saber
   * EXACTAMENTE dónde está cada ficha para no diluir la señal).
   *
   * SÍ se hace una validación geométrica mínima — gratis, sin red, antes
   * de gastar una llamada a Gemini —: si el recuadro que el usuario
   * encuadró es demasiado bajo en píxeles reales, las fichas se verán
   * como puntitos sin importar qué tan bueno sea el modelo, así que ni
   * se intenta.
   */
  const captureWithGemini = async (
    frame: DecodedFrame,
    resized: { uri: string; base64?: string },
  ) => {
    const mapped = markerGeometry
      ? mapMarkersToFrame(markerGeometry, frame.width, frame.height)
      : null;

    if (mapped) {
      const rectHeightPx = mapped.bottomY - mapped.topY;
      // Heurística, no medición exacta (igual que otros umbrales de este
      // archivo) — por debajo de esto, los puntos de cada ficha ocupan
      // muy pocos píxeles reales en la foto de trabajo (resize a 700px
      // de ancho) para distinguirse de forma confiable, sin importar el
      // motor de detección. Ajustar tras pruebas de campo si hace falta.
      if (rectHeightPx < calibration.minTileRectHeightPx) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          t(lang, "qualityBlockedTitle"),
          t(lang, "qualityTooFar"),
        );
        return;
      }
    }

    // Margen de seguridad alrededor del recuadro que el usuario vio en
    // pantalla — el mapeo de marcadores a coordenadas de la foto real es
    // una APROXIMACIÓN, no una medición exacta (ver nota en
    // `mapMarkersToFrame`: asume que el preview llena el contenedor igual
    // que la foto capturada, lo cual puede no calzar pixel a pixel en
    // todos los dispositivos). Sin margen, ese desajuste podría cortar el
    // borde de la primera o la última ficha — y una ficha cortada es
    // mucho peor para la precisión que un poco de mesa vacía de más, que
    // Gemini ignora sin problema. El margen es proporcional al alto del
    // recuadro (no un valor fijo en píxeles) para escalar igual sin
    // importar el nivel de zoom/cantidad de fichas.
    const marginPx = mapped ? (mapped.bottomY - mapped.topY) * 0.12 : 0;

    const croppedBase64 = mapped
      ? await cropToJpegBase64(
          resized.uri,
          frame.width,
          frame.height,
          mapped.startX - marginPx,
          mapped.topY - marginPx,
          mapped.endX + marginPx,
          mapped.bottomY + marginPx,
        )
      : null;

    // Respaldo: si por alguna razón no hay geometría de marcadores
    // todavía (camLayout aún no medido, caso raro), se envía la foto
    // completa redimensionada en vez de fallar la captura entera.
    const base64ToSend = croppedBase64 ?? resized.base64 ?? null;
    if (!base64ToSend) {
      handleGeminiError(new Error("no image data to send"));
      return;
    }

    // El thumbnail que se muestra en el resultado es la MISMA imagen que
    // se envió a Gemini (no la foto completa) — así se puede verificar a
    // simple vista, después de cada captura, que el recorte no dejó
    // ninguna ficha cortada antes de confiar en el número.
    const sentImageUri = `data:image/jpeg;base64,${base64ToSend}`;

    try {
      const geminiResult = await identifyTotalWithGemini(base64ToSend);
      // Se mapea al mismo shape `IdentifiedTile` que ya produce el modo
      // local — reutiliza tal cual los chips de desglose y el aviso de
      // "revisa antes de sumar" que ya existían, sin UI nueva. `bbox` y
      // `orientation` no aplican aquí (Gemini no da coordenadas de
      // píxeles), se rellenan con valores neutros porque la UI no los usa.
      // `matched` refleja `reliable` — binario, igual en cada ficha y en
      // el total, sin nivel "medio".
      const breakdown: IdentifiedTile[] = geminiResult.tiles.map(
        (tl, i) => ({
          index: i,
          left: tl.left,
          right: tl.right,
          total: tl.total,
          matched: geminiResult.reliable,
          bbox: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
          orientation: "vertical",
        }),
      );
      setResult({
        tiles: geminiResult.tiles.length,
        total: geminiResult.totalDots,
        confidence: geminiResult.reliable ? "high" : "low",
        uri: sentImageUri,
        breakdown,
        allMatched: geminiResult.reliable,
        mode: "gemini",
      });
      Haptics.notificationAsync(
        geminiResult.totalDots > 0
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
    } catch (err) {
      handleGeminiError(err);
    }
  };

  const capture = async () => {
    if (!cameraRef.current || loading || !canCapture) return;
    // Síncrono, antes de cualquier `await` — ver nota junto a la
    // declaración de `isCapturing` arriba sobre por qué esto soluciona la
    // condición de carrera real (no solo `samplingActive`).
    isCapturing.current = true;
    setLoading(true);
    setResult(null);
    // Pausar el muestreo de calidad en vivo mientras dura la captura real:
    // dos llamadas simultáneas a takePictureAsync sobre la misma cámara
    // pueden fallar o interferir entre sí en algunos dispositivos.
    samplingActive.current = true;
    if (samplingTimer.current) clearTimeout(samplingTimer.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
      });
      if (!photo) throw new Error("no photo");

      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 700 } }],
        { format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!resized.base64) throw new Error("no base64");

      const frame = await decodeBase64(resized.base64);

      // Segunda validación de calidad, ahora sobre la foto REAL en su
      // resolución de trabajo — defensa adicional aunque el muestreo en
      // vivo ya haya dado luz verde (las condiciones pueden cambiar en
      // el instante entre el último muestreo y la captura).
      const finalQualityCheck = analyzeImageQuality(
        frame.gray,
        frame.width,
        frame.height,
        detectionMode,
        calibration[detectionMode],
      );
      if (!finalQualityCheck.ok) {
        setQuality(finalQualityCheck);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          t(lang, "qualityBlockedTitle"),
          t(lang, finalQualityCheck.messageKey),
        );
        return;
      }

      // ── Bifurcación según el motor de detección activo ──
      //
      // El chequeo de calidad de arriba ya corrió igual para ambos modos
      // (independiente del motor — ahorra una llamada a Gemini con una
      // foto que de todas formas no sería confiable). A partir de aquí
      // cada motor sigue su propio camino; ver `captureWithGemini` para
      // el razonamiento de por qué el modo Gemini no valida geometría.
      if (detectionMode === "gemini") {
        await captureWithGemini(frame, resized);
        return;
      }

      // ── Validación geométrica con los 4 marcadores + recorte real ──
      //
      // Antes de procesar puntos, se verifica que el encuadre real
      // coincida con lo que los marcadores fijos en pantalla indicaban
      // (línea divisoria donde se esperaba, al menos una ficha contada).
      // Esto detecta encuadres mal alineados ANTES de que el detector de
      // puntos intente adivinar sobre una imagen geométricamente
      // inconsistente y produzca un resultado silenciosamente incorrecto.
      //
      // Además, cuando el layout es válido, se RECORTA el buffer de
      // píxeles real a la región que efectivamente contiene fichas
      // (`startX` a `blockEndX`, `topY` a `bottomY`) antes de pasarlo al
      // detector de puntos — reduce el ruido de PROCESAMIENTO real (menos
      // píxeles de mesa vacía que el algoritmo de puntos tiene que
      // considerar), no solo el ruido visual que ya recortaba el overlay
      // de marcadores en pantalla.
      //
      // Por defecto (sin marcadores o sin layout válido) se sigue
      // procesando el frame completo, igual que antes — el recorte es una
      // mejora adicional, no un requisito para que el flujo funcione.
      //
      // EFECTO ESPERADO SOBRE LOS UMBRALES DE ÁREA DE `dotDetection.ts`
      // (razonamiento, no verificado todavía con datos reales): esa
      // función calcula su rango de área válida de un blob (mínimo/máximo
      // para contar como "punto") como una FRACCIÓN del área total de la
      // imagen recibida. Al recortar a solo el bloque real de fichas, esa
      // área total deja de incluir mesa vacía variable (que antes diluía
      // el cálculo de forma distinta según cuántas fichas hubiera), así
      // que el rango de área debería volverse más representativo del
      // tamaño real de un punto, no menos preciso — pero esto no se ha
      // confirmado con un caso de prueba que compare el mismo escenario
      // recortado vs. sin recortar, así que se trata como una expectativa
      // razonada, no un hecho validado.
      let detectionGray: Uint8ClampedArray | Uint8Array = frame.gray;
      let detectionWidth = frame.width;
      let detectionHeight = frame.height;

      if (markerGeometry) {
        const mapped = mapMarkersToFrame(
          markerGeometry,
          frame.width,
          frame.height,
        );
        if (mapped) {
          // Se calcula una binarización propia aquí (sin blur gaussiano)
          // en vez de reutilizar la que `detectDominoDotsFromGray` hace
          // internamente más abajo: esa otra binarización aplica blur
          // antes de Otsu, optimizado para aislar puntos circulares
          // pequeños. Para encontrar la línea divisoria (un trazo fino y
          // recto) el blur no aporta y podría incluso difuminar su borde;
          // se usa Otsu directo sobre la imagen sin suavizar. No es
          // redundancia accidental — son dos binarizaciones con propósitos
          // distintos.
          const grayArr = Uint8Array.from(frame.gray as ArrayLike<number>);
          const threshold = otsuThreshold(grayArr);
          const binary = new Uint8Array(grayArr.length);
          for (let i = 0; i < grayArr.length; i++)
            binary[i] = grayArr[i] < threshold ? 1 : 0;

          const layout = detectTileLayout(
            grayArr,
            binary,
            frame.width,
            mapped.startX,
            mapped.topY,
            mapped.dividerY,
            mapped.bottomY,
            {
              minLineCoverage: calibration.marker.minLineCoverage,
              maxThicknessRatio: calibration.marker.maxThicknessRatio,
              dividerToleranceRatio: calibration.marker.dividerToleranceRatio,
            },
          );

          if ("reason" in layout) {
            const messageKey: Record<
              TileLayoutFailureReason,
              Parameters<typeof t>[1]
            > = {
              divider_not_found: "layoutDividerNotFound",
              zero_tiles_counted: "layoutZeroTiles",
            };
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            Alert.alert(
              t(lang, "layoutMismatchTitle"),
              t(lang, messageKey[layout.reason]),
            );
            return;
          }

          const cropped = cropGrayBuffer(
            grayArr,
            frame.width,
            frame.height,
            Math.round(layout.startX),
            Math.round(layout.topY),
            Math.round(layout.blockEndX),
            Math.round(layout.bottomY),
          );
          if (cropped) {
            detectionGray = cropped.gray;
            detectionWidth = cropped.width;
            detectionHeight = cropped.height;
          }
        }
      }

      const det = detectDominoDotsFromGray(
        detectionGray,
        detectionWidth,
        detectionHeight,
      );
      const identified = identifyTiles(det, detectionWidth, detectionHeight);

      setResult({
        tiles: det.tilesFound,
        total: identified.totalPoints,
        confidence: det.confidence,
        uri: resized.uri,
        breakdown: identified.tiles,
        allMatched: identified.allMatched,
        mode: "local",
      });
      Haptics.notificationAsync(
        identified.totalPoints > 0 || identified.tiles.length > 0
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
    } catch (e) {
      console.error("capture error", e);
      Alert.alert("Error", String(e));
    } finally {
      setLoading(false);
      samplingActive.current = false;
      isCapturing.current = false;
      setCaptureAttempt((n) => n + 1);
    }
  };

  const assign = (playerIdx: 0 | 1) => {
    if (!result) return;
    addPoints(playerIdx, result.total, "camera");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setResult(null);
    setQuality(null);
    router.replace("/");
  };

  const retry = () => {
    setResult(null);
    setQuality(null);
  };

  // ── Panel de diagnóstico de calibración ──
  //
  // Construye las filas a partir de las métricas YA calculadas en cada
  // ciclo de muestreo (`quality.metrics`) — no agrega ningún cómputo
  // nuevo, solo expone lo que `analyzeImageQuality` ya mide pero que
  // hasta ahora solo se usaba internamente para decidir ok/no-ok, nunca
  // se mostraba en números.
  const diagProfileCal = calibration[detectionMode];
  const m = quality?.metrics ?? null;
  const fmt = (v: number, d: number) => v.toFixed(d);
  const diagRows: DiagRowSpec[] = [
    {
      calKey: "minMeanBrightness",
      label: t(lang, "calMinBrightness"),
      metricValue: m?.meanBrightness ?? null,
      metricDisplay: m ? fmt(m.meanBrightness, 0) : "—",
      thresholdDisplay: `≥ ${diagProfileCal.minMeanBrightness}`,
      pass: m ? m.meanBrightness >= diagProfileCal.minMeanBrightness : null,
      decimals: 0,
      margin: 10,
      kind: "min",
    },
    {
      calKey: "maxMeanBrightness",
      label: t(lang, "calMaxBrightness"),
      metricValue: m?.meanBrightness ?? null,
      metricDisplay: m ? fmt(m.meanBrightness, 0) : "—",
      thresholdDisplay: `≤ ${diagProfileCal.maxMeanBrightness}`,
      pass: m ? m.meanBrightness <= diagProfileCal.maxMeanBrightness : null,
      decimals: 0,
      margin: 10,
      kind: "max",
    },
    {
      calKey: "maxDarkRatio",
      label: t(lang, "calMaxDark"),
      metricValue: m?.darkRatio ?? null,
      metricDisplay: m ? fmt(m.darkRatio, 2) : "—",
      thresholdDisplay: `≤ ${diagProfileCal.maxDarkRatio.toFixed(2)}`,
      pass: m ? m.darkRatio <= diagProfileCal.maxDarkRatio : null,
      decimals: 2,
      margin: 0.05,
      kind: "max",
    },
    {
      calKey: "maxSaturatedRatio",
      label: t(lang, "calMaxSaturated"),
      metricValue: m?.saturatedRatio ?? null,
      metricDisplay: m ? fmt(m.saturatedRatio, 2) : "—",
      thresholdDisplay: `≤ ${diagProfileCal.maxSaturatedRatio.toFixed(2)}`,
      pass: m ? m.saturatedRatio <= diagProfileCal.maxSaturatedRatio : null,
      decimals: 2,
      margin: 0.05,
      kind: "max",
    },
    {
      calKey: "minSharpness",
      label: t(lang, "calMinSharpness"),
      metricValue: m?.sharpness ?? null,
      metricDisplay: m ? fmt(m.sharpness, 1) : "—",
      thresholdDisplay: `≥ ${diagProfileCal.minSharpness.toFixed(1)}`,
      pass: m ? m.sharpness >= diagProfileCal.minSharpness : null,
      decimals: 1,
      margin: 0.5,
      kind: "min",
    },
  ];
  // Sombra desigual y contraste solo se evalúan en el perfil local (ver
  // razonamiento en imageQuality.ts) — mostrarlas en modo Gemini sería
  // mostrar números que no tienen ningún efecto real en esa decisión.
  if (detectionMode === "local") {
    diagRows.push(
      {
        calKey: "minContrastRange",
        label: t(lang, "calMinContrast"),
        metricValue: m?.contrastRange ?? null,
        metricDisplay: m ? fmt(m.contrastRange, 0) : "—",
        thresholdDisplay: `≥ ${calibration.local.minContrastRange}`,
        pass: m
          ? m.contrastRange >= calibration.local.minContrastRange
          : null,
        decimals: 0,
        margin: 5,
        kind: "min",
      },
      {
        calKey: "maxShadowUnevenness",
        label: t(lang, "calMaxShadow"),
        metricValue: m?.shadowUnevenness ?? null,
        metricDisplay: m ? fmt(m.shadowUnevenness, 0) : "—",
        thresholdDisplay: `≤ ${calibration.local.maxShadowUnevenness}`,
        pass: m
          ? m.shadowUnevenness <= calibration.local.maxShadowUnevenness
          : null,
        decimals: 0,
        margin: 10,
        kind: "max",
      },
    );
  }

  const applyDiagRow = (row: DiagRowSpec) => {
    if (row.metricValue === null) return;
    // El margen de seguridad es deliberado: fijar el umbral EXACTAMENTE
    // en el valor medido ahora dejaría la condición actual justo al
    // límite — cualquier variación mínima (la mano se mueve, una nube
    // pasa) volvería a bloquear. El margen da un colchón real.
    const raw =
      row.kind === "min"
        ? row.metricValue - row.margin
        : row.metricValue + row.margin;
    const factor = Math.pow(10, row.decimals);
    const rounded = Math.round(raw * factor) / factor;
    setQualityCalibrationValue(
      row.calKey === "minContrastRange" || row.calKey === "maxShadowUnevenness"
        ? "local"
        : detectionMode,
      row.calKey,
      rounded,
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // ── Indicador de calidad: color + mensaje ──
  const qualityColor = !quality
    ? theme.textMuted
    : quality.ok
      ? theme.success
      : theme.team2;
  const qualityMessage = !quality
    ? t(lang, "qualityChecking")
    : t(lang, quality.messageKey);

  return (
    <SafeAreaView style={s.safe}>
      {/* WebView oculto para decodificación de píxeles — invisible */}
      <WebView
        ref={webViewRef}
        style={{ width: 1, height: 1, position: "absolute", opacity: 0 }}
        source={{ html: DECODER_HTML }}
        onMessage={onWebViewMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        androidLayerType="software"
        onError={(e) => console.warn("webview error", e.nativeEvent)}
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
            <View
              style={s.camWrap}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setCamLayout({ width, height });
              }}
            >
              <CameraView ref={cameraRef} style={s.cam} facing={facing}>
                {markerGeometry && (
                  <View style={s.markerOverlay} pointerEvents="none">
                    {detectionMode === "gemini" ? (
                      // Modo Gemini: un solo recuadro simple, sin línea
                      // divisoria ni exigencia de alineación pixel-perfecta
                      // (decisión de producto confirmada) — solo ayuda a
                      // encuadrar y define la región que se recorta antes
                      // de enviarla a la API.
                      <View
                        style={[
                          s.markerBox,
                          {
                            left: markerGeometry.startX,
                            top: markerGeometry.topY,
                            width: markerGeometry.rectWidthPx,
                            height: markerGeometry.tileHeightPx,
                            borderColor: quality
                              ? qualityColor
                              : "rgba(255,255,255,0.6)",
                          },
                        ]}
                      />
                    ) : (
                      <>
                        {/* Marcador de inicio (vertical, borde izquierdo) */}
                        <View
                          style={[
                            s.markerVertical,
                            {
                              left: markerGeometry.startX,
                              top: markerGeometry.topY,
                              height: markerGeometry.tileHeightPx,
                              width: markerGeometry.lineWidthPx,
                              backgroundColor: quality
                                ? qualityColor
                                : "rgba(255,255,255,0.6)",
                            },
                          ]}
                        />
                        {/* Marcador superior */}
                        <View
                          style={[
                            s.markerHorizontal,
                            {
                              left: markerGeometry.startX,
                              top: markerGeometry.topY,
                              width: markerGeometry.rectWidthPx,
                              height: markerGeometry.lineWidthPx,
                              backgroundColor: quality
                                ? qualityColor
                                : "rgba(255,255,255,0.6)",
                            },
                          ]}
                        />
                        {/* Marcador divisor (caras de cada ficha) */}
                        <View
                          style={[
                            s.markerHorizontal,
                            {
                              left: markerGeometry.startX,
                              top: markerGeometry.dividerY,
                              width: markerGeometry.rectWidthPx,
                              height: markerGeometry.lineWidthPx,
                              backgroundColor: quality
                                ? qualityColor
                                : "rgba(255,255,255,0.6)",
                            },
                          ]}
                        />
                        {/* Marcador inferior */}
                        <View
                          style={[
                            s.markerHorizontal,
                            {
                              left: markerGeometry.startX,
                              top: markerGeometry.bottomY,
                              width: markerGeometry.rectWidthPx,
                              height: markerGeometry.lineWidthPx,
                              backgroundColor: quality
                                ? qualityColor
                                : "rgba(255,255,255,0.6)",
                            },
                          ]}
                        />
                      </>
                    )}
                  </View>
                )}
              </CameraView>
            </View>

            {/* Control de escala — ajusta cuántas fichas espera el
                encuadre, sin necesitar zoom de cámara real. Los
                marcadores nunca desaparecen; solo cambian de tamaño. */}
            <View style={s.scaleControl}>
              <Text style={s.scaleLabel}>{t(lang, "tileScaleLabel")}</Text>
              <View style={s.scaleStepper}>
                <TouchableOpacity
                  style={s.scaleBtn}
                  onPress={() => setTileScaleLevel((l) => Math.max(0, l - 1))}
                  disabled={tileScaleLevel === 0}
                >
                  <Ionicons
                    name="remove"
                    size={18}
                    color={tileScaleLevel === 0 ? theme.textMuted : theme.text}
                  />
                </TouchableOpacity>
                <View style={s.scaleDots}>
                  {Array.from({ length: TILE_SCALE_LEVELS }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        s.scaleDot,
                        {
                          backgroundColor:
                            i === tileScaleLevel ? theme.accent : theme.border,
                        },
                      ]}
                    />
                  ))}
                </View>
                <TouchableOpacity
                  style={s.scaleBtn}
                  onPress={() =>
                    setTileScaleLevel((l) =>
                      Math.min(TILE_SCALE_LEVELS - 1, l + 1),
                    )
                  }
                  disabled={tileScaleLevel === TILE_SCALE_LEVELS - 1}
                >
                  <Ionicons
                    name="add"
                    size={18}
                    color={
                      tileScaleLevel === TILE_SCALE_LEVELS - 1
                        ? theme.textMuted
                        : theme.text
                    }
                  />
                </TouchableOpacity>
              </View>
              <Text style={s.scaleHint}>
                {tileScaleLevel === 0
                  ? t(lang, "tileScaleFew")
                  : tileScaleLevel === TILE_SCALE_LEVELS - 1
                    ? t(lang, "tileScaleMany")
                    : t(lang, "tileScaleMid")}
              </Text>
            </View>

            {/* Indicador de calidad en tiempo real */}
            <View style={[s.qualityBar, { borderColor: qualityColor }]}>
              <View style={[s.qualityDot, { backgroundColor: qualityColor }]} />
              <Text
                style={[s.qualityTxt, { color: qualityColor }]}
                numberOfLines={2}
              >
                {qualityMessage}
              </Text>
              {sampling && (
                <ActivityIndicator size="small" color={qualityColor} />
              )}
              <TouchableOpacity
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowDiagnostics((v) => !v);
                }}
                style={{ padding: 4 }}
              >
                <Ionicons
                  name="speedometer-outline"
                  size={18}
                  color={showDiagnostics ? theme.accent : theme.textMuted}
                />
              </TouchableOpacity>
            </View>

            {/* Panel de diagnóstico — TEMPORAL, herramienta de
                calibración para desarrollo, no para el usuario final (ver
                conversación de diseño: la calibración fina con 13 números
                técnicos no es algo que deba quedar expuesto en producción,
                esto es para resolver "no sé qué valor poner" mientras se
                ajusta en campo). Muestra el valor REAL medido ahora mismo
                junto al umbral configurado — calibrar viendo números
                reales en vez de adivinar con los +/- de Settings. */}
            {showDiagnostics && (
              <View
                style={{
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.cardAlt,
                }}
              >
                <Text
                  style={{ fontSize: 11, color: theme.textMuted, marginBottom: 6 }}
                >
                  {t(lang, "diagIntro")}
                </Text>
                {diagRows.map((row) => (
                  <DiagRow
                    key={row.calKey + row.kind}
                    theme={theme}
                    row={row}
                    onApply={applyDiagRow}
                  />
                ))}
              </View>
            )}

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

            {/* Botón de captura — deshabilitado mientras la calidad no sea apta */}
            <TouchableOpacity
              style={[
                s.capBtn,
                {
                  backgroundColor: canCapture ? theme.accent : theme.textMuted,
                  opacity: loading ? 0.7 : canCapture ? 1 : 0.5,
                },
              ]}
              onPress={capture}
              disabled={loading || !canCapture}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons
                  name={canCapture ? "scan-outline" : "lock-closed-outline"}
                  size={22}
                  color="#fff"
                />
              )}
              <Text style={s.capTxt}>
                {loading
                  ? t(lang, "analyzing")
                  : canCapture
                    ? t(lang, "detectPoints")
                    : t(lang, "qualityWaitingGood")}
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

            {/* Result cards — ahora ambos modos devuelven conteo de
                fichas real (Gemini también, desde que devuelve desglose
                por ficha), así que la tarjeta ya no depende del modo. */}
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

            {/* Desglose ficha por ficha — permite al usuario verificar el
                resultado en vez de confiar ciegamente en un número global */}
            {result.breakdown.length > 0 && (
              <View style={s.breakdownCard}>
                <Text style={s.breakdownTitle}>{t(lang, "tileBreakdown")}</Text>
                <View style={s.breakdownGrid}>
                  {result.breakdown.map((tile, i) => {
                    const isUnsure =
                      !tile.matched || tile.left == null || tile.right == null;
                    return (
                      <View
                        key={i}
                        style={[
                          s.tileChip,
                          {
                            borderColor: isUnsure ? theme.team2 : theme.border,
                            backgroundColor: isUnsure
                              ? theme.team2 + "15"
                              : theme.cardAlt,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            s.tileChipTxt,
                            { color: isUnsure ? theme.team2 : theme.text },
                          ]}
                        >
                          {tile.left ?? "?"}-{tile.right ?? "?"}
                        </Text>
                        {isUnsure && (
                          <Ionicons
                            name="alert-circle"
                            size={12}
                            color={theme.team2}
                          />
                        )}
                      </View>
                    );
                  })}
                </View>
                {!result.allMatched && (
                  <Text style={s.breakdownWarning}>
                    {t(lang, "tileBreakdownWarning")}
                  </Text>
                )}
              </View>
            )}

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

            <TouchableOpacity style={s.retry} onPress={retry}>
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
    markerOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    markerVertical: {
      position: "absolute",
      borderRadius: 1,
    },
    markerHorizontal: {
      position: "absolute",
      borderRadius: 1,
    },
    markerBox: {
      position: "absolute",
      borderRadius: 14,
      borderWidth: 2.5,
      backgroundColor: "transparent",
    },
    scaleControl: {
      alignItems: "center",
      gap: 6,
      paddingVertical: 4,
    },
    scaleLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: t.textMuted,
      letterSpacing: 0.3,
    },
    scaleStepper: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    scaleBtn: {
      width: 32,
      height: 32,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
      alignItems: "center",
      justifyContent: "center",
    },
    scaleDots: {
      flexDirection: "row",
      gap: 6,
    },
    scaleDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    scaleHint: {
      fontSize: 11,
      color: t.textMuted,
      textAlign: "center",
    },
    qualityBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1.5,
      backgroundColor: t.card,
    },
    qualityDot: { width: 8, height: 8, borderRadius: 4 },
    qualityTxt: { flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 17 },
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
    tipRow: { flexDirection: "row", alignItems: "center", gap: 10 },
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
    breakdownCard: {
      backgroundColor: t.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      gap: 10,
      marginBottom: 14,
    },
    breakdownTitle: {
      fontSize: 12,
      fontWeight: "600",
      color: t.textMuted,
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    breakdownGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tileChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
    },
    tileChipTxt: { fontSize: 14, fontWeight: "700" },
    breakdownWarning: { fontSize: 12, color: t.textMuted, lineHeight: 17 },
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
