import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Modal, ScrollView } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useGameStore } from '@/hooks/useGameStore';
import { t } from '@/constants/i18n';
import AdBanner from '@/components/AdBanner';

export default function ScoreScreen() {
  const { names, scores, target, theme, lang, history,
          capicuaEnabled, capicuaPoints, paseEnabled, pasePoints,
          addPoints, undoLast, deleteEntry, archiveAndReset, setName } = useGameStore();
  const [activeTeam, setActiveTeam] = useState<0 | 1 | null>(null); // which team's keypad is open
  const [expr, setExpr] = useState('');                            // current expression e.g. "6+3+9"
  const [renaming, setRenaming] = useState<0 | 1 | null>(null);
  const [newName, setNewName] = useState('');
  const [winnerIdx, setWinnerIdx] = useState<number | null>(null);
  const [isLisa, setIsLisa] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const s = styles(theme);

  const teamColor = (i: number) => (i === 0 ? theme.team1 : theme.team2);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2400); };

  // Evaluate an expression like "6+3+9" safely (only digits and +)
  const evalExpr = (e: string): number => {
    if (!e) return 0;
    const parts = e.split('+').filter(p => p !== '');
    let sum = 0;
    for (const p of parts) sum += parseInt(p, 10) || 0;
    return sum;
  };

  // Dynamic font size: shrinks as the expression grows so more fits on one line.
  const exprFontSize = (e: string): number => {
    const len = e.length;
    if (len <= 9) return 26;
    if (len >= 22) return 15;          // floor — below this we rely on horizontal scroll
    // linear interpolation between 26px (len 9) and 15px (len 22)
    return Math.round(26 - ((len - 9) / (22 - 9)) * (26 - 15));
  };

  const checkWin = (i: number, added: number) => {
    if (scores[i] + added >= target) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const opp = i === 0 ? 1 : 0;
      setIsLisa(scores[opp] === 0);
      setWinnerIdx(i);
    }
  };

  // Open keypad for a team
  const openKeypad = (i: 0 | 1) => {
    Haptics.selectionAsync();
    setActiveTeam(i);
    setExpr('');
  };
  const closeKeypad = () => { setActiveTeam(null); setExpr(''); };

  // Keypad input
  const pressDigit = (d: string) => {
    setExpr(prev => {
      // Safety cap only — high enough to never block real play.
      if (prev.length >= 60) return prev;
      // Prevent a number segment from growing beyond 3 digits (max tile/sum is small).
      const lastSegment = prev.split('+').pop() ?? '';
      if (lastSegment.length >= 3) return prev;
      return prev + d;
    });
  };
  const pressPlus = () => {
    setExpr(prev => {
      if (prev === '' || prev.endsWith('+')) return prev; // no leading or double +
      return prev + '+';
    });
  };
  // Smart backspace: tap = remove one char, long-press = clear all
  const pressBackspace = () => setExpr(prev => prev.slice(0, -1));
  const longPressClear = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setExpr(''); };

  // Confirm the typed points
  const confirmEntry = () => {
    if (activeTeam === null) return;
    const val = evalExpr(expr);
    if (val <= 0) { closeKeypad(); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addPoints(activeTeam, val, 'manual');
    checkWin(activeTeam, val);
    closeKeypad();
  };

  // Special plays — apply directly to the active team
  const applySpecial = (type: 'capicua' | 'pase') => {
    if (activeTeam === null) return;
    const pts = type === 'capicua' ? capicuaPoints : pasePoints;
    // Pase corrido (Dominican rule): only counts if result stays STRICTLY below target.
    if (type === 'pase' && scores[activeTeam] + pts >= target) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showToast(t(lang, 'paseNoCabe', { n: Math.max(0, target - 1 - scores[activeTeam]) }));
      closeKeypad();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    addPoints(activeTeam, pts, 'manual', type);
    checkWin(activeTeam, pts);
    closeKeypad();
  };

  const handleReset = () => {
    if (history.length === 0) { archiveAndReset('reset', null); return; }
    Alert.alert(t(lang, 'resetConfirmTitle'), t(lang, 'resetConfirmMsg'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      { text: t(lang, 'reset'), style: 'destructive', onPress: () => { archiveAndReset('reset', null); setWinnerIdx(null); } },
    ]);
  };

  const startRename = (i: 0 | 1) => { setNewName(names[i]); setRenaming(i); };
  const confirmRename = () => { if (renaming !== null && newName.trim()) setName(renaming, newName.trim()); setRenaming(null); };

  const total = history.length;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={s.logo}>
            <View style={[s.pip, { top: 5, left: 5 }]} /><View style={[s.pip, { top: 5, right: 5 }]} />
            <View style={[s.pip, { bottom: 5, left: 5 }]} /><View style={[s.pip, { bottom: 5, right: 5 }]} />
          </View>
          <Text style={s.title}>{t(lang, 'appName')}</Text>
        </View>
        <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); undoLast(); }} style={s.iconBtn}>
          <Ionicons name="arrow-undo-outline" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Team cards — tap to score */}
        <View style={s.scoreRow}>
          {[0, 1].map(i => {
            const pct = Math.min(scores[i] / target, 1);
            const color = teamColor(i);
            const isActive = activeTeam === i;
            return (
              <TouchableOpacity key={i} style={[s.teamCard, isActive && { borderColor: color, borderWidth: 2 }]} onPress={() => openKeypad(i as 0 | 1)} activeOpacity={0.85}>
                <View style={s.nameRow}>
                  <Text style={s.teamName} numberOfLines={1}>{names[i]}</Text>
                  <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); startRename(i as 0 | 1); }} hitSlop={8}>
                    <Ionicons name="pencil-outline" size={11} color={theme.textSubtle} />
                  </TouchableOpacity>
                </View>
                <Text style={[s.score, { color }]}>{scores[i]}</Text>
                <View style={s.progBg}><View style={[s.progFill, { width: `${pct * 100}%`, backgroundColor: color }]} /></View>
                <Text style={[s.tapHint, isActive && { color }]}>{isActive ? t(lang, 'scoring') : `${scores[i]} / ${target}`}</Text>
              </TouchableOpacity>
            );
          })}
          <View style={s.vsBadge}><Text style={s.vsTxt}>{t(lang, 'vs')}</Text></View>
        </View>

        {activeTeam === null && (
          <Text style={s.tapToScore}>{t(lang, 'tapToScore')}</Text>
        )}

        {/* Hands */}
        <View style={s.handsHeader}>
          <Text style={s.handsTitle}>{t(lang, 'handsPlayed').toUpperCase()}</Text>
          <Text style={s.handsCount}>{total}</Text>
        </View>
        {total === 0 ? (
          <View style={s.handsEmpty}>
            <Ionicons name="albums-outline" size={20} color={theme.textSubtle} />
            <Text style={s.handsEmptyTxt}>{t(lang, 'handsEmpty')}</Text>
          </View>
        ) : (
          <View style={s.handsList}>
            {history.map((h, i) => {
              const manoNum = total - i;
              const color = teamColor(h.slot);
              return (
                <View key={h.id} style={[s.handItem, i < total - 1 && s.handBorder]}>
                  <View style={s.handNum}><Text style={s.handNumTxt}>{manoNum}</Text></View>
                  <View style={[s.handDot, { backgroundColor: color }]} />
                  <Text style={s.handName} numberOfLines={1}>{h.name}</Text>
                  {h.bonus === 'capicua' && <View style={s.bonusTag}><Text style={s.bonusTxt}>C</Text></View>}
                  {h.bonus === 'pase' && <View style={s.bonusTag}><Text style={s.bonusTxt}>P</Text></View>}
                  {h.method === 'camera' && <Ionicons name="scan-outline" size={12} color={theme.textSubtle} />}
                  <Text style={[s.handPts, { color }]}>+{h.points}</Text>
                  <TouchableOpacity onPress={() => deleteEntry(h.id)} style={s.handDel}><Ionicons name="close" size={15} color={theme.textSubtle} /></TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Keypad — slides up when a team is active */}
      {activeTeam !== null && (
        <View style={s.keypad}>
          <View style={s.keypadHead}>
            <Text style={s.keypadLabel}>{names[activeTeam]}</Text>
            <TouchableOpacity onPress={closeKeypad} hitSlop={8}><Ionicons name="close" size={20} color={theme.textMuted} /></TouchableOpacity>
          </View>

          {/* Special plays on top */}
          {(capicuaEnabled || paseEnabled) && (
            <View style={s.specialRow}>
              {capicuaEnabled && (
                <TouchableOpacity style={s.specialBtn} onPress={() => applySpecial('capicua')}>
                  <Ionicons name="swap-horizontal" size={15} color={theme.accent} />
                  <Text style={s.specialTxt}>{t(lang, 'capicua')}</Text><Text style={s.specialPts}>+{capicuaPoints}</Text>
                </TouchableOpacity>
              )}
              {paseEnabled && (
                <TouchableOpacity style={s.specialBtn} onPress={() => applySpecial('pase')}>
                  <Ionicons name="play-forward" size={15} color={theme.accent} />
                  <Text style={s.specialTxt}>{t(lang, 'pase')}</Text><Text style={s.specialPts}>+{pasePoints}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Live display */}
          <View style={s.display}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.displayScroll}
              contentContainerStyle={s.displayScrollContent}
              ref={ref => { if (ref) ref.scrollToEnd({ animated: true }); }}
            >
              <Text style={[s.displayOp, { fontSize: exprFontSize(expr) }]} numberOfLines={1}>
                {expr === '' ? '0' : expr}
              </Text>
            </ScrollView>
            {expr.includes('+') && (
              <Text style={[s.displayResult, { color: teamColor(activeTeam) }]}>= {evalExpr(expr)}</Text>
            )}
          </View>
          <Text style={s.helper}>{t(lang, 'sumTilesHint')}</Text>

          {/* Numpad */}
          <View style={s.numpad}>
            {['1','2','3','4','5','6','7','8','9'].map(d => (
              <TouchableOpacity key={d} style={s.key} onPress={() => pressDigit(d)} activeOpacity={0.6}><Text style={s.keyTxt}>{d}</Text></TouchableOpacity>
            ))}
            <TouchableOpacity style={[s.key, s.keyOp, (expr === '' || expr.endsWith('+')) && s.keyDisabled]} onPress={pressPlus} activeOpacity={0.6}><Ionicons name="add" size={20} color={(expr === '' || expr.endsWith('+')) ? theme.textSubtle : theme.accent} /></TouchableOpacity>
            <TouchableOpacity style={s.key} onPress={() => pressDigit('0')} activeOpacity={0.6}><Text style={s.keyTxt}>0</Text></TouchableOpacity>
            <TouchableOpacity style={[s.key, s.keyOp]} onPress={pressBackspace} onLongPress={longPressClear} delayLongPress={550} activeOpacity={0.6}>
              <Ionicons name="backspace-outline" size={20} color={theme.accent} />
            </TouchableOpacity>
          </View>

          {/* Confirm */}
          <TouchableOpacity style={[s.confirmBtn, { backgroundColor: teamColor(activeTeam), opacity: evalExpr(expr) > 0 ? 1 : 0.4 }]} onPress={confirmEntry} disabled={evalExpr(expr) <= 0}>
            <Text style={s.confirmTxt}>{t(lang, 'addTo', { n: evalExpr(expr), name: names[activeTeam] })}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Reset (only when keypad closed) */}
      {activeTeam === null && (
        <View style={s.footer}>
          <TouchableOpacity style={s.resetBtn} onPress={handleReset}>
            <Ionicons name="refresh-outline" size={15} color={theme.textMuted} />
            <Text style={s.resetTxt}>{t(lang, 'reset')}</Text>
          </TouchableOpacity>
        </View>
      )}
      <AdBanner />

      {/* Rename modal */}
      <Modal transparent visible={renaming !== null} animationType="fade">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>{t(lang, 'rename')}</Text>
            <TextInput style={s.modalInput} value={newName} onChangeText={setNewName} autoFocus maxLength={20} placeholderTextColor={theme.textSubtle} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <TouchableOpacity style={s.btnGhost} onPress={() => setRenaming(null)}><Text style={{ color: theme.textMuted, fontWeight: '600' }}>{t(lang, 'cancel')}</Text></TouchableOpacity>
              <TouchableOpacity style={s.btnPrimaryFull} onPress={confirmRename}><Text style={{ color: '#fff', fontWeight: '600' }}>{t(lang, 'save')}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Win modal */}
      <Modal transparent visible={winnerIdx !== null} animationType="fade">
        <View style={s.overlay}>
          <View style={[s.modal, isLisa && s.modalLisa]}>
            {isLisa ? (
              <>
                <View style={s.lisaCrown}><Ionicons name="ribbon" size={32} color="#fff" /></View>
                <Text style={s.lisaTag}>{t(lang, 'lisa').toUpperCase()}</Text>
                <Text style={[s.modalTitle, { fontSize: 20 }]}>{winnerIdx !== null ? names[winnerIdx] : ''} {t(lang, 'wins')}</Text>
                <Text style={s.winSub}>{t(lang, 'lisaDesc', { loser: winnerIdx !== null ? names[winnerIdx === 0 ? 1 : 0] : '' })}</Text>
              </>
            ) : (
              <>
                <View style={s.winIcon}><Ionicons name="trophy" size={28} color={theme.accent} /></View>
                <Text style={[s.modalTitle, { fontSize: 18 }]}>{winnerIdx !== null ? names[winnerIdx] : ''} {t(lang, 'wins')}</Text>
                <Text style={s.winSub}>{t(lang, 'reachedTarget', { n: target })}</Text>
              </>
            )}
            <TouchableOpacity style={[s.btnPrimaryFull, { width: '100%', marginTop: 4 }]} onPress={() => { archiveAndReset('win', winnerIdx as 0 | 1); setWinnerIdx(null); setIsLisa(false); }}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>{t(lang, 'newGame')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Toast */}
      {toast && (
        <View style={s.toastWrap} pointerEvents="none">
          <View style={s.toast}><Text style={s.toastTxt}>{toast}</Text></View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = (t: any) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  logo: { width: 24, height: 24, borderRadius: 5, backgroundColor: t.accent, position: 'relative' },
  pip: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff' },
  title: { fontSize: 19, fontWeight: '700', color: t.text, letterSpacing: -0.3 },
  iconBtn: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16, paddingBottom: 16 },
  scoreRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 8, gap: 10, position: 'relative' },
  teamCard: { flex: 1, backgroundColor: t.card, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: t.border },
  vsBadge: { position: 'absolute', top: '50%', left: '50%', marginLeft: -16, marginTop: -14, width: 32, height: 28, borderRadius: 8, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
  vsTxt: { fontSize: 11, fontWeight: '700', color: t.textSubtle, letterSpacing: 0.5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  teamName: { fontSize: 13, fontWeight: '600', color: t.textMuted, maxWidth: 100 },
  score: { fontSize: 52, fontWeight: '700', lineHeight: 58, letterSpacing: -1.5 },
  progBg: { height: 4, backgroundColor: t.cardAlt, borderRadius: 2, width: '100%', marginTop: 10, overflow: 'hidden' },
  progFill: { height: 4, borderRadius: 2 },
  tapHint: { fontSize: 11, color: t.textSubtle, marginTop: 6, fontWeight: '500' },
  tapToScore: { fontSize: 12, color: t.textSubtle, textAlign: 'center', marginBottom: 14, fontStyle: 'italic' },
  handsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 8, paddingHorizontal: 2 },
  handsTitle: { fontSize: 11, fontWeight: '700', color: t.textSubtle, letterSpacing: 0.8 },
  handsCount: { fontSize: 11, fontWeight: '700', color: t.textSubtle },
  handsEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 26, gap: 8, backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, borderStyle: 'dashed' },
  handsEmptyTxt: { fontSize: 12, color: t.textSubtle },
  handsList: { backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, overflow: 'hidden' },
  handItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, gap: 9 },
  handBorder: { borderBottomWidth: 1, borderBottomColor: t.border },
  handNum: { width: 24, height: 24, borderRadius: 6, backgroundColor: t.cardAlt, alignItems: 'center', justifyContent: 'center' },
  handNumTxt: { fontSize: 11, fontWeight: '700', color: t.textMuted },
  handDot: { width: 8, height: 8, borderRadius: 4 },
  handName: { flex: 1, fontSize: 13, fontWeight: '600', color: t.text },
  bonusTag: { width: 18, height: 18, borderRadius: 5, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' },
  bonusTxt: { fontSize: 10, fontWeight: '800', color: t.accent },
  handPts: { fontSize: 15, fontWeight: '700', minWidth: 40, textAlign: 'right' },
  handDel: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  keypad: { backgroundColor: t.card, borderTopWidth: 1, borderTopColor: t.border, padding: 14, paddingBottom: 8 },
  keypadHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  keypadLabel: { fontSize: 14, color: t.textMuted, fontWeight: '600', flex: 1 },
  display: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, minHeight: 36 },
  displayScroll: { flex: 1 },
  displayScrollContent: { alignItems: 'center', flexGrow: 1, justifyContent: 'flex-end', paddingRight: 8 },
  displayOp: { fontWeight: '700', color: t.text, letterSpacing: 0.5 },
  displayResult: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: t.border },
  helper: { fontSize: 11, color: t.textSubtle, textAlign: 'center', fontStyle: 'italic', marginBottom: 11 },
  keyOp: { backgroundColor: t.accentSoft, borderColor: t.accent + '44' },
  keyDisabled: { backgroundColor: t.cardAlt, borderColor: t.border, opacity: 0.5 },
  numpad: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  key: { width: '31.5%', flexGrow: 1, paddingVertical: 13, borderRadius: 9, backgroundColor: t.cardAlt, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
  keyTxt: { fontSize: 19, fontWeight: '700', color: t.text },
  specialRow: { flexDirection: 'row', gap: 8, marginBottom: 11 },
  specialBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 11, borderRadius: 9, borderWidth: 1, borderColor: t.accent + '44', backgroundColor: t.accentSoft },
  specialTxt: { fontSize: 12, fontWeight: '600', color: t.text },
  specialPts: { fontSize: 12, fontWeight: '700', color: t.accent },
  confirmBtn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  confirmTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.bg },
  resetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card },
  resetTxt: { fontSize: 13, color: t.textMuted, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { width: '100%', maxWidth: 340, backgroundColor: t.card, borderRadius: 14, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: t.border, gap: 14 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: t.text, textAlign: 'center' },
  modalInput: { width: '100%', padding: 11, borderRadius: 8, borderWidth: 1, borderColor: t.borderStrong, fontSize: 15, textAlign: 'center', color: t.text, backgroundColor: t.cardAlt },
  btnGhost: { flex: 1, paddingVertical: 11, borderRadius: 8, borderWidth: 1, borderColor: t.border, alignItems: 'center', backgroundColor: t.card },
  btnPrimaryFull: { flex: 1, paddingVertical: 11, borderRadius: 8, alignItems: 'center', backgroundColor: t.accent },
  winIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' },
  modalLisa: { borderColor: t.accent, borderWidth: 2 },
  lisaCrown: { width: 60, height: 60, borderRadius: 30, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  lisaTag: { fontSize: 13, fontWeight: '800', color: t.accent, letterSpacing: 3, marginTop: -4 },
  toastWrap: { position: 'absolute', bottom: 90, left: 0, right: 0, alignItems: 'center' },
  toast: { backgroundColor: t.text, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10, maxWidth: '85%' },
  toastTxt: { color: t.bg, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  winSub: { color: t.textMuted, textAlign: 'center', fontSize: 13, marginTop: -6, paddingHorizontal: 8 },
});
