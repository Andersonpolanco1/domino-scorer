/**
 * Domino dot detection — computer vision, 100% offline.
 * Works on iOS and Android via React Native.
 *
 * Pipeline (todo matemático, sin modelos de IA):
 *   1. RGBA → escala de grises (luminancia).
 *   2. Blur gaussiano 5×5 (reducción de ruido).
 *   3. Umbral de Otsu (adaptativo — funciona con cualquier color de ficha).
 *   4. Binarización (puntos oscuros = 1).
 *   5. Componentes conectados (flood fill) → blobs candidatos.
 *   6. Filtro por área (descarta ruido y manchas grandes que no son puntos).
 *   7. Filtro por circularidad (descarta líneas, bordes, texto grabado).
 *   8. Clustering espacial → agrupa puntos cercanos en fichas individuales.
 *   9. División de grupos sospechosamente grandes (fichas pegadas que el
 *      clustering fusionó por error).
 *
 * NOTA IMPORTANTE:
 *   decodeToPixels debe recibir píxeles RGBA reales (de un canvas/WebView,
 *   no bytes JPEG crudos sin decodificar — los bytes JPEG están comprimidos
 *   con Huffman/DCT y NO representan valores de píxel directamente).
 */

export interface DetectionResult {
  totalDots: number;
  tilesFound: number;
  confidence: "high" | "medium" | "low";
  dotCentroids: { x: number; y: number; circularity?: number }[];
  /** Cada sub-array contiene índices hacia dotCentroids que pertenecen a la misma ficha */
  tileGroups: number[][];
}

/**
 * Función principal de entrada cuando se tienen píxeles RGBA reales
 * (decodificados por un canvas, no bytes JPEG crudos).
 */
export function detectDominoDotsFromPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): DetectionResult {
  const gray = toGrayscale(pixels, width, height);
  return detectDominoDotsFromGray(gray, width, height);
}

/**
 * Punto de entrada cuando ya se tiene un buffer en escala de grises
 * (1 valor por píxel, 0–255). El decodificador WebView ya hace esta
 * conversión para minimizar el tamaño del payload JSON.
 */
export function detectDominoDotsFromGray(
  gray: Uint8ClampedArray | Uint8Array | number[],
  width: number,
  height: number,
): DetectionResult {
  const grayArr =
    gray instanceof Uint8Array
      ? gray
      : Uint8Array.from(gray as ArrayLike<number>);

  // 2. Blur gaussiano 5×5
  const blurred = gaussianBlur5(grayArr, width, height);

  // 3. Umbral de Otsu
  const threshold = otsuThreshold(blurred);

  // 4. Binarización: píxeles oscuros = 1
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < blurred.length; i++) {
    binary[i] = blurred[i] < threshold ? 1 : 0;
  }

  // 5. Componentes conectados
  const { labels, componentSizes, nextLabel } = connectedComponents(
    binary,
    width,
    height,
  );

  // 6. Filtro por área — los puntos de una ficha son pequeños:
  //    típicamente entre 0.005% y 0.4% del área total de la imagen.
  const imageArea = width * height;
  const minArea = Math.max(8, Math.floor(imageArea * 0.00005));
  const maxArea = Math.floor(imageArea * 0.004);

  const validLabels = new Set<number>();
  for (let l = 1; l < nextLabel; l++) {
    const sz = componentSizes[l];
    if (sz >= minArea && sz <= maxArea) validLabels.add(l);
  }

  if (validLabels.size === 0) {
    return {
      totalDots: 0,
      tilesFound: 0,
      confidence: "low",
      dotCentroids: [],
      tileGroups: [],
    };
  }

  // 7. Centroides + bounding boxes → circularidad
  const sums: Record<number, { sx: number; sy: number; n: number }> = {};
  for (const l of validLabels) sums[l] = { sx: 0, sy: 0, n: 0 };

  const bbox: Record<
    number,
    { minX: number; maxX: number; minY: number; maxY: number }
  > = {};
  for (const l of validLabels)
    bbox[l] = { minX: width, maxX: 0, minY: height, maxY: 0 };

  for (let i = 0; i < width * height; i++) {
    const l = labels[i];
    if (!validLabels.has(l)) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    sums[l].sx += x;
    sums[l].sy += y;
    sums[l].n++;
    const b = bbox[l];
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }

  const dotCentroids = Array.from(validLabels).map((l) => {
    const b = bbox[l];
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const fill = sums[l].n / (bw * bh);
    const aspect = Math.min(bw, bh) / Math.max(bw, bh);
    return {
      x: sums[l].sx / sums[l].n,
      y: sums[l].sy / sums[l].n,
      circularity: fill * aspect,
    };
  });

  // 8. Filtro de circularidad — conserva blobs redondos (puntos),
  //    rechaza líneas, bordes, texto grabado en la ficha.
  const circularDots = dotCentroids.filter((d) => (d.circularity ?? 0) > 0.45);
  const finalDots = circularDots.length >= 1 ? circularDots : dotCentroids;

  // 9. Clustering espacial → agrupa puntos en fichas individuales.
  //    7% del lado más corto suele separar bien fichas adyacentes pegadas.
  const shortSide = Math.min(width, height);
  const groupDist = shortSide * 0.07;
  const rawGroups = clusterByDistance(finalDots, groupDist);

  // 10. Una ficha de dominó tiene como máximo 6 puntos por mitad (12 en total).
  //     Si un grupo excede ese máximo, probablemente el clustering fusionó
  //     dos fichas adyacentes — se separa por la mediana del eje más largo.
  const tileGroups = splitLargeGroups(rawGroups, finalDots, 12);

  // 11. Confianza global del resultado
  const totalDots = finalDots.length;
  let confidence: "high" | "medium" | "low" = "low";
  if (tileGroups.length >= 1 && totalDots <= 56) confidence = "medium";
  if (tileGroups.length >= 1 && totalDots >= 1 && totalDots <= 42)
    confidence = "high";

  return {
    totalDots,
    tilesFound: tileGroups.length,
    confidence,
    dotCentroids: finalDots,
    tileGroups,
  };
}

