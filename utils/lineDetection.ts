/**
 * lineDetection.ts
 *
 * Detecta y valida la geometría de la fila de fichas de dominó usando
 * CUATRO MARCADORES FIJOS en la pantalla de la cámara — no detectados por
 * algoritmo, sino una guía visual que el usuario alinea contra sus fichas
 * antes de capturar, exactamente como ya se hace con la marca de inicio
 * horizontal:
 *
 *  1. `startX`    — marca de inicio: borde izquierdo de la primera ficha.
 *  2. `topY`      — marcador superior: borde superior de las fichas.
 *  3. `dividerY`  — marcador divisor: línea que separa las dos caras de
 *                   cada ficha (debe coincidir con el centro vertical
 *                   exacto entre topY y bottomY).
 *  4. `bottomY`   — marcador inferior: borde inferior de las fichas.
 *
 * Por qué este enfoque (ver PLAN_DISENO_V2.md para el contexto completo
 * de diseño): los primeros intentos intentaban DETECTAR el alto de ficha
 * por algoritmo — primero con un bbox por contraste contra el fondo de
 * mesa, luego con la cobertura de la línea divisoria sobre todo el ancho
 * del rectángulo guía. Ambos enfoques fallaban de la misma forma cuando
 * hay pocas fichas dentro de un encuadre ancho (el rectángulo guía es
 * deliberadamente holgado): la señal real se DILUYE al promediarse o
 * medirse contra un ancho mucho mayor que el contenido real, y el
 * algoritmo no encuentra nada aunque la imagen sea perfectamente válida.
 *
 * La solución correcta, identificada visualmente por el usuario: en vez
 * de intentar DESCUBRIR el alto de ficha desde la imagen, se le pide al
 * usuario que ENCUADRE sus fichas contra una guía ya conocida — el mismo
 * principio que la marca de inicio horizontal, extendido a los tres
 * límites verticales. Esto convierte el problema de "inferencia desde una
 * imagen ambigua" en "verificación contra una hipótesis fuerte ya
 * conocida", que es estructuralmente más robusto y nunca se diluye con el
 * ancho del contenido, porque ya no depende de medir nada como fracción
 * de un ancho variable.
 *
 * El grosor visual de estas líneas en pantalla (cuántos píxeles de
 * pantalla ocupan) es una decisión de UI, no de este módulo — tiene
 * sentido que sea más fino cuando el usuario aleja la cámara para
 * encuadrar más fichas, ya que a esa distancia las fichas mismas se ven
 * más pequeñas. El umbral de grosor que SÍ usa este módulo
 * (`maxThicknessRatio` en `verifyDividerLine`) es distinto: es el criterio
 * para reconocer la línea divisoria real DENTRO de la imagen, y ya está
 * expresado como fracción relativa del alto de ficha (conocido de
 * antemano gracias a los marcadores), por lo que se ajusta solo sin
 * necesitar tocarlo cuando cambia el zoom.
 */

