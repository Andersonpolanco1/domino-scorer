import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Tournament } from '@/hooks/useGameStore';
import { Lang, t } from '@/constants/i18n';

export async function exportTournamentPdf(tour: Tournament, lang: Lang) {
  const date = new Date(tour.endedAt).toLocaleString();
  const palette = ['#0078D4', '#3A4A5C', '#0E8A6E', '#8B7CF6'];
  const tot = tour.history.length;

  const scoreCols = tour.names.map((n, i) =>
    `<div class="team"><div class="tn">${esc(n)}</div><div class="ts" style="color:${palette[i % 4]}">${tour.scores[i]}</div></div>`
  ).join('');

  const rows = tour.history.map((h, i) => `
    <tr>
      <td class="num">${tot - i}</td>
      <td><span class="dot" style="background:${palette[h.slot % 4]}"></span>${esc(h.name)}</td>
      <td class="method">${h.method === 'camera' ? '📷' : '✍️'}</td>
      <td class="pts" style="color:${palette[h.slot % 4]}">+${h.points}</td>
    </tr>`).join('');

  const winnerLine = tour.winner !== null
    ? `<div class="winner">🏆 ${t(lang, 'winner')}: <b>${esc(tour.names[tour.winner])}</b></div>` : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { font-family: -apple-system, Helvetica, Arial, sans-serif; }
    body { padding: 40px; color: #1B1A19; }
    .head { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
    .logo { width:28px; height:28px; border-radius:6px; background:#0078D4; position:relative; }
    .logo i { position:absolute; width:5px; height:5px; border-radius:3px; background:#fff; }
    .logo .a{top:6px;left:6px}.logo .b{top:6px;right:6px}.logo .c{bottom:6px;left:6px}.logo .d{bottom:6px;right:6px}
    h1 { font-size:20px; margin:0; }
    .date { color:#8A8886; font-size:12px; margin-bottom:20px; }
    .scores { display:flex; gap:20px; justify-content:center; padding:20px; background:#F7F8FA; border-radius:12px; margin-bottom:8px; }
    .team { text-align:center; }
    .tn { font-size:13px; color:#605E5C; font-weight:600; }
    .ts { font-size:40px; font-weight:700; }
    .winner { text-align:center; font-size:14px; margin-bottom:20px; color:#605E5C; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    th { text-align:left; font-size:10px; color:#8A8886; text-transform:uppercase; letter-spacing:1px; padding:8px; border-bottom:2px solid #EDEBE9; }
    td { padding:9px 8px; font-size:13px; border-bottom:1px solid #F0F0F0; }
    .num { color:#8A8886; width:36px; }
    .dot { display:inline-block; width:8px; height:8px; border-radius:4px; margin-right:8px; }
    .method { text-align:center; width:40px; }
    .pts { text-align:right; font-weight:700; width:60px; }
    .foot { margin-top:30px; text-align:center; color:#B0AEAC; font-size:11px; }
  </style></head><body>
    <div class="head"><div class="logo"><i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i></div><h1>${t(lang, 'appName')}</h1></div>
    <div class="date">${date} · ${tot} ${t(lang, 'hands')} · ${t(lang, 'target')} ${tour.target}</div>
    <div class="scores">${scoreCols}</div>
    ${winnerLine}
    <table><thead><tr><th>#</th><th>${lang === 'es' ? 'Jugador' : 'Player'}</th><th></th><th>${t(lang, 'points')}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="foot">${t(lang, 'appName')}</div>
  </body></html>`;

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t(lang, 'exportPdf') });
  }
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
