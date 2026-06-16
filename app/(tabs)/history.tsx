import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Share,
  Alert,
  Modal,
} from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useGameStore, Tournament } from "@/hooks/useGameStore";
import { t } from "@/constants/i18n";
import { exportTournamentPdf } from "@/utils/pdfExport";
import AdBanner from "@/components/AdBanner";

export default function TournamentsScreen() {
  const { tournaments, theme, lang, isPro, deleteTournament } = useGameStore();
  const [detail, setDetail] = useState<Tournament | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null); // ← nuevo
  const s = styles(theme);

  const slotColor = (tour: Tournament, slot: number) => {
    const palette = [theme.team1, theme.team2, theme.accent, theme.success];
    return palette[slot % palette.length];
  };

  // ← Ahora abre Modal propio en vez de Alert
  const handleDelete = (id: string) => {
    setDeleteTarget(id);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    deleteTournament(deleteTarget);
    setDeleteTarget(null);
    setDetail(null);
  };

  const exportText = async (tour: Tournament) => {
    let txt = `${t(lang, "appName").toUpperCase()}\n${"=".repeat(28)}\n`;
    tour.names.forEach((n, i) => {
      txt += `${n}: ${tour.scores[i]}\n`;
    });
    txt += `${t(lang, "winner")}: ${tour.winner !== null ? tour.names[tour.winner] : t(lang, "undefined")}\n\n`;
    const tot = tour.history.length;
    tour.history.forEach((h, i) => {
      txt += `${tot - i}. ${h.name} +${h.points}\n`;
    });
    await Share.share({ message: txt });
  };

  const exportPdf = async (tour: Tournament) => {
    try {
      await exportTournamentPdf(tour, lang);
    } catch (e) {
      Alert.alert("PDF", "No se pudo generar el PDF.");
    }
  };

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return (
      d.toLocaleDateString([], { day: "2-digit", month: "short" }) +
      " · " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <View style={s.header}>
        <Text style={s.pageTitle}>{t(lang, "tournaments")}</Text>
      </View>

      {tournaments.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Ionicons
              name="trophy-outline"
              size={26}
              color={theme.textSubtle}
            />
          </View>
          <Text style={s.emptyTitle}>{t(lang, "noTournaments")}</Text>
          <Text style={s.emptySub}>{t(lang, "noTournamentsSub")}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {tournaments.map((tour) => (
            <TouchableOpacity
              key={tour.id}
              style={s.tCard}
              onPress={() => setDetail(tour)}
              activeOpacity={0.8}
            >
              <View style={s.tHeader}>
                <Text style={s.tDate}>{fmtDate(tour.endedAt)}</Text>
                {tour.winner !== null ? (
                  <View style={s.badgeGroup}>
                    {tour.scores[tour.winner === 0 ? 1 : 0] === 0 && (
                      <View
                        style={[s.tBadge, { backgroundColor: theme.accent }]}
                      >
                        <Ionicons name="ribbon" size={11} color="#fff" />
                        <Text style={[s.tBadgeTxt, { color: "#fff" }]}>
                          {t(lang, "lisa")}
                        </Text>
                      </View>
                    )}
                    <View
                      style={[s.tBadge, { backgroundColor: theme.accentSoft }]}
                    >
                      <Ionicons name="trophy" size={11} color={theme.accent} />
                      <Text
                        style={[s.tBadgeTxt, { color: theme.accent }]}
                        numberOfLines={1}
                      >
                        {tour.names[tour.winner]}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={[s.tBadge, { backgroundColor: theme.cardAlt }]}>
                    <Text style={[s.tBadgeTxt, { color: theme.textSubtle }]}>
                      {t(lang, "undefined")}
                    </Text>
                  </View>
                )}
              </View>
              <View style={s.tScores}>
                {tour.names.map((n, i) => (
                  <View key={i} style={s.tTeam}>
                    <Text style={s.tTeamName} numberOfLines={1}>
                      {n}
                    </Text>
                    <Text style={[s.tScore, { color: slotColor(tour, i) }]}>
                      {tour.scores[i]}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={s.tMeta}>
                {tour.history.length} {t(lang, "hands")} · {t(lang, "target")}{" "}
                {tour.target}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <AdBanner />

      {/* Detail — bottom sheet con animationType="slide" */}
      <Modal transparent visible={detail !== null} animationType="slide">
        <View style={s.detailOverlay}>
          <TouchableOpacity
            style={s.detailBackdrop}
            activeOpacity={1}
            onPress={() => setDetail(null)}
          />
          <View style={s.sheet}>
            <View style={s.handle} />
            {detail && (
              <>
                <View style={s.detailHeader}>
                  <Text style={s.detailTitle} numberOfLines={1}>
                    {detail.names.join(" · ")}
                  </Text>
                  <TouchableOpacity onPress={() => setDetail(null)}>
                    <Ionicons name="close" size={22} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>
                <View style={s.detailScores}>
                  {detail.names.map((n, i) => (
                    <View key={i} style={{ alignItems: "center" }}>
                      <Text
                        style={[s.detailScore, { color: slotColor(detail, i) }]}
                      >
                        {detail.scores[i]}
                      </Text>
                      <Text style={s.detailName} numberOfLines={1}>
                        {n}
                      </Text>
                    </View>
                  ))}
                </View>
                <ScrollView
                  style={{ maxHeight: 280 }}
                  showsVerticalScrollIndicator={false}
                >
                  {detail.history.map((h, i) => (
                    <View
                      key={h.id}
                      style={[
                        s.dItem,
                        i < detail.history.length - 1 && s.dBorder,
                      ]}
                    >
                      <View style={s.dNum}>
                        <Text style={s.dNumTxt}>
                          {detail.history.length - i}
                        </Text>
                      </View>
                      <View
                        style={[
                          s.dDot,
                          { backgroundColor: slotColor(detail, h.slot) },
                        ]}
                      />
                      <Text style={s.dName}>{h.name}</Text>
                      {h.method === "camera" && (
                        <Ionicons
                          name="scan-outline"
                          size={12}
                          color={theme.textSubtle}
                        />
                      )}
                      <Text
                        style={[s.dPts, { color: slotColor(detail, h.slot) }]}
                      >
                        +{h.points}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
                <View style={s.actions}>
                  <TouchableOpacity
                    style={s.actBtn}
                    onPress={() => exportText(detail)}
                  >
                    <Ionicons
                      name="share-outline"
                      size={16}
                      color={theme.accent}
                    />
                    <Text style={[s.actTxt, { color: theme.accent }]}>
                      {t(lang, "export")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.actBtn}
                    onPress={() => exportPdf(detail)}
                  >
                    <Ionicons
                      name="document-text-outline"
                      size={16}
                      color={theme.accent}
                    />
                    <Text style={[s.actTxt, { color: theme.accent }]}>PDF</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.actBtn}
                    onPress={() => handleDelete(detail.id)}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={16}
                      color={theme.danger}
                    />
                    <Text style={[s.actTxt, { color: theme.danger }]}>
                      {t(lang, "delete")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Modal Confirmar eliminación ── */}
      <Modal transparent visible={deleteTarget !== null} animationType="fade">
        <View style={s.confirmOverlay}>
          <View style={s.confirmModal}>
            <Ionicons name="trash-outline" size={36} color={theme.danger} />
            <Text style={s.confirmTitle}>{t(lang, "delete")}</Text>
            <Text
              style={{
                color: theme.textMuted,
                textAlign: "center",
                fontSize: 13,
              }}
            >
              Esta partida se eliminará permanentemente.
            </Text>
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                width: "100%",
                marginTop: 4,
              }}
            >
              <TouchableOpacity
                style={s.btnGhost}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={{ color: theme.textMuted, fontWeight: "600" }}>
                  {t(lang, "cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnDanger]} onPress={confirmDelete}>
                <Text style={{ color: "#fff", fontWeight: "600" }}>
                  {t(lang, "delete")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = (t: any) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg },
    header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
    pageTitle: {
      fontSize: 24,
      fontWeight: "700",
      color: t.text,
      letterSpacing: -0.5,
    },
    empty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      gap: 8,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.cardAlt,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    emptyTitle: { fontSize: 16, fontWeight: "700", color: t.text },
    emptySub: {
      fontSize: 13,
      color: t.textMuted,
      textAlign: "center",
      lineHeight: 19,
    },
    tCard: {
      backgroundColor: t.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      marginBottom: 10,
    },
    tHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    tDate: { fontSize: 12, color: t.textSubtle, fontWeight: "500" },
    tBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 20,
      maxWidth: 140,
    },
    badgeGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
    tBadgeTxt: { fontSize: 11, fontWeight: "700" },
    tScores: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
      flexWrap: "wrap",
      gap: 8,
    },
    tTeam: { flex: 1, minWidth: "22%", alignItems: "center", gap: 3 },
    tTeamName: {
      fontSize: 12,
      fontWeight: "600",
      color: t.textMuted,
      maxWidth: 90,
    },
    tScore: { fontSize: 26, fontWeight: "700", letterSpacing: -1 },
    tMeta: {
      fontSize: 11,
      color: t.textSubtle,
      textAlign: "center",
      fontWeight: "500",
    },
    // Bottom sheet
    detailOverlay: { flex: 1, justifyContent: "flex-end" },
    detailBackdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    sheet: {
      backgroundColor: t.bg,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      padding: 20,
      paddingBottom: 32,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.borderStrong,
      alignSelf: "center",
      marginBottom: 16,
    },
    detailHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14,
    },
    detailTitle: { fontSize: 16, fontWeight: "700", color: t.text, flex: 1 },
    detailScores: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-around",
      marginBottom: 16,
      flexWrap: "wrap",
      gap: 12,
    },
    detailScore: { fontSize: 32, fontWeight: "700", letterSpacing: -1 },
    detailName: {
      fontSize: 12,
      color: t.textMuted,
      fontWeight: "600",
      maxWidth: 80,
    },
    dItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 9,
      paddingHorizontal: 12,
      gap: 9,
      backgroundColor: t.card,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: t.border,
    },
    dBorder: { borderBottomWidth: 1, borderBottomColor: t.border },
    dNum: {
      width: 22,
      height: 22,
      borderRadius: 6,
      backgroundColor: t.cardAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    dNumTxt: { fontSize: 10, fontWeight: "700", color: t.textMuted },
    dDot: { width: 7, height: 7, borderRadius: 4 },
    dName: { flex: 1, fontSize: 13, fontWeight: "600", color: t.text },
    dPts: { fontSize: 14, fontWeight: "700" },
    actions: { flexDirection: "row", gap: 8, marginTop: 16 },
    actBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.card,
    },
    actTxt: { fontSize: 13, fontWeight: "600" },
    // Confirm delete modal
    confirmOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    confirmModal: {
      width: "100%",
      maxWidth: 320,
      backgroundColor: t.card,
      borderRadius: 14,
      padding: 24,
      alignItems: "center",
      gap: 12,
      borderWidth: 1,
      borderColor: t.border,
    },
    confirmTitle: { fontSize: 17, fontWeight: "700", color: t.text },
    btnGhost: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: "center",
      backgroundColor: t.card,
    },
    btnDanger: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 8,
      alignItems: "center",
      backgroundColor: t.danger ?? "#E53935",
    },
  });
