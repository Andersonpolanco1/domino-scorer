import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { THEMES, Theme } from "@/constants/themes";
import { Lang } from "@/constants/i18n";
import { DEFAULT_THRESH } from "@/utils/imageQuality";

export interface HistoryEntry {
  id: string;
  slot: 0 | 1;
  name: string;
  points: number;
  method: "manual" | "camera";
  bonus?: "capicua" | "pase";
  timestamp: number;
}

export interface Tournament {
  id: string;
  names: [string, string];
  scores: [number, number];
  target: number;
  history: HistoryEntry[];
  winner: 0 | 1 | null;
  endedAt: number;
  reason: "win" | "reset";
}

// ─── Quota de scans gratuitos ─────────────────────────────────────────────────

export const FREE_SCANS_PER_DAY = 3;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // "2025-06-16"
}

// ─── Modo de detección por cámara (TEMPORAL, solo desarrollo) ─────────────────
//
// Permite alternar entre el algoritmo de visión computacional 100% local
// (todavía en afinamiento) y la API de Gemini (usada para poder probar el
// flujo completo de la app en despliegue mientras el algoritmo local
// madura). Esto se moverá a una variable de entorno en el futuro — por
// ahora vive en Settings para poder cambiarlo sin rebuild.
export type DetectionMode = "local" | "gemini";

// ─── Calibración de captura (TEMPORAL, solo desarrollo) ───────────────────
//
// Mueve los umbrales de `imageQuality.ts` (antes hardcodeados en el
// código) y el alto mínimo de recuadro de `camera.tsx` a algo editable
// desde Settings, persistido — para poder calibrar en campo (probando en
// distintas luces/dispositivos reales) sin tener que hacer un build
// nuevo cada vez que un valor no calza. Los defaults de fábrica viven en
// `utils/imageQuality.ts` (`DEFAULT_THRESH`) y se copian aquí al
// inicializar — este store es la fuente de verdad mientras la app corre,
// no `imageQuality.ts`.
export interface LocalQualityCalibration {
  minMeanBrightness: number;
  maxMeanBrightness: number;
  maxSaturatedRatio: number;
  maxDarkRatio: number;
  minContrastRange: number;
  maxShadowUnevenness: number;
  minSharpness: number;
}

export interface GeminiQualityCalibration {
  minMeanBrightness: number;
  maxMeanBrightness: number;
  maxSaturatedRatio: number;
  maxDarkRatio: number;
  minSharpness: number;
}

export interface Calibration {
  local: LocalQualityCalibration;
  gemini: GeminiQualityCalibration;
  /** Alto mínimo (px, en la foto de trabajo de 700px de ancho) del
   * recuadro de marcadores para intentar la captura — ver `camera.tsx`. */
  minTileRectHeightPx: number;
}

export const DEFAULT_CALIBRATION: Calibration = {
  // Se construyen a partir de `DEFAULT_THRESH` (imageQuality.ts) en vez de
  // repetir los números aquí — una sola fuente de verdad para los
  // valores de fábrica, sin riesgo de que este archivo y ese queden
  // desincronizados si alguno se edita después.
  local: { ...DEFAULT_THRESH.local } as LocalQualityCalibration,
  gemini: { ...DEFAULT_THRESH.gemini } as GeminiQualityCalibration,
  minTileRectHeightPx: 50,
};

// ─── Tipos del store ──────────────────────────────────────────────────────────

interface GameState {
  names: [string, string];
  scores: [number, number];
  target: number;
  history: HistoryEntry[];
  tournaments: Tournament[];
  themeIndex: number;
  theme: Theme;
  lang: Lang;
  isPro: boolean;
  adsRemoved: boolean;
  detectionMode: DetectionMode;
  calibration: Calibration;

  // Scan quota (free tier)
  dailyScanCount: number; // scans usados hoy
  lastScanDate: string; // "YYYY-MM-DD" del último scan

  // Special plays
  capicuaEnabled: boolean;
  capicuaPoints: number;
  paseEnabled: boolean;
  pasePoints: number;