// ─── Image processing helpers ────────────────────────────────────────────────

function toGrayscale(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = Math.round(
      0.299 * pixels[i * 4] +
        0.587 * pixels[i * 4 + 1] +
        0.114 * pixels[i * 4 + 2],
    );
  }
  return gray;
}

/** Blur gaussiano 5×5 — mejor reducción de ruido que un 3×3 en fotos reales de cámara */
function gaussianBlur5(
  gray: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const k = [
    2, 4, 5, 4, 2, 4, 9, 12, 9, 4, 5, 12, 15, 12, 5, 4, 9, 12, 9, 4, 2, 4, 5, 4,
    2,
  ];
  const kSum = 159;
  const out = new Uint8Array(width * height);
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      let s = 0,
        ki = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          s += gray[(y + dy) * width + (x + dx)] * k[ki++];
        }
      }
      out[y * width + x] = Math.round(s / kSum);
    }
  }
  return out;
}

/**
 * Calcula el umbral de Otsu para una imagen en escala de grises —
 * exportada para reutilización en otros módulos que necesiten binarizar
 * la misma imagen de forma consistente con `detectDominoDotsFromGray`
 * (por ejemplo, `lineDetection.ts` vía la integración en `camera.tsx`),
 * sin duplicar la lógica.
 */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0,
    wB = 0,
    max = 0,
    threshold = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      threshold = i;
    }
  }
  return threshold;
}

function connectedComponents(
  binary: Uint8Array,
  width: number,
  height: number,
) {
  const labels = new Int32Array(width * height);
  const componentSizes: Record<number, number> = {};
  let nextLabel = 1;

  function fill(start: number, label: number): number {
    const stack = [start];
    let size = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      if (idx < 0 || idx >= width * height || labels[idx] || !binary[idx])
        continue;
      labels[idx] = label;
      size++;
      const x = idx % width,
        y = Math.floor(idx / width);
      if (x > 0) stack.push(idx - 1);
      if (x < width - 1) stack.push(idx + 1);
      if (y > 0) stack.push(idx - width);
      if (y < height - 1) stack.push(idx + width);
    }
    return size;
  }

  for (let i = 0; i < width * height; i++) {
    if (binary[i] && !labels[i]) {
      componentSizes[nextLabel] = fill(i, nextLabel);
      nextLabel++;
    }
  }
  return { labels, componentSizes, nextLabel };
}

function clusterByDistance(
  points: { x: number; y: number }[],
  maxDist: number,
): number[][] {
  const used = new Set<number>();
  const groups: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const group: number[] = [i];
    used.add(i);
    const queue = [i];
    while (queue.length) {
      const cur = queue.shift()!;
      for (let j = 0; j < points.length; j++) {
        if (used.has(j)) continue;
        const dx = points[cur].x - points[j].x;
        const dy = points[cur].y - points[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < maxDist) {
          group.push(j);
          used.add(j);
          queue.push(j);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Si un grupo tiene más puntos que maxDotsPerTile, lo divide en sub-fichas
 * usando un corte por mediana sobre el eje más largo del bounding box.
 */
function splitLargeGroups(
  groups: number[][],
  points: { x: number; y: number }[],
  maxDotsPerTile: number,
): number[][] {
  const result: number[][] = [];
  for (const group of groups) {
    if (group.length <= maxDotsPerTile) {
      result.push(group);
      continue;
    }
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const idx of group) {
      const p = points[idx];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const spanX = maxX - minX,
      spanY = maxY - minY;
    const axis: "x" | "y" = spanX >= spanY ? "x" : "y";
    const sorted = [...group].sort((a, b) => points[a][axis] - points[b][axis]);
    const mid = Math.floor(sorted.length / 2);
    result.push(sorted.slice(0, mid));
    result.push(sorted.slice(mid));
  }
  return result;
}
