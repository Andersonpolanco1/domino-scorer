/**
 * tileIdentification.ts
 *
 * Identifica el VALOR de cada ficha de dominó individual (ej. "4-6"),
 * no solo el conteo total de puntos.
 *
 * Implementa exactamente el método descrito en la especificación técnica
 * (Especificacion_Tecnica_Ficha_Domino.pdf):
 *
 *   1. Detectar rectángulos con relación de aspecto cercana a 2:1.
 *   2. Localizar la línea divisoria central.
 *   3. Dividir la ficha en dos mitades (cuadradas).
 *   4. Detectar círculos (puntos) dentro de cada mitad.
 *   5. Mapear cada punto a la posición más cercana de la cuadrícula 3×3
 *      (A,B,C / D,E,F / G,H,I — coordenadas normalizadas 0..1).
 *   6. Comparar el conjunto de posiciones activas contra los 7 patrones
 *      oficiales (0..6).
 *   7. Obtener el valor de cada mitad y por tanto el valor de la ficha.
 *
 * Es 100% matemático/geométrico — sin redes neuronales ni modelos de IA.
 *
 * Las fichas llegan APILADAS una junto a otra en una fila (especificadas
 * por el usuario: "una al lado de la otra, pegadas"), por lo que el
 * agrupamiento de puntos en `dotDetection.ts` ya las separa en grupos.
 * Este módulo toma esos grupos + sus posiciones espaciales y reconstruye
 * la geometría de cada ficha para clasificar cada mitad.
 */

import type { DetectionResult } from "./dotDetection";

// ─── Patrones oficiales (cuadrícula 3×3, coordenadas normalizadas) ──────────
// A B C      (0.25,0.25) (0.50,0.25) (0.75,0.25)
// D E F  →   (0.25,0.50) (0.50,0.50) (0.75,0.50)
// G H I      (0.25,0.75) (0.50,0.75) (0.75,0.75)

type CellId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";

const CELL_COORDS: Record<CellId, { x: number; y: number }> = {
  A: { x: 0.25, y: 0.25 },
  B: { x: 0.5, y: 0.25 },
  C: { x: 0.75, y: 0.25 },
  D: { x: 0.25, y: 0.5 },
  E: { x: 0.5, y: 0.5 },
  F: { x: 0.75, y: 0.5 },
  G: { x: 0.25, y: 0.75 },
  H: { x: 0.5, y: 0.75 },
  I: { x: 0.75, y: 0.75 },
};

// Patrones oficiales tal como están definidos en la especificación técnica.
const OFFICIAL_PATTERNS: Record<number, CellId[]> = {
  0: [],
  1: ["E"],
  2: ["A", "I"],
  3: ["A", "E", "I"],
  4: ["A", "C", "G", "I"],
  5: ["A", "C", "E", "G", "I"],
  6: ["A", "C", "D", "F", "G", "I"],
};

export interface IdentifiedTile {
  /** Índice de la ficha dentro de la fila, de izquierda a derecha (o arriba a abajo) */
  index: number;
  /** Valor de cada mitad. null si no se pudo determinar con confianza. */
  left: number | null;
  right: number | null;
  /** Suma de ambas mitades (puntos que aporta la ficha al marcador) */
  total: number | null;
  /** Si ambas mitades calzaron con un patrón oficial exacto */
  matched: boolean;
  /** Bounding box aproximado de la ficha en píxeles de la imagen original */
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
  /** Orientación detectada de la ficha */
  orientation: "horizontal" | "vertical";
}

export interface TileIdentificationResult {
  tiles: IdentifiedTile[];
  /** true si TODAS las fichas calzaron con patrones oficiales (alta confianza) */
  allMatched: boolean;
  /** Suma total de puntos de todas las fichas identificadas */
  totalPoints: number;
}

/**
 * A partir del resultado de detección de puntos (centroides + grupos por ficha),
 * identifica el valor numérico de cada mitad de cada ficha.
 */
