// Professional themes inspired by Azure Portal. No festive themes.
export interface Theme {
  name: string;
  nameEn: string;
  mode: 'light' | 'dark';
  pro: boolean;        // requires Pro unlock
  accent: string;
  accentHover: string;
  accentSoft: string;
  team1: string;
  team2: string;
  team1Soft: string;
  team2Soft: string;
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  border: string;
  borderStrong: string;
  tabBar: string;
  danger: string;
  success: string;
}

export const THEMES: Theme[] = [
  {
    name: 'Claro', nameEn: 'Light', mode: 'light', pro: false,
    accent: '#0078D4', accentHover: '#106EBE', accentSoft: '#EFF6FC',
    team1: '#0078D4', team2: '#3A4A5C', team1Soft: '#EFF6FC', team2Soft: '#F0F2F5',
    bg: '#FAFAFA', card: '#FFFFFF', cardAlt: '#F3F4F6',
    text: '#1B1A19', textMuted: '#605E5C', textSubtle: '#8A8886',
    border: '#EDEBE9', borderStrong: '#D2D0CE', tabBar: '#FFFFFF',
    danger: '#D13438', success: '#107C10',
  },
  {
    name: 'Oscuro', nameEn: 'Dark', mode: 'dark', pro: false,
    accent: '#2899F5', accentHover: '#4AABFF', accentSoft: '#11243A',
    team1: '#2899F5', team2: '#9DA9B7', team1Soft: '#11243A', team2Soft: '#1E2329',
    bg: '#0B0E14', card: '#161B22', cardAlt: '#1F2630',
    text: '#E6EDF3', textMuted: '#9DA7B3', textSubtle: '#6E7681',
    border: '#262C36', borderStrong: '#363D49', tabBar: '#11151C',
    danger: '#F1707B', success: '#3FB950',
  },
  {
    name: 'Pizarra', nameEn: 'Slate', mode: 'dark', pro: true,
    accent: '#5B8DEF', accentHover: '#7BA5F5', accentSoft: '#1A2436',
    team1: '#5B8DEF', team2: '#C0A172', team1Soft: '#1A2436', team2Soft: '#2A2620',
    bg: '#13161C', card: '#1C212B', cardAlt: '#262C38',
    text: '#E8EBF0', textMuted: '#A0A8B5', textSubtle: '#6B7280',
    border: '#2A303C', borderStrong: '#3A4150', tabBar: '#171A21',
    danger: '#EF6F7B', success: '#4ABA6A',
  },
  {
    name: 'Esmeralda', nameEn: 'Emerald', mode: 'light', pro: true,
    accent: '#0E8A6E', accentHover: '#0B6F58', accentSoft: '#E8F6F1',
    team1: '#0E8A6E', team2: '#4A5568', team1Soft: '#E8F6F1', team2Soft: '#EEF0F3',
    bg: '#F7FAF9', card: '#FFFFFF', cardAlt: '#EEF4F2',
    text: '#16241F', textMuted: '#52605A', textSubtle: '#8A938E',
    border: '#E3EBE8', borderStrong: '#C9D6D1', tabBar: '#FFFFFF',
    danger: '#D13438', success: '#0E8A6E',
  },
  {
    name: 'Medianoche', nameEn: 'Midnight', mode: 'dark', pro: true,
    accent: '#8B7CF6', accentHover: '#A593F8', accentSoft: '#1E1B33',
    team1: '#8B7CF6', team2: '#6B9DC7', team1Soft: '#1E1B33', team2Soft: '#16222E',
    bg: '#0C0B14', card: '#15131F', cardAlt: '#1F1C2C',
    text: '#E9E6F2', textMuted: '#A29DB5', textSubtle: '#6B6580',
    border: '#241F33', borderStrong: '#352E47', tabBar: '#100E18',
    danger: '#F1707B', success: '#3FB950',
  },
];

export const FREE_THEME_COUNT = 2;
