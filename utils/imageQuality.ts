/**
 * imageQuality.ts
 *
 * Analiza la calidad de la imagen ANTES de permitir el cálculo de puntos,
 * para evitar conteos falsos que dañen la credibilidad de la app.
 *
 * Todo es matemático sobre el histograma de luminancia (escala de grises),
 * sin modelos de IA, 100% offline. Pensado para correr sobre frames de baja
 * resolución (ej. 80x60) cada ~400-600ms mientras el usuario apunta la cámara,
 * y también sobre la foto final justo antes de procesarla.
 *
 * Problemas que detecta:
 *  1. Poca luz (subexposición): media de brillo muy baja.
 *  2. Exceso de luz / reflejos (sobreexposición): media muy alta o
 *     porcentaje grande de píxeles saturados (255).
 *  3. Sombra parcial / iluminación desigual: la imagen se divide en una
 *     cuadrícula (ej. 4x3) y se compara el brillo medio de cada celda;
 *     si la diferencia entre la celda más oscura y la más clara es muy
 *     grande, hay sombra proyectada sobre parte de las fichas.
 *  4. Bajo contraste: el rango dinámico (percentil 95 - percentil 5) es
 *     muy estrecho, lo que indica que los puntos no se distinguirán bien
 *     del fondo (por ejemplo, niebla, vidrio empañado, desenfoque fuerte).
 *  5. Imagen borrosa (desenfoque): varianza de un operador tipo Laplaciano
 *     muy baja indica falta de bordes nítidos.
 */

export type QualityIssue =
  | "low_light"
  | "overexposed"
  | "uneven_shadow"
  | "low_contrast"
  | "blurry"
  | "invalid_data"
  | "none";

export type QualityMessageKey =
  | "qualityLowLight"
  | "qualityOverexposed"
  | "qualityUnevenShadow"
  | "qualityLowContrast"
  | "qualityBlurry"
  | "qualityInvalidData"
  | "qualityGood";

export interface QualityReport {
  ok: boolean;
  issue: QualityIssue;
  /** Mensaje corto listo para mostrar al usuario (clave de i18n, no texto fijo) */
  messageKey: QualityMessageKey;
  /** Métricas crudas, útiles para debugging o ajuste fino */
  metrics: {
    meanBrightness: number; // 0-255
    saturatedRatio: number; // 0-1, % de píxeles en 250-255
    darkRatio: number; // 0-1, % de píxeles en 0-5
    contrastRange: number; // percentil95 - percentil5, 0-255
    shadowUnevenness: number; // diferencia max entre celdas, 0-255
    sharpness: number; // varianza del laplaciano aproximado
  };
}

// ─── Umbrales (ajustables según pruebas de campo) ───────────────────────────
const THRESH = {
  minMeanBrightness: 60, // por debajo de esto: muy oscuro
  maxMeanBrightness: 225, // por encima de esto: muy claro / lavado
  maxSaturatedRatio: 0.12, // más del 12% de píxeles "quemados" → reflejo/exceso de luz
  maxDarkRatio: 0.35, // más del 35% de píxeles casi negros → poca luz general
  minContrastRange: 45, // rango dinámico mínimo aceptable
  maxShadowUnevenness: 70, // diferencia de brillo entre zonas de la imagen
  minSharpness: 4, // varianza mínima del laplaciano (anti-borroso)
};

/**
 * Analiza un frame en escala de grises (1 byte por píxel) y determina
 * si la imagen es apta para el cálculo de puntos.
 */