  // Actions
  setName: (slot: 0 | 1, name: string) => void;
  addPoints: (
    slot: 0 | 1,
    points: number,
    method: "manual" | "camera",
    bonus?: "capicua" | "pase",
  ) => void;
  undoLast: () => void;
  deleteEntry: (id: string) => void;
  archiveAndReset: (reason: "win" | "reset", winner: 0 | 1 | null) => void;
  deleteTournament: (id: string) => void;
  setTarget: (target: number) => void;
  setTheme: (index: number) => void;
  setLang: (lang: Lang) => void;
  setPro: (v: boolean) => void;
  setAdsRemoved: (v: boolean) => void;
  setDetectionMode: (mode: DetectionMode) => void;
  setQualityCalibrationValue: (
    profile: "local" | "gemini",
    key: string,
    value: number,
  ) => void;
  setMinTileRectHeightPx: (value: number) => void;
  resetCalibration: () => void;
  setCapicua: (enabled: boolean, points?: number) => void;
  setPase: (enabled: boolean, points?: number) => void;
  loadFromStorage: () => Promise<void>;
  exportBackup: () => object;
  importBackup: (data: any) => boolean;

  // Scan quota actions
  canScan: () => boolean; // ¿puede hacer un scan ahora?
  consumeScan: () => void; // registra un scan consumido
  scansRemaining: () => number; // cuántos le quedan hoy
}

const STORAGE_KEY = "domino_state_v3";

