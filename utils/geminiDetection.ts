/**
 * geminiDetection.ts
 *
 * Implementación ALTERNATIVA de conteo de puntos usando la API de Gemini
 * (Google), pensada como vía rápida para probar el despliegue de la app
 * mientras el algoritmo de visión computacional 100% local (`dotDetection.ts`
 * + `tileIdentification.ts`) sigue afinándose.
 *
 * Diferencias deliberadas respecto al modo local (decisiones de producto
 * confirmadas):
 *  1. Devuelve desglose por ficha (left/right por cada una, en orden de
 *     izquierda a derecha) — igual que el modo local en estructura, pero
 *     el TOTAL y el total por ficha se calculan en código (suma simple),
 *     nunca se confía en una suma que el modelo pudiera devolver: un LLM
 *     puede identificar bien cada ficha y aun así sumar mal, así que se
 *     separa "reconocer cada ficha" de "sumar", eliminando esa fuente de
 *     error por completo.
 *  2. No depende de ninguna validación geométrica de los 4 marcadores
 *     (`lineDetection.ts`) — esa validación existe para compensar las
 *     limitaciones del algoritmo local (que necesita saber EXACTAMENTE
 *     dónde está cada ficha para no diluir la señal). Gemini, al
 *     interpretar la imagen completa con contexto visual, es más
 *     tolerante a un encuadre imperfecto. Los marcadores en este modo
 *     solo se usan para RECORTAR la región de interés (ver `camera.tsx`),
 *     nunca para rechazar la foto por geometría.
 *  3. `reliable` es binario (sí/no), no una escala de 3 niveles — decisión
 *     de producto confirmada: no se quiere zona gris ("confianza media")
 *     que complique la UI o la decisión del usuario.
 *
 * Lo que SÍ se comparte con el modo local (sin duplicar lógica aquí):
 *  - La validación de calidad de imagen (`imageQuality.ts`) corre antes,
 *     en `camera.tsx`, igual para ambos modos — evita gastar una llamada
 *     de red/costo en una foto que de todas formas no sería confiable.
 *
 * SEGURIDAD — IMPORTANTE: `EXPO_PUBLIC_GEMINI_API_KEY` se inyecta en el
 * bundle de JS en tiempo de build. Cualquiera que descompile el APK/IPA
 * puede extraer esta key y consumir tu cuota a tu costo. Esto es
 * aceptable mientras se prueba el despliegue (uso confirmado del
 * usuario), pero ANTES de publicar en stores con este modo activo en
 * producción, hay que mover la llamada a un backend/proxy que oculte la
 * key. No es un requisito de esta tarea, solo queda anotado aquí para no
 * olvidarlo.
 */

// Modelo Gemini vigente al momento de escribir esto (línea Gemini 3,
// junio 2026) — los modelos anteriores (gemini-1.5-*, gemini-2.0-*) están
// siendo retirados. `flash-lite` es la opción más económica/rápida,
// suficiente para esta tarea (contar puntos en una imagen ya recortada,
// no requiere razonamiento complejo). Cambiar aquí si se necesita más
// precisión (p. ej. "gemini-3.5-flash").
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Tiempo máximo de espera por la respuesta de Gemini antes de abortar y
// tratarlo como error de red — evita que una conexión lenta deje al
// usuario esperando indefinidamente con el botón de captura bloqueado.
const REQUEST_TIMEOUT_MS = 20000;

