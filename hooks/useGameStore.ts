import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEMES, Theme } from '@/constants/themes';
import { Lang } from '@/constants/i18n';

export interface HistoryEntry {
  id: string;
  slot: 0 | 1;                  // team index
  name: string;
  points: number;
  method: 'manual' | 'camera';
  bonus?: 'capicua' | 'pase';   // special play applied to this entry
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
  reason: 'win' | 'reset';
}

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

  // Special plays config
  capicuaEnabled: boolean;
  capicuaPoints: number;
  paseEnabled: boolean;
  pasePoints: number;

  setName: (slot: 0 | 1, name: string) => void;
  addPoints: (slot: 0 | 1, points: number, method: 'manual' | 'camera', bonus?: 'capicua' | 'pase') => void;
  undoLast: () => void;
  deleteEntry: (id: string) => void;
  archiveAndReset: (reason: 'win' | 'reset', winner: 0 | 1 | null) => void;
  deleteTournament: (id: string) => void;
  setTarget: (target: number) => void;
  setTheme: (index: number) => void;
  setLang: (lang: Lang) => void;
  setPro: (v: boolean) => void;
  setAdsRemoved: (v: boolean) => void;
  setCapicua: (enabled: boolean, points?: number) => void;
  setPase: (enabled: boolean, points?: number) => void;
  loadFromStorage: () => Promise<void>;
  exportBackup: () => object;          // returns full state snapshot for backup
  importBackup: (data: any) => boolean; // restores from a backup object; returns success
}

const STORAGE_KEY = 'domino_state_v3';

export const useGameStore = create<GameState>((set, get) => ({
  names: ['Corto', 'Largo'],
  scores: [0, 0],
  target: 200,
  history: [],
  tournaments: [],
  themeIndex: 0,
  theme: THEMES[0],
  lang: 'es',
  isPro: false,
  adsRemoved: false,
  capicuaEnabled: true,
  capicuaPoints: 25,
  paseEnabled: true,
  pasePoints: 25,

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
      slot, name: get().names[slot], points, method, bonus, timestamp: Date.now(),
    };
    const history = [entry, ...get().history];
    set({ scores, history });
    persist({ ...get(), scores, history });
  },

  undoLast: () => {
    const { history, scores } = get();
    if (!history.length) return;
    const last = history[0];
    const ns = [...scores] as [number, number]; ns[last.slot] = Math.max(0, ns[last.slot] - last.points);
    const nh = history.slice(1);
    set({ scores: ns, history: nh });
    persist({ ...get(), scores: ns, history: nh });
  },

  deleteEntry: (id) => {
    const { history, scores } = get();
    const e = history.find(h => h.id === id);
    if (!e) return;
    const ns = [...scores] as [number, number]; ns[e.slot] = Math.max(0, ns[e.slot] - e.points);
    const nh = history.filter(h => h.id !== id);
    set({ scores: ns, history: nh });
    persist({ ...get(), scores: ns, history: nh });
  },

  archiveAndReset: (reason, winner) => {
    const { names, scores, target, history, tournaments } = get();
    let nt = tournaments;
    if (history.length > 0) {
      const tour: Tournament = {
        id: Date.now().toString(), names: [...names] as [string, string], scores: [...scores] as [number, number],
        target, history: [...history], winner, endedAt: Date.now(), reason,
      };
      nt = [tour, ...tournaments].slice(0, 200);
    }
    set({ scores: [0, 0], history: [], tournaments: nt });
    persist({ ...get(), scores: [0, 0], history: [], tournaments: nt });
  },

  deleteTournament: (id) => {
    const nt = get().tournaments.filter(t => t.id !== id);
    set({ tournaments: nt });
    persist({ ...get(), tournaments: nt });
  },

  setTarget: (target) => { set({ target }); persist({ ...get(), target }); },
  setTheme: (index) => { set({ themeIndex: index, theme: THEMES[index] }); persist({ ...get(), themeIndex: index }); },
  setLang: (lang) => { set({ lang }); persist({ ...get(), lang }); },
  setPro: (v) => { set({ isPro: v }); persist({ ...get(), isPro: v }); },
  setAdsRemoved: (v) => { set({ adsRemoved: v }); persist({ ...get(), adsRemoved: v }); },
  setCapicua: (enabled, points) => { set({ capicuaEnabled: enabled, ...(points !== undefined ? { capicuaPoints: points } : {}) }); persist(get()); },
  setPase: (enabled, points) => { set({ paseEnabled: enabled, ...(points !== undefined ? { pasePoints: points } : {}) }); persist(get()); },

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const idx = (s.themeIndex ?? 0) < THEMES.length ? (s.themeIndex ?? 0) : 0;
        set({
          names: s.names ?? ['Corto', 'Largo'],
          scores: s.scores ?? [0, 0],
          target: s.target ?? 200,
          history: s.history ?? [],
          tournaments: s.tournaments ?? [],
          themeIndex: idx,
          theme: THEMES[idx],
          lang: s.lang ?? 'es',
          isPro: s.isPro ?? false,
          adsRemoved: s.adsRemoved ?? false,
          capicuaEnabled: s.capicuaEnabled ?? true,
          capicuaPoints: s.capicuaPoints ?? 25,
          paseEnabled: s.paseEnabled ?? true,
          pasePoints: s.pasePoints ?? 25,
        });
      }
    } catch (e) { console.warn('load error', e); }
  },

  // Returns a snapshot of everything worth backing up.
  exportBackup: () => {
    const st = get();
    return {
      _app: 'domino-scorer',
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

  // Restores from a backup object. Validates the file is one of ours.
  importBackup: (data: any) => {
    try {
      if (!data || data._app !== 'domino-scorer' || !Array.isArray(data.tournaments)) return false;
      const idx = (data.themeIndex ?? 0) < THEMES.length ? (data.themeIndex ?? 0) : 0;
      const restored = {
        names: data.names ?? ['Corto', 'Largo'],
        scores: data.scores ?? [0, 0],
        target: data.target ?? 200,
        history: data.history ?? [],
        tournaments: data.tournaments ?? [],
        themeIndex: idx,
        theme: THEMES[idx],
        lang: data.lang ?? 'es',
        capicuaEnabled: data.capicuaEnabled ?? true,
        capicuaPoints: data.capicuaPoints ?? 25,
        paseEnabled: data.paseEnabled ?? true,
        pasePoints: data.pasePoints ?? 25,
      };
      set(restored);
      persist({ ...get(), ...restored });
      return true;
    } catch (e) { console.warn('import error', e); return false; }
  },
}));