export const useGameStore = create<GameState>((set, get) => ({
  names: ["Corto", "Largo"],
  scores: [0, 0],
  target: 200,
  history: [],
  tournaments: [],
  themeIndex: 0,
  theme: THEMES[0],
  lang: "es",
  isPro: false,
  adsRemoved: false,
  detectionMode: "local",
  calibration: DEFAULT_CALIBRATION,
  dailyScanCount: 0,
  lastScanDate: "",
  capicuaEnabled: true,
  capicuaPoints: 25,
  paseEnabled: true,
  pasePoints: 25,

  // ── Scan quota ──────────────────────────────────────────────────────────────

  canScan: () => {
    const { isPro, dailyScanCount, lastScanDate } = get();
    if (isPro) return true;
    if (lastScanDate !== todayKey()) return true; // nuevo día, contador resetea
    return dailyScanCount < FREE_SCANS_PER_DAY;
  },

  consumeScan: () => {
    const { dailyScanCount, lastScanDate } = get();
    const today = todayKey();
    const newCount = lastScanDate === today ? dailyScanCount + 1 : 1;
    set({ dailyScanCount: newCount, lastScanDate: today });
    persist(get());
  },

  scansRemaining: () => {
    const { isPro, dailyScanCount, lastScanDate } = get();
    if (isPro) return FREE_SCANS_PER_DAY;
    if (lastScanDate !== todayKey()) return FREE_SCANS_PER_DAY;
    return Math.max(0, FREE_SCANS_PER_DAY - dailyScanCount);
  },

  // ── Juego ───────────────────────────────────────────────────────────────────

  setName: (slot, name) => {
    const names = [...get().names] as [string, string];
    names[slot] = name;
    set({ names });
    persist(get());
  },

  addPoints: (slot, points, method, bonus) => {
    const scores = [...get().scores] as [number, number];
    scores[slot] += points;
    const entry: HistoryEntry = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      slot,
      name: get().names[slot],
      points,
      method,
      bonus,
      timestamp: Date.now(),
    };
    const history = [entry, ...get().history];
    set({ scores, history });
    persist({ ...get(), scores, history });
  },

  undoLast: () => {
    const { history, scores } = get();
    if (!history.length) return;
    const last = history[0];
    const ns = [...scores] as [number, number];
    ns[last.slot] = Math.max(0, ns[last.slot] - last.points);
    const nh = history.slice(1);
    set({ scores: ns, history: nh });
    persist({ ...get(), scores: ns, history: nh });
  },

  deleteEntry: (id) => {
    const { history, scores } = get();
    const e = history.find((h) => h.id === id);
    if (!e) return;
    const ns = [...scores] as [number, number];
    ns[e.slot] = Math.max(0, ns[e.slot] - e.points);
    const nh = history.filter((h) => h.id !== id);
    set({ scores: ns, history: nh });
    persist({ ...get(), scores: ns, history: nh });
  },

  archiveAndReset: (reason, winner) => {
    const { names, scores, target, history, tournaments } = get();
    let nt = tournaments;
    if (reason === "win" && winner !== null && history.length > 0) {
      const tour: Tournament = {
        id: Date.now().toString(),
        names: [...names] as [string, string],
        scores: [...scores] as [number, number],
        target,
        history: [...history],
        winner,
        endedAt: Date.now(),
        reason,
      };
      nt = [tour, ...tournaments].slice(0, 200);
    }
    set({ scores: [0, 0], history: [], tournaments: nt });
    persist({ ...get(), scores: [0, 0], history: [], tournaments: nt });
  },

  deleteTournament: (id) => {
    const nt = get().tournaments.filter((t) => t.id !== id);
    set({ tournaments: nt });
    persist({ ...get(), tournaments: nt });
  },

  setTarget: (target) => {
    set({ target });
    persist({ ...get(), target });
  },
  setTheme: (index) => {
    set({ themeIndex: index, theme: THEMES[index] });
    persist({ ...get(), themeIndex: index });
  },
  setLang: (lang) => {
    set({ lang });
    persist({ ...get(), lang });
  },
  setPro: (v) => {
    set({ isPro: v });
    persist({ ...get(), isPro: v });
  },
  setAdsRemoved: (v) => {
    set({ adsRemoved: v });
    persist({ ...get(), adsRemoved: v });
  },
  setDetectionMode: (mode) => {
    set({ detectionMode: mode });
    persist({ ...get(), detectionMode: mode });
  },

  setQualityCalibrationValue: (profile, key, value) => {
    const calibration = {
      ...get().calibration,
      [profile]: { ...get().calibration[profile], [key]: value },
    };
    set({ calibration });
    persist({ ...get(), calibration });
  },

  setMinTileRectHeightPx: (value) => {
    const calibration = { ...get().calibration, minTileRectHeightPx: value };
    set({ calibration });
    persist({ ...get(), calibration });
  },

  resetCalibration: () => {
    // Copia profunda — sin esto, `calibration` apuntaría al MISMO objeto
    // `DEFAULT_CALIBRATION` exportado, y una edición posterior mutaría el
    // default "de fábrica" en memoria para el resto de la sesión.
    const calibration: Calibration = {
      local: { ...DEFAULT_CALIBRATION.local },
      gemini: { ...DEFAULT_CALIBRATION.gemini },
      minTileRectHeightPx: DEFAULT_CALIBRATION.minTileRectHeightPx,
    };
    set({ calibration });
    persist({ ...get(), calibration });
  },

  setCapicua: (enabled, points) => {
    set({
      capicuaEnabled: enabled,
      ...(points !== undefined ? { capicuaPoints: points } : {}),
    });
    persist(get());
  },
  setPase: (enabled, points) => {
    set({
      paseEnabled: enabled,
      ...(points !== undefined ? { pasePoints: points } : {}),
    });
    persist(get());
  },

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const idx =
          (s.themeIndex ?? 0) < THEMES.length ? (s.themeIndex ?? 0) : 0;
        set({
          names: s.names ?? ["Corto", "Largo"],
          scores: s.scores ?? [0, 0],
          target: s.target ?? 200,
          history: s.history ?? [],
          tournaments: s.tournaments ?? [],
          themeIndex: idx,
          theme: THEMES[idx],
          lang: s.lang ?? "es",
          isPro: s.isPro ?? false,
          adsRemoved: s.adsRemoved ?? false,
          // Fallback seguro a 'local': si el valor guardado no es uno de
          // los dos modos válidos (dato corrupto, versión vieja del
          // storage, etc.), nunca debe arrancar en un modo desconocido.
          detectionMode: s.detectionMode === "gemini" ? "gemini" : "local",
          // Fusión campo por campo con los defaults, no un reemplazo
          // completo del objeto guardado — así, si en el futuro se agrega
          // un nuevo umbral calibrable, una instalación con un storage
          // viejo (que no lo tiene) lo recibe con su valor de fábrica en
          // vez de quedar `undefined` y romper los cálculos en
          // `imageQuality.ts`.
          calibration: {
            local: { ...DEFAULT_CALIBRATION.local, ...s.calibration?.local },
            gemini: {
              ...DEFAULT_CALIBRATION.gemini,
              ...s.calibration?.gemini,
            },
            minTileRectHeightPx:
              typeof s.calibration?.minTileRectHeightPx === "number"
                ? s.calibration.minTileRectHeightPx
                : DEFAULT_CALIBRATION.minTileRectHeightPx,
          },
          dailyScanCount: s.dailyScanCount ?? 0,
          lastScanDate: s.lastScanDate ?? "",
          capicuaEnabled: s.capicuaEnabled ?? true,
          capicuaPoints: s.capicuaPoints ?? 25,
          paseEnabled: s.paseEnabled ?? true,
          pasePoints: s.pasePoints ?? 25,
        });
      }
    } catch (e) {
      console.warn("load error", e);
    }
  },

  exportBackup: () => {
    const st = get();
    return {
      _app: "domino-scorer",
      _version: 3,
      _exportedAt: new Date().toISOString(),
      names: st.names,
      scores: st.scores,
      target: st.target,
      history: st.history,
      tournaments: st.tournaments,
      themeIndex: st.themeIndex,
      lang: st.lang,
      capicuaEnabled: st.capicuaEnabled,
      capicuaPoints: st.capicuaPoints,
      paseEnabled: st.paseEnabled,
      pasePoints: st.pasePoints,
    };
  },

  importBackup: (data: any) => {
    try {
      if (
        !data ||
        data._app !== "domino-scorer" ||
        !Array.isArray(data.tournaments)
      )
        return false;
      const idx =
        (data.themeIndex ?? 0) < THEMES.length ? (data.themeIndex ?? 0) : 0;
      const restored = {
        names: data.names ?? ["Corto", "Largo"],
        scores: data.scores ?? [0, 0],
        target: data.target ?? 200,
        history: data.history ?? [],
        tournaments: data.tournaments ?? [],
        themeIndex: idx,
        theme: THEMES[idx],
        lang: data.lang ?? "es",
        capicuaEnabled: data.capicuaEnabled ?? true,
        capicuaPoints: data.capicuaPoints ?? 25,
        paseEnabled: data.paseEnabled ?? true,
        pasePoints: data.pasePoints ?? 25,
      };
      set(restored);
      persist({ ...get(), ...restored });
      return true;
    } catch (e) {
      console.warn("import error", e);
      return false;
    }
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeStats(tournaments: Tournament[]) {
  const winsByName: Record<string, number> = {};
  const gamesByName: Record<string, number> = {};
  let totalGames = 0;
  for (const tour of tournaments) {
    totalGames++;
    tour.names.forEach((n) => {
      gamesByName[n] = (gamesByName[n] ?? 0) + 1;
    });
    if (tour.winner !== null) {
      const wn = tour.names[tour.winner];
      winsByName[wn] = (winsByName[wn] ?? 0) + 1;
    }
  }
  const leaderboard = Object.keys(gamesByName)
    .map((name) => ({
      name,
      games: gamesByName[name],
      wins: winsByName[name] ?? 0,
      winRate: gamesByName[name]
        ? Math.round(((winsByName[name] ?? 0) / gamesByName[name]) * 100)
        : 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
  return { totalGames, leaderboard };
}

export function parsePoints(input: string): number {
  if (!input) return 0;
  const cleaned = input.replace(/[^0-9+\-]/g, "");
  if (!cleaned) return 0;
  const tokens = cleaned.match(/[+\-]?\d+/g);
  if (!tokens) return 0;
  let sum = 0;
  for (const tok of tokens) sum += parseInt(tok, 10);
  return Math.max(0, sum);
}

async function persist(state: Partial<GameState>) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        names: state.names,
        scores: state.scores,
        target: state.target,
        history: state.history,
        tournaments: state.tournaments,
        themeIndex: state.themeIndex,
        lang: state.lang,
        isPro: state.isPro,
        adsRemoved: state.adsRemoved,
        detectionMode: state.detectionMode,
        calibration: state.calibration,
        dailyScanCount: state.dailyScanCount,
        lastScanDate: state.lastScanDate,
        capicuaEnabled: state.capicuaEnabled,
        capicuaPoints: state.capicuaPoints,
        paseEnabled: state.paseEnabled,
        pasePoints: state.pasePoints,
      }),
    );
  } catch (e) {
    console.warn("save error", e);
  }
}