const PROMPT = `You are analyzing a cropped photo, taken from directly above, that is expected to contain one or more domino tiles arranged in a single horizontal row, side by side.

WHAT A DOMINO TILE LOOKS LIKE
- A small rectangular tile, about twice as long as it is wide, divided into two square halves by a thin straight line across the middle.
- Each half is either blank or has pips (circular dots) printed on it, in a color that contrasts with the tile's background (commonly black dots on white/cream, or white dots on black/dark colors).
- Pips on each half always follow one of these 7 standard layouts, exactly like a die face — recognize WHICH layout each half matches, rather than counting isolated dots one by one:
  - 0 pips: the half is blank, no dots at all.
  - 1 pip: a single dot, centered.
  - 2 pips: two dots on opposite corners (diagonal).
  - 3 pips: three dots in a diagonal line (one corner, the center, the opposite corner).
  - 4 pips: four dots, one in each of the four corners.
  - 5 pips: four dots in the corners, plus one in the center.
  - 6 pips: six dots, arranged as two parallel columns of three.

TASKS

1. Decide if domino tiles are actually present in the image as described above. If you cannot confidently identify at least one domino tile, set tilesDetected to false, tileCount to 0, and tiles to an empty array.

2. If domino tiles ARE present, detect every tile visible, listed IN ORDER from left to right as they appear in the photo. For each tile, identify which of the 7 standard layouts above each half matches, separately for the left half and the right half. Each value must be an integer between 0 and 6. Ignore shadows, reflections, glare, printed text, table texture, tile borders, scratches, and anything in the background that is not a pip. Never invent tiles that are not visible, and never infer or guess pips you cannot actually see — if a tile is partially cut off at the frame edge, still report your best count for the visible side.

3. Decide if the result is reliable. Set reliable to true ONLY if ALL of the following hold:
   - Every tile is fully visible (none cut off at the frame edge).
   - The dividing line of every tile is visible.
   - Every pip on every tile is clearly and unambiguously countable — no blur, glare, extreme angle, occlusion, or tiles touching/overlapping in a way that hides pips.
   Otherwise set reliable to false. This is a binary decision, not a confidence scale — when in doubt, answer false.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tilesDetected: {
      type: "boolean",
      description:
        "True only if the image clearly shows domino tiles as described. False for any other subject matter, even if it contains dot-like patterns.",
    },
    tileCount: {
      type: "integer",
      minimum: 0,
      description: "Number of domino tiles detected.",
    },
    tiles: {
      type: "array",
      description: "One entry per detected tile, in left-to-right order.",
      items: {
        type: "object",
        properties: {
          left: { type: "integer", minimum: 0, maximum: 6 },
          right: { type: "integer", minimum: 0, maximum: 6 },
        },
        required: ["left", "right"],
      },
    },
    reliable: {
      type: "boolean",
      description:
        "Binary — true only if every tile and every pip was unambiguous. False otherwise, no in-between.",
    },
  },
  required: ["tilesDetected", "tileCount", "tiles", "reliable"],
};

export type GeminiDetectionErrorCode =
  | "no_api_key"
  | "network"
  | "http_error"
  | "invalid_response"
  | "timeout";

export class GeminiDetectionError extends Error {
  code: GeminiDetectionErrorCode;
  constructor(code: GeminiDetectionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GeminiDetectionError";
  }
}

export interface GeminiTile {
  left: number;
  right: number;
  /** Calculado en código (left + right), nunca confiado del modelo. */
  total: number;
}

export interface GeminiDetectionResult {
  /** false si la imagen claramente no muestra fichas de dominó — la app
   * debe tratar esto igual que "0 fichas detectadas" sin importar qué
   * valor traiga el resto, en vez de inferirlo combinando otros campos. */
  tilesDetected: boolean;
  tiles: GeminiTile[];
  /** Suma de tiles[].total — SIEMPRE calculada aquí, nunca tomada del
   * campo que el modelo pudiera devolver. Un LLM puede identificar bien
   * cada ficha individual y aun así sumar mal — separar "reconocer" de
   * "sumar" elimina esa fuente de error por completo. */
  totalDots: number;
  /** Binario, sin nivel "medio" — decisión de producto: o se confía en
   * el resultado o no, sin zona gris que complique la UI ni la lógica. */
  reliable: boolean;
}

/**
 * Verifica si hay una API key configurada — usado en `camera.tsx` para
 * decidir, ANTES de intentar nada, si el modo Gemini puede usarse o si
 * hay que avisar al usuario / forzar fallback a local.
 */
export function hasGeminiApiKey(): boolean {
  return !!process.env.EXPO_PUBLIC_GEMINI_API_KEY;
}

/**
 * Envía la imagen (ya recortada y validada en calidad por el llamador) a
 * Gemini y devuelve el desglose por ficha + el total (calculado en
 * código, ver nota en `GeminiDetectionResult`).
 *
 * @param base64Jpeg JPEG recortado, codificado en base64 (sin el prefijo
 *   "data:image/jpeg;base64,").
 */
export async function identifyTotalWithGemini(
  base64Jpeg: string,
): Promise<GeminiDetectionResult> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiDetectionError(
      "no_api_key",
      "EXPO_PUBLIC_GEMINI_API_KEY no está configurada",
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: "image/jpeg", data: base64Jpeg } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new GeminiDetectionError(
        "timeout",
        "Gemini no respondió a tiempo",
      );
    }
    throw new GeminiDetectionError(
      "network",
      `No se pudo conectar con Gemini: ${err?.message ?? err}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new GeminiDetectionError(
      "http_error",
      `Gemini devolvió ${response.status}: ${bodyText.slice(0, 300)}`,
    );
  }

  let data: any;
  try {
    data = await response.json();
  } catch (err) {
    throw new GeminiDetectionError(
      "invalid_response",
      "La respuesta de Gemini no es JSON válido",
    );
  }

  // El texto generado (ya forzado a JSON por responseSchema) viene dentro
  // de candidates[0].content.parts[0].text — se parsea de forma defensiva
  // porque, aunque responseSchema hace esto muy confiable, una respuesta
  // bloqueada por seguridad u otra causa puede no traer ese campo.
  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiDetectionError(
      "invalid_response",
      "Gemini no devolvió contenido (posible bloqueo de seguridad o respuesta vacía)",
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new GeminiDetectionError(
      "invalid_response",
      "No se pudo parsear el JSON devuelto por Gemini",
    );
  }

  const tilesDetected = parsed?.tilesDetected;
  const reliable = parsed?.reliable;
  const rawTiles = parsed?.tiles;

  if (typeof tilesDetected !== "boolean" || typeof reliable !== "boolean") {
    throw new GeminiDetectionError(
      "invalid_response",
      "El JSON de Gemini no tiene la forma esperada (tilesDetected/reliable)",
    );
  }

  // Si el modelo dice que no hay fichas, se ignora cualquier otro campo
  // que haya devuelto (defensa adicional, igual que antes) — tilesDetected
  // es la única fuente de verdad sobre si hay contenido válido.
  if (!tilesDetected) {
    return { tilesDetected: false, tiles: [], totalDots: 0, reliable };
  }

  if (!Array.isArray(rawTiles)) {
    throw new GeminiDetectionError(
      "invalid_response",
      "El JSON de Gemini no tiene la forma esperada (tiles no es un array)",
    );
  }

  const tiles: GeminiTile[] = [];
  for (const raw of rawTiles) {
    const left = Number(raw?.left);
    const right = Number(raw?.right);
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(right) ||
      left < 0 ||
      left > 6 ||
      right < 0 ||
      right > 6
    ) {
      throw new GeminiDetectionError(
        "invalid_response",
        "Una ficha del JSON de Gemini tiene valores fuera de rango (0-6)",
      );
    }
    const l = Math.round(left);
    const r = Math.round(right);
    // El total de cada ficha y la suma global se calculan aquí, nunca se
    // toman de un campo que el modelo pudiera haber devuelto — ver nota
    // en la interfaz `GeminiDetectionResult`.
    tiles.push({ left: l, right: r, total: l + r });
  }

  const totalDots = tiles.reduce((sum, tl) => sum + tl.total, 0);

  return { tilesDetected: true, tiles, totalDots, reliable };
}