export function computeStats(tournaments: Tournament[]) {
  const winsByName: Record<string, number> = {};
  const gamesByName: Record<string, number> = {};
  let totalGames = 0;
  for (const tour of tournaments) {
    totalGames++;
    tour.names.forEach(n => { gamesByName[n] = (gamesByName[n] ?? 0) + 1; });
    if (tour.winner !== null) { const wn = tour.names[tour.winner]; winsByName[wn] = (winsByName[wn] ?? 0) + 1; }
  }
  const leaderboard = Object.keys(gamesByName).map(name => ({
    name, games: gamesByName[name], wins: winsByName[name] ?? 0,
    winRate: gamesByName[name] ? Math.round(((winsByName[name] ?? 0) / gamesByName[name]) * 100) : 0,
  })).sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
  return { totalGames, leaderboard };
}

export function parsePoints(input: string): number {
  if (!input) return 0;
  const cleaned = input.replace(/[^0-9+\-]/g, '');
  if (!cleaned) return 0;
  const tokens = cleaned.match(/[+\-]?\d+/g);
  if (!tokens) return 0;
  let sum = 0;
  for (const tok of tokens) sum += parseInt(tok, 10);
  return Math.max(0, sum);
}

async function persist(state: Partial<GameState>) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
      names: state.names, scores: state.scores, target: state.target,
      history: state.history, tournaments: state.tournaments, themeIndex: state.themeIndex,
      lang: state.lang, isPro: state.isPro, adsRemoved: state.adsRemoved,
      capicuaEnabled: state.capicuaEnabled, capicuaPoints: state.capicuaPoints,
      paseEnabled: state.paseEnabled, pasePoints: state.pasePoints,
    }));
  } catch (e) { console.warn('save error', e); }
}