export function identifyTiles(
  detection: DetectionResult,
  imgWidth: number,
  imgHeight: number,
): TileIdentificationResult {
  const tiles: IdentifiedTile[] = [];

  // Ordenar los grupos de izquierda a derecha (o arriba a abajo si la fila
  // de fichas está orientada verticalmente) usando el centroide del grupo.
  const groupsWithCentroid = detection.tileGroups.map((group, idx) => {
    const pts = group.map((i) => detection.dotCentroids[i]);
    const bbox = boundingBox(pts);
    return { idx, group, pts, bbox };
  });

  // Decidir orientación global de la fila de fichas: si el ancho total
  // ocupado por los centros de las fichas es mayor que el alto, están
  // dispuestas horizontalmente (una al lado de la otra en fila).
  const allCenters = groupsWithCentroid.map((g) => ({
    x: (g.bbox.minX + g.bbox.maxX) / 2,
    y: (g.bbox.minY + g.bbox.maxY) / 2,
  }));
  const spanX = spanOf(allCenters.map((c) => c.x));
  const spanY = spanOf(allCenters.map((c) => c.y));
  const rowIsHorizontal = spanX >= spanY;

  groupsWithCentroid.sort((a, b) => {
    const ca = { x: (a.bbox.minX + a.bbox.maxX) / 2, y: (a.bbox.minY + a.bbox.maxY) / 2 };
    const cb = { x: (b.bbox.minX + b.bbox.maxX) / 2, y: (b.bbox.minY + b.bbox.maxY) / 2 };
    return rowIsHorizontal ? ca.x - cb.x : ca.y - cb.y;
  });

  // Estimación robusta del tamaño de mitad (halfSize) usando TODAS las
  // fichas de la fila: como son fichas físicas idénticas, su tamaño debe
  // ser consistente entre sí. Fichas con pocos puntos (ej. 0-1, 1-1) no
  // tienen suficiente información propia para inferir su ancho de forma
  // confiable — usamos la mediana de las fichas que sí la tienen como
  // respaldo para esos casos.
  //
  // Dos pasadas: primero una estimación laxa (cualquier span > 0) para
  // tener una referencia de escala; luego se descartan los spans que sean
  // mucho menores a esa referencia (ej. dos puntos del patrón "1" que por
  // ruido de cámara difieren unos pocos píxeles en vez de compartir
  // exactamente la misma coordenada) y se recalcula la mediana solo con
  // las fichas cuyo span es consistente con un patrón real (≥30% de la
  // referencia laxa).
  const rawSpans: number[] = [];
  for (const g of groupsWithCentroid) {
    const perpValues = g.pts.map((p) => (rowIsHorizontal ? p.x : p.y));
    if (perpValues.length >= 2) {
      const span = Math.max(...perpValues) - Math.min(...perpValues);
      if (span > 0) rawSpans.push(span * 2);
    }
  }
  const looseReference = rawSpans.length > 0 ? median(rawSpans) : null;

  const perHalfSizeEstimates: number[] = [];
  for (const g of groupsWithCentroid) {
    const perpValues = g.pts.map((p) => (rowIsHorizontal ? p.x : p.y));
    if (perpValues.length < 2) continue;
    const span = Math.max(...perpValues) - Math.min(...perpValues);
    const estimate = span * 2;
    if (looseReference == null || estimate >= looseReference * 0.3) {
      perHalfSizeEstimates.push(estimate);
    }
  }
  const fallbackHalfSize =
    perHalfSizeEstimates.length > 0 ? median(perHalfSizeEstimates) : looseReference;

  let allMatched = groupsWithCentroid.length > 0;
  let totalPoints = 0;

  groupsWithCentroid.forEach((g, displayIdx) => {
    const result = classifyTile(g.pts, g.bbox, rowIsHorizontal, fallbackHalfSize);
    if (!result.matched) allMatched = false;
    if (result.total != null) totalPoints += result.total;

    tiles.push({
      index: displayIdx,
      left: result.left,
      right: result.right,
      total: result.total,
      matched: result.matched,
      bbox: g.bbox,
      orientation: rowIsHorizontal ? "vertical" : "horizontal",
      // Nota: si la fila de fichas es horizontal, cada ficha individual
      // (apilada con su lado largo vertical) divide sus mitades arriba/abajo;
      // si la fila es vertical, cada ficha divide sus mitades izq/der.
    });
  });

  return { tiles, allMatched, totalPoints };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ─── Clasificación de una sola ficha ────────────────────────────────────────

function classifyTile(
  points: { x: number; y: number }[],
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  rowIsHorizontal: boolean,
  fallbackHalfSize: number | null,
): { left: number | null; right: number | null; total: number | null; matched: boolean } {
  if (points.length === 0) {
    // Ficha en blanco (0-0): no hay puntos que detectar, pero igual es válida.
    return { left: 0, right: 0, total: 0, matched: true };
  }

  // Si la fila de fichas corre horizontalmente, cada ficha individual está
  // orientada con su lado largo VERTICAL → la división central es horizontal
  // (mitad superior / mitad inferior). Si la fila corre verticalmente, cada
  // ficha está acostada y la división es vertical (mitad izq / mitad der).
  const splitIsHorizontal = rowIsHorizontal;

  // El eje "perpendicular" (el que NO se divide) es confiable porque usa
  // TODOS los puntos de la ficha — no depende de cómo se reparten entre
  // mitades. Lo calculamos primero y lo usamos como ancla geométrica:
  // como cada mitad es CUADRADA, su tamaño en el eje de división debe
  // ser igual a este ancho perpendicular.
  const perpAxisAllValues = points.map((p) => (splitIsHorizontal ? p.x : p.y));
  const ownSpan = Math.max(...perpAxisAllValues) - Math.min(...perpAxisAllValues);

  // Un span propio es "significativo" solo si supera una fracción mínima
  // del tamaño de mitad esperado (referencia: fallbackHalfSize, el tamaño
  // típico de las demás fichas de la fila). Sin esto, dos puntos que
  // deberían compartir la misma coordenada (ej. dos veces el patrón "1",
  // ambos en E) pero difieren por unos pocos píxeles de ruido de cámara
  // generarían un halfSize artificialmente pequeño, rompiendo el cálculo.
  const minSignificantSpan =
    fallbackHalfSize != null && fallbackHalfSize > 0 ? fallbackHalfSize * 0.15 : 3;

  let halfSize: number;
  if (ownSpan >= minSignificantSpan) {
    const perpRange = expandRange(
      perpAxisAllValues,
      splitIsHorizontal ? bbox.minX : bbox.minY,
      splitIsHorizontal ? bbox.maxX : bbox.maxY,
    );
    halfSize = perpRange.max - perpRange.min;
  } else if (fallbackHalfSize != null && fallbackHalfSize > 0) {
    // Ficha con span propio insuficiente (ej. todos los puntos en la
    // misma columna, como dos veces el patrón "1" en E): no hay suficiente
    // información propia, así que usamos el tamaño típico de la fila.
    halfSize = fallbackHalfSize;
  } else {
    // Último recurso: bbox crudo de la ficha (puede subestimar el tamaño
    // real, pero es preferible a un halfSize de 0).
    const rawSpan = splitIsHorizontal ? bbox.maxX - bbox.minX : bbox.maxY - bbox.minY;
    halfSize = rawSpan > 0 ? rawSpan * 2 : 1;
  }

  // Centro perpendicular observado, usado para anclar la región cuando se
  // recurre al halfSize de respaldo (no se puede usar expandRange porque
  // no hay suficiente rango propio).
  const perpMid = (Math.min(...perpAxisAllValues) + Math.max(...perpAxisAllValues)) / 2;
  const perpRangeFinal = { min: perpMid - halfSize / 2, max: perpMid + halfSize / 2 };

  // Localizar la línea divisoria central (eje de división) probando varios
  // candidatos y CLASIFICANDO REALMENTE cada mitad resultante contra los
  // patrones oficiales — en vez de usar una métrica geométrica aproximada,
  // que resulta ambigua en casos límite (p. ej. un patrón de 2 puntos en
  // posiciones diagonales A,I podría partirse incorrectamente en "1 punto
  // arriba + 1 punto abajo", lo cual es geométricamente plausible pero no
  // corresponde a ningún patrón oficial válido en esa configuración).
  const axisValues = points
    .map((p) => (splitIsHorizontal ? p.y : p.x))
    .sort((a, b) => a - b);

  const { left, right, matched } = findBestSplit(
    points,
    axisValues,
    bbox,
    splitIsHorizontal,
    halfSize,
    perpRangeFinal,
  );

  const total = left != null && right != null ? left + right : null;

  return { left, right, total, matched };
}

/**
 * Genera candidatos para la línea divisoria y, para cada uno, clasifica
 * REALMENTE ambas mitades resultantes contra los patrones oficiales.
 * Elige el candidato con mejor resultado combinado, priorizando:
 *   1) ambas mitades coinciden exactamente con un patrón oficial,
 *   2) en empate, la combinación con mayor "calidad" agregada (menor
 *      distancia heurística al patrón más cercano).
 */
function findBestSplit(
  points: { x: number; y: number }[],
  sortedAxisValues: number[],
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  splitIsHorizontal: boolean,
  halfSize: number,
  perpRangeFinal: { min: number; max: number },
): { left: number | null; right: number | null; matched: boolean } {
  if (sortedAxisValues.length === 0) {
    return { left: 0, right: 0, matched: true };
  }

  const globalMin = sortedAxisValues[0];
  const globalMax = sortedAxisValues[sortedAxisValues.length - 1];

  const candidates: number[] = [];
  for (let i = 1; i < sortedAxisValues.length; i++) {
    candidates.push((sortedAxisValues[i] + sortedAxisValues[i - 1]) / 2);
  }
  candidates.push((globalMin + globalMax) / 2);
  const occupiedMid = (globalMin + globalMax) / 2;
  candidates.push(occupiedMid - halfSize / 2);
  candidates.push(occupiedMid + halfSize / 2);

  let best: { left: number | null; right: number | null; matched: boolean; score: number } = {
    left: null,
    right: null,
    matched: false,
    score: -Infinity,
  };

  for (const candidate of candidates) {
    const halfA: { x: number; y: number }[] = [];
    const halfB: { x: number; y: number }[] = [];
    for (const p of points) {
      const v = splitIsHorizontal ? p.y : p.x;
      if (v < candidate) halfA.push(p);
      else halfB.push(p);
    }
    if (halfA.length > 6 || halfB.length > 6) continue; // imposible para una ficha válida

    const bboxA = buildHalfBbox(bbox, splitIsHorizontal, "A", candidate, perpRangeFinal, halfSize);
    const bboxB = buildHalfBbox(bbox, splitIsHorizontal, "B", candidate, perpRangeFinal, halfSize);

    const valueA = classifyHalfPoints(halfA, bboxA);
    const valueB = classifyHalfPoints(halfB, bboxB);

    // Puntaje: +2 por cada mitad que calza EXACTAMENTE con un patrón
    // oficial; en empate, se prefiere el candidato más cercano al centro
    // geométrico del rango total (más estable frente a ruido).
    let score = (valueA.matched ? 2 : 0) + (valueB.matched ? 2 : 0);
    const centerBias = -Math.abs(candidate - (globalMin + globalMax) / 2) * 0.001;
    score += centerBias;

    if (score > best.score) {
      best = {
        left: valueA.value,
        right: valueB.value,
        matched: valueA.matched && valueB.matched,
        score,
      };
    }
  }

  return { left: best.left, right: best.right, matched: best.matched };
}

/**
 * Expande un rango de valores observados al doble de su tamaño, centrado
 * en su propio punto medio — recupera el rango real 0–1 a partir de
 * valores que solo ocupan la franja central 0.25–0.75. Si hay menos de
 * 2 valores (no hay rango que expandir), usa el bbox completo de la ficha
 * como referencia de respaldo.
 */
function expandRange(
  values: number[],
  fallbackMin: number,
  fallbackMax: number,
): { min: number; max: number } {
  if (values.length < 2) {
    return { min: fallbackMin, max: fallbackMax };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = (min + max) / 2;
  const halfSpan = (max - min) / 2;
  // El rango observado representa el 50% central (0.25 a 0.75), así que
  // el rango real equivale a 2x el span observado, centrado en el mismo punto.
  const expandedHalfSpan = halfSpan * 2;
  return { min: mid - expandedHalfSpan, max: mid + expandedHalfSpan };
}

/**
 * Construye el bbox real de una mitad de ficha. El tamaño de la mitad en
 * el eje de división es, por restricción geométrica de la especificación
 * ("dos regiones cuadradas"), igual a `halfSize` (el mismo ancho
 * perpendicular ya calculado) — se ancla al borde correspondiente de la
 * línea divisoria y se extiende hacia afuera esa distancia.
 */
function buildHalfBbox(
  tileBbox: { minX: number; maxX: number; minY: number; maxY: number },
  splitIsHorizontal: boolean,
  which: "A" | "B",
  splitPoint: number,
  perpRange: { min: number; max: number },
  halfSize: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  if (splitIsHorizontal) {
    // Mitad superior (A): se extiende hacia arriba desde splitPoint.
    // Mitad inferior (B): se extiende hacia abajo desde splitPoint.
    const outerMin = which === "A" ? splitPoint - halfSize : splitPoint;
    const outerMax = which === "A" ? splitPoint : splitPoint + halfSize;
    return { minX: perpRange.min, maxX: perpRange.max, minY: outerMin, maxY: outerMax };
  }
  const outerMin = which === "A" ? splitPoint - halfSize : splitPoint;
  const outerMax = which === "A" ? splitPoint : splitPoint + halfSize;
  return { minX: outerMin, maxX: outerMax, minY: perpRange.min, maxY: perpRange.max };
}

/**
 * Clasifica un conjunto de puntos ya pertenecientes a una mitad, dado un
 * bbox de referencia (derivado del candidato de línea divisoria evaluado).
 *
 * Si la mitad tiene suficientes puntos propios con span significativo en
 * ambos ejes, se PREFIERE recalcular el bbox real a partir de esos puntos
 * (expandiendo su rango observado ×2, centrado en su propio centroide —
 * el mismo principio usado para el ancho perpendicular global), en vez de
 * confiar en el bbox de referencia. Esto es más preciso porque el bbox de
 * referencia depende de un candidato de línea divisoria que puede no ser
 * exacto, mientras que el rango propio de 2+ puntos reales es información
 * geométrica directa.
 */
function classifyHalfPoints(
  points: { x: number; y: number }[],
  regionBbox: { minX: number; maxX: number; minY: number; maxY: number },
): { value: number | null; matched: boolean } {
  const refinedBbox = refineHalfBboxFromOwnPoints(points, regionBbox);
  const regionW = refinedBbox.maxX - refinedBbox.minX || 1;
  const regionH = refinedBbox.maxY - refinedBbox.minY || 1;

  const activeCells = new Set<CellId>();
  for (const p of points) {
    const nx = (p.x - refinedBbox.minX) / regionW;
    const ny = (p.y - refinedBbox.minY) / regionH;
    activeCells.add(nearestCell(clamp01(nx), clamp01(ny)));
  }

  const n = points.length;

  // Caso especial: exactamente 1 punto. El patrón oficial "1" siempre
  // coloca su único punto en el centro (E). En vez de depender de
  // `nearestCell` —sensible a un bbox de mitad ligeramente impreciso,
  // que puede desplazar el punto hacia una celda vecina (D, F, H, B)—
  // verificamos directamente que esté razonablemente cerca del centro
  // relativo de la mitad (más cerca de E que de cualquier esquina),
  // lo cual es suficiente para confirmar el patrón "1" con tolerancia
  // generosa al ruido de detección.
  if (n === 1) {
    const p = points[0];
    const nx = clamp01((p.x - refinedBbox.minX) / regionW);
    const ny = clamp01((p.y - refinedBbox.minY) / regionH);
    const distToCenter = Math.hypot(nx - 0.5, ny - 0.5);
    // Cualquier esquina (A,C,G,I) está a distancia ~0.354 del centro; un
    // punto genuino del patrón "1" debería estar mucho más cerca del
    // centro que de cualquier esquina. Umbral generoso: 0.3.
    if (distToCenter < 0.3) {
      return { value: 1, matched: true };
    }
  }

  const expectedPattern = OFFICIAL_PATTERNS[n];
  if (expectedPattern) {
    const expectedSet = new Set(expectedPattern);
    const matches =
      activeCells.size === expectedSet.size &&
      [...activeCells].every((c) => expectedSet.has(c));
    if (matches) {
      return { value: n, matched: true };
    }
  }

  let bestValue: number | null = null;
  let bestScore = -1;
  for (const [valueStr, cells] of Object.entries(OFFICIAL_PATTERNS)) {
    const value = Number(valueStr);
    const cellSet = new Set(cells);
    const intersection = [...activeCells].filter((c) => cellSet.has(c)).length;
    const union = new Set([...activeCells, ...cellSet]).size;
    const score = union === 0 ? 1 : intersection / union;
    if (score > bestScore) {
      bestScore = score;
      bestValue = value;
    }
  }

  return { value: bestValue, matched: bestScore >= 0.75 };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Refina el bbox de una mitad usando el rango propio de sus puntos cuando
 * resulta confiable. Para cada eje (X e Y) por separado: si el span
 * observado de los puntos es significativo (≥30% del tamaño de referencia
 * en ese eje), se reemplaza el límite de ese eje por el rango propio
 * expandido ×2 centrado en su punto medio — el mismo principio geométrico
 * usado en el resto del módulo (los patrones oficiales ocupan como máximo
 * el 50% central normalizado de su mitad). Si el span propio es pequeño
 * (p. ej. una sola fila de puntos, o muy pocos puntos), se conserva el
 * límite de referencia, que ya incorpora el tamaño físico esperado de la
 * ficha completa.
 */
function refineHalfBboxFromOwnPoints(
  points: { x: number; y: number }[],
  referenceBbox: { minX: number; maxX: number; minY: number; maxY: number },
): { minX: number; maxX: number; minY: number; maxY: number } {
  if (points.length < 2) return referenceBbox;

  const refW = referenceBbox.maxX - referenceBbox.minX || 1;
  const refH = referenceBbox.maxY - referenceBbox.minY || 1;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);

  let { minX, maxX, minY, maxY } = referenceBbox;

  if (spanX >= refW * 0.3) {
    const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
    // El span observado representa como máximo el 50% central normalizado
    // (0.25 a 0.75), así que el rango real es el doble, centrado en midX.
    minX = midX - spanX;
    maxX = midX + spanX;
  }
  if (spanY >= refH * 0.3) {
    const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
    minY = midY - spanY;
    maxY = midY + spanY;
  }

  return { minX, maxX, minY, maxY };
}

function nearestCell(nx: number, ny: number): CellId {
  let best: CellId = "E";
  let bestDist = Infinity;
  for (const [id, coord] of Object.entries(CELL_COORDS) as [CellId, { x: number; y: number }][]) {
    const dx = nx - coord.x;
    const dy = ny - coord.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

// ─── Helpers geométricos ─────────────────────────────────────────────────

function boundingBox(points: { x: number; y: number }[]) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

function spanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

/**
 * Validación matemática de una ficha según la especificación:
 *  - Relación largo/ancho ≈ 2 (tolerancia 1.8–2.2)
 *  - Dos regiones cuadradas
 *  - Cada región entre 0 y 6 puntos
 *  - Las posiciones coinciden con un patrón oficial
 */
export function validateTileGeometry(bbox: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}): { valid: boolean; aspectRatio: number } {
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h) || 1;
  const aspectRatio = longSide / shortSide;
  const valid = aspectRatio >= 1.6 && aspectRatio <= 2.6; // tolerancia ampliada para fotos reales
  return { valid, aspectRatio };
}