export interface RegionOfInterest {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ProjectionPeak {
  /** Posición Y (fila) del centro del pico, en coordenadas absolutas de la imagen */
  y: number;
  /** Qué fracción del ancho de la franja de búsqueda tenía píxeles oscuros en la fila pico (0-1) */
  coverage: number;
  /** Grosor del pico en filas (cuántas filas consecutivas superaron el umbral) */
  thicknessPx: number;
}

/**
 * Calcula el perfil de proyección horizontal: para cada fila y dentro de
 * la región de interés, el conteo de píxeles oscuros (binary[i] === 1) en
 * esa fila, normalizado como fracción del ancho de la región (0-1).
 *
 * Devolver la fracción (no el conteo crudo) hace que el umbral de
 * "cobertura mínima para ser línea divisoria" sea independiente de la
 * resolución de la imagen — siempre se compara contra 0-1. El llamador es
 * responsable de pasar una región de interés cuyo ANCHO sea representativo
 * del contenido real (ver `verifyDividerLine`, que acota la búsqueda a una
 * franja angosta cerca de la posición esperada del marcador divisor, en
 * vez de usar el ancho completo del rectángulo guía — evita la dilución
 * documentada en versiones anteriores de este módulo).
 */
export function computeHorizontalProjection(
  binary: Uint8Array,
  width: number,
  roi: RegionOfInterest,
): number[] {
  const roiWidth = roi.maxX - roi.minX;
  if (roiWidth <= 0) return [];

  const profile: number[] = [];
  for (let y = roi.minY; y < roi.maxY; y++) {
    let count = 0;
    const rowOffset = y * width;
    for (let x = roi.minX; x < roi.maxX; x++) {
      if (binary[rowOffset + x]) count++;
    }
    profile.push(count / roiWidth);
  }
  return profile;
}

/**
 * Encuentra picos candidatos en el perfil de proyección: tramos de filas
 * consecutivas cuya cobertura supera `minCoverage`, fusionando tramos muy
 * cercanos entre sí (separados por menos de `mergeGapPx` filas por debajo
 * del umbral) en un único pico — esto evita que una línea divisoria con
 * ligero ruido en el medio (una fila que cae justo debajo del umbral) se
 * cuente como dos picos separados.
 *
 * Las posiciones `y` devueltas son relativas al inicio del perfil (índice
 * 0 = primera fila del array `profile`) — el llamador debe reanclar a
 * coordenadas absolutas si el perfil no comenzaba en y=0 de la imagen.
 */
export function findProjectionPeaks(
  profile: number[],
  minCoverage: number,
  mergeGapPx: number = 1,
): ProjectionPeak[] {
  const peaks: ProjectionPeak[] = [];
  let i = 0;
  while (i < profile.length) {
    if (profile[i] < minCoverage) {
      i++;
      continue;
    }
    const start = i;
    let end = i;
    let gapRun = 0;
    let j = i + 1;
    while (j < profile.length) {
      if (profile[j] >= minCoverage) {
        end = j;
        gapRun = 0;
        j++;
      } else {
        gapRun++;
        if (gapRun > mergeGapPx) break;
        j++;
      }
    }
    const thicknessPx = end - start + 1;
    let maxCoverage = 0;
    let weightedSum = 0;
    let weightTotal = 0;
    for (let k = start; k <= end; k++) {
      if (profile[k] > maxCoverage) maxCoverage = profile[k];
      weightedSum += k * profile[k];
      weightTotal += profile[k];
    }
    const centerY =
      weightTotal > 0 ? weightedSum / weightTotal : (start + end) / 2;

    peaks.push({ y: centerY, coverage: maxCoverage, thicknessPx });
    i = end + 1;
  }
  return peaks;
}

/**
 * Filtra picos candidatos para conservar solo los que son geométricamente
 * compatibles con una línea divisoria real: cobertura alta (cruza casi
 * toda la franja de búsqueda) y grosor acotado (1-2mm reales, no una
 * franja gruesa que sugeriría un borde de sombra o el cuerpo de un punto
 * grande mal binarizado).
 *
 * CALIBRACIÓN VALIDADA CON CASOS ADVERSARIALES: una línea divisoria real
 * puede aparecer más gruesa de lo nominal (1-2mm) si el biselado del
 * borde de la ficha suma una sombra lineal adyacente — en un caso
 * sintético de prueba, una línea de 6px de grosor (el doble de lo
 * esperado) requirió un `maxThicknessPx` de al menos 10px para no
 * perderse, mientras que 5px la descartaba por error. Por eso
 * `maxThicknessPx` no debe fijarse como una constante absoluta en
 * píxeles: debe calcularse como una fracción del alto de ficha conocido
 * (ya fijo gracias a los marcadores, no detectado), de forma que escale
 * automáticamente con la resolución y distancia de cada captura.
 */
export function filterLineCandidates(
  peaks: ProjectionPeak[],
  minCoverage: number,
  maxThicknessPx: number,
): ProjectionPeak[] {
  return peaks.filter(
    (p) => p.coverage >= minCoverage && p.thicknessPx <= maxThicknessPx,
  );
}

export interface DividerVerificationResult {
  found: boolean;
  /** Posición Y real de la línea divisoria encontrada, si `found` es true */
  actualDividerY?: number;
  /** Cobertura de la línea encontrada (0-1) */
  coverage?: number;
  /** Diferencia en píxeles entre la posición esperada (marcador) y la
   * posición real encontrada — útil para decidir si el encuadre del
   * usuario está suficientemente bien alineado. */
  offsetFromExpectedPx?: number;
}

/**
 * Verifica que exista una línea divisoria real cerca de la posición
 * esperada (`expectedDividerY`, el marcador divisor fijo en pantalla),
 * buscando SOLO en una franja angosta alrededor de esa posición — no en
 * todo el ancho del rectángulo guía.
 *
 * Esto es la pieza central del cambio de paradigma de esta versión: en
 * vez de "encontrar dónde está la línea" (un problema de detección
 * abierto, vulnerable a diluirse cuando el contenido real es angosto
 * comparado con el ancho del ROI), se pasa a "verificar que la línea está
 * donde el usuario, guiado por los marcadores fijos, dijo que estaría" —
 * un problema de confirmación mucho más simple y robusto.
 *
 * La franja de búsqueda en X se acota a `[startX, startX + searchWidthPx)`
 * — un ancho razonable conocido de antemano (p. ej. el ancho de una o dos
 * fichas, derivado de `tileHeightPx` ya fijo por los marcadores), no el
 * ancho completo del rectángulo guía. La franja en Y se acota a
 * `expectedDividerY ± toleranceRatio * tileHeightPx`.
 */
export function verifyDividerLine(
  binary: Uint8Array,
  width: number,
  startX: number,
  searchWidthPx: number,
  expectedDividerY: number,
  tileHeightPx: number,
  options?: {
    minCoverage?: number;
    maxThicknessRatio?: number;
    toleranceRatio?: number;
  },
): DividerVerificationResult {
  const opts = {
    minCoverage: options?.minCoverage ?? 0.6,
    maxThicknessRatio: options?.maxThicknessRatio ?? 0.1,
    toleranceRatio: options?.toleranceRatio ?? 0.15,
  };

  const searchMinY = Math.round(
    expectedDividerY - tileHeightPx * opts.toleranceRatio,
  );
  const searchMaxY = Math.round(
    expectedDividerY + tileHeightPx * opts.toleranceRatio,
  );
  const roi: RegionOfInterest = {
    minX: Math.round(startX),
    maxX: Math.round(startX + searchWidthPx),
    minY: Math.max(0, searchMinY),
    maxY: searchMaxY,
  };

  const profile = computeHorizontalProjection(binary, width, roi);
  const peaks = findProjectionPeaks(profile, 0.1);
  const absolutePeaks = peaks.map((p) => ({ ...p, y: p.y + roi.minY }));

  const maxThicknessPx = Math.max(
    2,
    Math.round(tileHeightPx * opts.maxThicknessRatio),
  );
  const candidates = filterLineCandidates(
    absolutePeaks,
    opts.minCoverage,
    maxThicknessPx,
  );

  if (candidates.length === 0) return { found: false };

  const best = candidates.reduce((a, b) => (b.coverage > a.coverage ? b : a));
  return {
    found: true,
    actualDividerY: best.y,
    coverage: best.coverage,
    offsetFromExpectedPx: Math.abs(best.y - expectedDividerY),
  };
}

/**
 * Calcula un perfil de "diferencia contra el fondo" por COLUMNA — usado
 * para verificar si un segmento vertical específico del eje X contiene
 * una ficha o es fondo vacío de mesa. Se usa diferencia ABSOLUTA por
 * píxel contra una referencia de fondo, no diferencia del promedio de la
 * columna, para evitar la cancelación que ocurre cuando una columna
 * mezcla píxeles oscuros (puntos, línea divisoria) con el cuerpo claro de
 * la ficha — el mismo principio matemático validado para perfiles por
 * fila en versiones anteriores de este módulo (ver historial de diseño
 * en PLAN_DISENO_V2.md): un píxel oscuro lejos de la referencia y uno
 * claro lejos de la referencia (en direcciones opuestas) ambos SUMAN
 * diferencia en vez de cancelarse entre sí.
 */
export function computeColumnBackgroundDiff(
  gray: Uint8Array,
  width: number,
  roi: RegionOfInterest,
  backgroundRef: number,
): number[] {
  const roiHeight = roi.maxY - roi.minY;
  if (roiHeight <= 0) return [];

  const profile: number[] = [];
  for (let x = roi.minX; x < roi.maxX; x++) {
    let sumAbsDiff = 0;
    for (let y = roi.minY; y < roi.maxY; y++) {
      sumAbsDiff += Math.abs(gray[y * width + x] - backgroundRef);
    }
    profile.push(sumAbsDiff / roiHeight);
  }
  return profile;
}

/**
 * Estima el color de referencia del fondo de la mesa, promediando una
 * franja angosta justo ENCIMA del marcador superior fijo (`topY`) — una
 * zona donde, por diseño, el usuario no debería haber colocado ninguna
 * ficha (las fichas van alineadas contra el marcador superior, no antes
 * de él). Esto reemplaza la estimación anterior basada en los extremos de
 * un ROI ancho arbitrario, que ya no es necesaria: con marcadores fijos,
 * se sabe exactamente dónde mirar para encontrar fondo vacío garantizado.
 */
export function estimateBackgroundReference(
  gray: Uint8Array,
  width: number,
  topY: number,
  stripHeightPx: number = 10,
): number {
  const y0 = Math.max(0, Math.round(topY - stripHeightPx));
  const y1 = Math.max(y0 + 1, Math.round(topY));
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      sum += gray[rowOffset + x];
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

export interface TileSlot {
  index: number;
  minX: number;
  maxX: number;
  /** Diferencia promedio contra el fondo dentro de este segmento — qué tan
   * seguro es que aquí hay contenido real de una ficha, no fondo vacío. */
  contentStrength: number;
  hasContent: boolean;
}

export interface TileCountResult {
  slots: TileSlot[];
  /** Cuántos segmentos consecutivos válidos se encontraron desde el inicio,
   * antes de que el patrón se rompiera (primer hueco sin contenido). */
  tileCount: number;
  /** Posición X donde termina el bloque real de fichas (borde derecho de
   * la última ficha válida) — todo lo que sigue hacia la derecha, hasta el
   * borde de la imagen, debe descartarse del procesamiento. */
  blockEndX: number;
}

/**
 * Cuenta cuántas fichas hay en el bloque, dividiendo el eje X en segmentos
 * de `tileWidthPx` (derivado del alto de ficha, ya conocido por los
 * marcadores fijos, vía proporción 2:1) a partir de `startX` (la marca de
 * inicio fija del encuadre).
 *
 * Para cada posición esperada se verifica que el segmento correspondiente
 * tenga contenido real (diferencia contra el fondo por encima de
 * `minContentStrength`), usando la franja vertical [topY, bottomY] ya fija
 * por los marcadores. El conteo se detiene en el primer segmento sin
 * contenido — eso marca el fin real del bloque de fichas, descartando todo
 * el espacio restante del encuadre (el "ruido" de la zona vacía entre el
 * final de las fichas y el borde de la foto, que existe porque el
 * rectángulo guía es deliberadamente más grande que lo necesario).
 *
 * Nota sobre el caso de la ficha 0-0 (sin línea divisoria fuerte ni
 * puntos): esta función NO depende de encontrar puntos ni línea dentro
 * del segmento, solo de que haya CONTRASTE contra el fondo de mesa — el
 * cuerpo de la ficha en sí (de un color distinto a la mesa, como ya pide
 * la guía al usuario) es suficiente para que el segmento cuente como
 * contenido válido, incluso si esa ficha específica no tiene ningún punto
 * grabado. Esto resuelve el caso 0-0 sin necesitar lógica especial —
 * confirmado con caso sintético (ficha en blanco en medio del bloque,
 * contada correctamente: contentStrength algo menor que las fichas con
 * puntos, pero igual muy por encima del umbral).
 *
 * CALIBRACIÓN DE `minContentStrength`: con ruido de cámara sintético de
 * ±25 (en escala de grises 0-255) sobre toda la imagen, un umbral de 10
 * produce FALSOS POSITIVOS — el ruido en la zona vacía después del bloque
 * real supera el umbral y el conteo sigue de largo, contando fichas que
 * no existen. Un ruido de ±25 ya es muy alto para una cámara de teléfono
 * en condiciones normales y debería estar bloqueado antes por el chequeo
 * de nitidez de `imageQuality.ts`, pero como margen de seguridad
 * adicional, `minContentStrength` debe fijarse a medio camino entre el
 * nivel de ruido esperado en una imagen "limpia" (~0-5) y el nivel de
 * contenido real (~30-40) — un valor en el rango 18-20 da margen
 * razonable a ambos lados.
 */
export function countTilesFromStart(
  gray: Uint8Array,
  width: number,
  startX: number,
  tileWidthPx: number,
  verticalRoi: { topY: number; bottomY: number },
  backgroundRef: number,
  minContentStrength: number,
  maxTiles: number = 40,
): TileCountResult {
  const slots: TileSlot[] = [];
  let index = 0;
  let blockEndX = startX;

  while (index < maxTiles) {
    const segMinX = Math.round(startX + index * tileWidthPx);
    const segMaxX = Math.round(startX + (index + 1) * tileWidthPx);
    if (segMinX >= width) break;
    const clampedMaxX = Math.min(segMaxX, width);

    const roi: RegionOfInterest = {
      minX: segMinX,
      maxX: clampedMaxX,
      minY: Math.round(verticalRoi.topY),
      maxY: Math.round(verticalRoi.bottomY),
    };
    const colProfile = computeColumnBackgroundDiff(
      gray,
      width,
      roi,
      backgroundRef,
    );
    const contentStrength =
      colProfile.length > 0
        ? colProfile.reduce((a, b) => a + b, 0) / colProfile.length
        : 0;
    const hasContent = contentStrength >= minContentStrength;

    slots.push({
      index,
      minX: segMinX,
      maxX: clampedMaxX,
      contentStrength,
      hasContent,
    });

    if (!hasContent) break;

    blockEndX = clampedMaxX;
    index++;
  }

  const tileCount = slots.filter((s) => s.hasContent).length;
  return { slots, tileCount, blockEndX };
}

// ─── Orquestación de alto nivel ──────────────────────────────────────────

export interface TileLayoutResult {
  startX: number;
  topY: number;
  dividerY: number;
  bottomY: number;
  tileHeightPx: number;
  tileWidthPx: number;
  tileCount: number;
  blockEndX: number;
  /** Qué tan lejos estaba la línea divisoria real de la posición esperada
   * (el marcador), en píxeles — útil para decidir si el encuadre del
   * usuario es suficientemente preciso, o solo para mostrar feedback. */
  dividerOffsetPx: number;
  /** Posiciones X de cada ficha individual detectada, en orden de
   * izquierda a derecha. */
  tileSlots: { minX: number; maxX: number }[];
}

export type TileLayoutFailureReason =
  | "divider_not_found"
  | "zero_tiles_counted";

export interface TileLayoutFailure {
  reason: TileLayoutFailureReason;
}

/**
 * Función de orquestación de alto nivel para la arquitectura de CUATRO
 * MARCADORES FIJOS: a diferencia de versiones anteriores de este módulo,
 * `topY` y `bottomY` ya NO se detectan ni se derivan por simetría — son
 * parámetros fijos, exactamente como `startX`, porque corresponden a
 * marcadores visuales que el usuario alinea contra sus fichas antes de
 * capturar.
 *
 * Pasos:
 *  1. Verificar que exista una línea divisoria real cerca del marcador
 *     divisor esperado (`verifyDividerLine`), buscando solo en una franja
 *     angosta — no en todo el ancho del rectángulo guía, lo que evitaba la
 *     dilución de señal documentada en versiones anteriores.
 *  2. Conteo en X desde la marca de inicio fija, usando el ancho de ficha
 *     ya conocido (`tileHeightPx` fijo / 2) vía `countTilesFromStart`.
 *
 * Devuelve la razón del fallo en cualquier paso — el llamador (la UI de
 * la cámara) decide cómo comunicar cada caso al usuario.
 */
export function detectTileLayout(
  gray: Uint8Array,
  binary: Uint8Array,
  width: number,
  startX: number,
  topY: number,
  expectedDividerY: number,
  bottomY: number,
  options?: {
    minLineCoverage?: number;
    maxThicknessRatio?: number;
    dividerToleranceRatio?: number;
    minContentStrength?: number;
    backgroundStripHeightPx?: number;
    maxTiles?: number;
  },
): TileLayoutResult | TileLayoutFailure {
  const opts = {
    minLineCoverage: options?.minLineCoverage ?? 0.6,
    maxThicknessRatio: options?.maxThicknessRatio ?? 0.1,
    dividerToleranceRatio: options?.dividerToleranceRatio ?? 0.15,
    minContentStrength: options?.minContentStrength ?? 18,
    backgroundStripHeightPx: options?.backgroundStripHeightPx ?? 10,
    maxTiles: options?.maxTiles ?? 40,
  };

  const tileHeightPx = bottomY - topY;
  const tileWidthPx = tileHeightPx / 2; // proporción 2:1 fija de la especificación

  // Paso 1 — verificar la línea divisoria, buscando solo en una franja
  // angosta de ancho razonable (una ficha y media de margen) cerca de
  // startX, no en todo el rectángulo guía.
  const searchWidthPx = tileWidthPx * 1.5;
  const verification = verifyDividerLine(
    binary,
    width,
    startX,
    searchWidthPx,
    expectedDividerY,
    tileHeightPx,
    {
      minCoverage: opts.minLineCoverage,
      maxThicknessRatio: opts.maxThicknessRatio,
      toleranceRatio: opts.dividerToleranceRatio,
    },
  );

  if (!verification.found) return { reason: "divider_not_found" };

  // Paso 2 — conteo en X usando el alto de ficha ya conocido por los
  // marcadores fijos (no detectado).
  const backgroundRef = estimateBackgroundReference(
    gray,
    width,
    topY,
    opts.backgroundStripHeightPx,
  );
  const countResult = countTilesFromStart(
    gray,
    width,
    startX,
    tileWidthPx,
    { topY, bottomY },
    backgroundRef,
    opts.minContentStrength,
    opts.maxTiles,
  );

  if (countResult.tileCount === 0) return { reason: "zero_tiles_counted" };

  const tileSlots = countResult.slots
    .filter((s) => s.hasContent)
    .map((s) => ({ minX: s.minX, maxX: s.maxX }));

  return {
    startX,
    topY,
    dividerY: verification.actualDividerY!,
    bottomY,
    tileHeightPx,
    tileWidthPx,
    tileCount: countResult.tileCount,
    blockEndX: countResult.blockEndX,
    dividerOffsetPx: verification.offsetFromExpectedPx!,
    tileSlots,
  };
}