export function analyzeImageQuality(
  gray: Uint8Array | Uint8ClampedArray | number[],
  width: number,
  height: number,
): QualityReport {
  const arr =
    gray instanceof Uint8Array || gray instanceof Uint8ClampedArray
      ? gray
      : Uint8Array.from(gray);

  const n = arr.length;
  if (n === 0 || width <= 0 || height <= 0) {
    return emptyReport();
  }

  // ── 1. Histograma y estadísticas básicas ──
  const hist = new Array(256).fill(0);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    hist[arr[i]]++;
    sum += arr[i];
  }
  const meanBrightness = sum / n;

  let darkCount = 0;
  for (let v = 0; v <= 5; v++) darkCount += hist[v];
  const darkRatio = darkCount / n;

  let satCount = 0;
  for (let v = 250; v <= 255; v++) satCount += hist[v];
  const saturatedRatio = satCount / n;

  // Percentiles 5 y 95 para el rango de contraste (más robusto que min/max)
  const p5 = percentileFromHist(hist, n, 0.05);
  const p95 = percentileFromHist(hist, n, 0.95);
  const contrastRange = p95 - p5;

  // ── 2. Iluminación desigual / sombra parcial ──
  // Dividimos la imagen en una cuadrícula 4x3 y medimos el brillo promedio
  // de cada celda. Si alguna celda es mucho más oscura que el resto,
  // hay una sombra cubriendo parte del área de las fichas.
  const shadowUnevenness = computeShadowUnevenness(arr, width, height, 4, 3);

  // ── 3. Nitidez (detección de desenfoque) ──
  const sharpness = computeSharpness(arr, width, height);

  const metrics = {
    meanBrightness,
    saturatedRatio,
    darkRatio,
    contrastRange,
    shadowUnevenness,
    sharpness,
  };

  // ── 4. Decisión: se evalúan en orden de prioridad práctica ──
  if (
    meanBrightness < THRESH.minMeanBrightness ||
    darkRatio > THRESH.maxDarkRatio
  ) {
    return {
      ok: false,
      issue: "low_light",
      messageKey: "qualityLowLight",
      metrics,
    };
  }

  if (
    meanBrightness > THRESH.maxMeanBrightness ||
    saturatedRatio > THRESH.maxSaturatedRatio
  ) {
    return {
      ok: false,
      issue: "overexposed",
      messageKey: "qualityOverexposed",
      metrics,
    };
  }

  if (shadowUnevenness > THRESH.maxShadowUnevenness) {
    return {
      ok: false,
      issue: "uneven_shadow",
      messageKey: "qualityUnevenShadow",
      metrics,
    };
  }

  if (contrastRange < THRESH.minContrastRange) {
    return {
      ok: false,
      issue: "low_contrast",
      messageKey: "qualityLowContrast",
      metrics,
    };
  }

  if (sharpness < THRESH.minSharpness) {
    return { ok: false, issue: "blurry", messageKey: "qualityBlurry", metrics };
  }

  return { ok: true, issue: "none", messageKey: "qualityGood", metrics };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function emptyReport(): QualityReport {
  // IMPORTANTE: este caso (buffer vacío o dimensiones inválidas) es
  // distinto de un problema real de iluminación — antes se reportaba
  // como "low_light", lo cual hacía indistinguible para el usuario (y
  // para cualquiera diagnosticando el problema) un fallo real de luz de
  // un fallo silencioso aguas arriba en la cadena de captura/decode (por
  // ejemplo, si el WebView nunca llega a decodificar la imagen). Usar un
  // issue distintivo aquí permite detectar ese caso en los logs sin
  // confundirlo con mala iluminación real.
  return {
    ok: false,
    issue: "invalid_data",
    messageKey: "qualityInvalidData",
    metrics: {
      meanBrightness: 0,
      saturatedRatio: 0,
      darkRatio: 1,
      contrastRange: 0,
      shadowUnevenness: 0,
      sharpness: 0,
    },
  };
}

function percentileFromHist(hist: number[], total: number, p: number): number {
  const target = total * p;
  let cum = 0;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= target) return v;
  }
  return 255;
}

/**
 * Divide la imagen en cols x rows celdas, calcula el brillo medio de cada
 * una y devuelve la diferencia entre la celda más oscura y la más clara.
 * Un valor alto indica iluminación desigual (sombra proyectada).
 */
function computeShadowUnevenness(
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  cols: number,
  rows: number,
): number {
  const cellMeans: number[] = [];
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  if (cellW < 1 || cellH < 1) return 0;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let sum = 0;
      let count = 0;
      const x0 = cx * cellW;
      const y0 = cy * cellH;
      const x1 = cx === cols - 1 ? width : x0 + cellW;
      const y1 = cy === rows - 1 ? height : y0 + cellH;
      for (let y = y0; y < y1; y++) {
        const rowOff = y * width;
        for (let x = x0; x < x1; x++) {
          sum += gray[rowOff + x];
          count++;
        }
      }
      if (count > 0) cellMeans.push(sum / count);
    }
  }
  if (cellMeans.length === 0) return 0;
  return Math.max(...cellMeans) - Math.min(...cellMeans);
}

/**
 * Aproxima la nitidez de la imagen mediante la varianza de un filtro
 * Laplaciano simplificado (detección de bordes). Imágenes borrosas
 * tienen bordes suaves → varianza baja.
 *
 * Para frames pequeños (recomendado para el chequeo en vivo) esto es
 * muy rápido. Se usa un muestreo (stride) en imágenes grandes para
 * mantener el costo bajo.
 */
function computeSharpness(
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) return 0;

  // Para imágenes grandes, muestreamos cada `stride` píxeles para no
  // recorrer todo el frame completo en cada chequeo en vivo.
  const targetSamples = 4000;
  const totalPixels = (width - 2) * (height - 2);
  const stride = Math.max(
    1,
    Math.floor(Math.sqrt(totalPixels / targetSamples)),
  );

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += stride) {
    const rowOff = y * width;
    const rowOffUp = (y - 1) * width;
    const rowOffDown = (y + 1) * width;
    for (let x = 1; x < width - 1; x += stride) {
      const center = gray[rowOff + x];
      const lap =
        4 * center -
        gray[rowOff + x - 1] -
        gray[rowOff + x + 1] -
        gray[rowOffUp + x] -
        gray[rowOffDown + x];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return Math.max(0, variance) / 100; // escalado a un rango más cómodo para el umbral
}

/**
 * Downscale rápido de un buffer en escala de grises (nearest-neighbor),
 * útil para reducir un frame de la cámara a una resolución pequeña
 * (ej. 80x60) antes de analizar calidad en tiempo real, manteniendo el
 * costo de cómputo bajo en cada tick del loop en vivo.
 */
export function downscaleGray(
  gray: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y * yRatio));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * xRatio));
      out[y * dstW + x] = gray[sy * srcW + sx];
    }
  }
  return out;
}
