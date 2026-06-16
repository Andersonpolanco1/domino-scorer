import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useGameStore, computeStats } from '@/hooks/useGameStore';
import { t } from '@/constants/i18n';
import AdBanner from '@/components/AdBanner';

export default function StatsScreen() {
  const { tournaments, theme, lang } = useGameStore();
  const s = styles(theme);
  const { totalGames, leaderboard } = computeStats(tournaments);
  const maxWins = Math.max(1, ...leaderboard.map(l => l.wins));

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}><Text style={s.pageTitle}>{t(lang, 'statsTitle')}</Text></View>

      {totalGames === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon}><Ionicons name="stats-chart-outline" size={26} color={theme.textSubtle} /></View>
          <Text style={s.emptyTitle}>{t(lang, 'noStats')}</Text>
          <Text style={s.emptySub}>{t(lang, 'noStatsSub')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4 }} showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <View style={s.summaryRow}>
            <View style={s.summaryCard}>
              <Text style={s.summaryNum}>{totalGames}</Text>
              <Text style={s.summaryLabel}>{t(lang, 'totalGames')}</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryNum}>{leaderboard.length}</Text>
              <Text style={s.summaryLabel}>{t(lang, 'players')}</Text>
            </View>
          </View>

          {/* Leaderboard with bar chart */}
          <Text style={s.sectionLabel}>{t(lang, 'winRate').toUpperCase()}</Text>
          <View style={s.card}>
            {leaderboard.map((row, i) => (
              <View key={row.name} style={[s.lbRow, i < leaderboard.length - 1 && s.lbBorder]}>
                <View style={s.lbRank}><Text style={s.lbRankTxt}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <View style={s.lbNameRow}>
                    <Text style={s.lbName} numberOfLines={1}>{row.name}</Text>
                    <Text style={s.lbWins}>{row.wins}W · {row.games}{lang === 'es' ? 'P' : 'G'}</Text>
                  </View>
                  <View style={s.lbBarBg}>
                    <View style={[s.lbBarFill, { width: `${(row.wins / maxWins) * 100}%`, backgroundColor: theme.accent }]} />
                  </View>
                </View>
                <Text style={[s.lbPct, { color: theme.accent }]}>{row.winRate}%</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      <AdBanner />
    </SafeAreaView>
  );
}

const styles = (t: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: t.text, letterSpacing: -0.5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: t.cardAlt, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: t.text },
  emptySub: { fontSize: 13, color: t.textMuted, textAlign: 'center', lineHeight: 19 },
  summaryRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  summaryCard: { flex: 1, backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, padding: 16, alignItems: 'center' },
  summaryNum: { fontSize: 32, fontWeight: '700', color: t.text, letterSpacing: -1 },
  summaryLabel: { fontSize: 12, color: t.textMuted, marginTop: 2, fontWeight: '600' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: t.textSubtle, letterSpacing: 0.8, marginBottom: 8 },
  card: { backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, overflow: 'hidden' },
  lbRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  lbBorder: { borderBottomWidth: 1, borderBottomColor: t.border },
  lbRank: { width: 26, height: 26, borderRadius: 13, backgroundColor: t.cardAlt, alignItems: 'center', justifyContent: 'center' },
  lbRankTxt: { fontSize: 12, fontWeight: '700', color: t.textMuted },
  lbNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  lbName: { fontSize: 14, fontWeight: '600', color: t.text, flex: 1 },
  lbWins: { fontSize: 11, color: t.textSubtle, fontWeight: '600' },
  lbBarBg: { height: 5, backgroundColor: t.cardAlt, borderRadius: 3, overflow: 'hidden' },
  lbBarFill: { height: 5, borderRadius: 3 },
  lbPct: { fontSize: 15, fontWeight: '700', minWidth: 42, textAlign: 'right' },
});
