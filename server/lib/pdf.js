'use strict';
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('../db');

const OUT_DIR = path.join(__dirname, '..', '..', 'uploads', 'sumulas');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function buildSumulaHTML(matchId) {
  const m = db.prepare(`SELECT m.*, hc.name home_name, hc.logo home_logo, ac.name away_name, ac.logo away_logo,
      c.name champ_name, c.season, c.category, mo.name modality,
      v.name venue_name, v.address venue_addr, v.city venue_city,
      r.name referee_name, a1.name ass1, a2.name ass2, f.name fourth, d.name delegate
    FROM matches m
    LEFT JOIN clubs hc ON hc.id = m.home_club_id
    LEFT JOIN clubs ac ON ac.id = m.away_club_id
    LEFT JOIN championships c ON c.id = m.championship_id
    LEFT JOIN modalities mo ON mo.id = c.modality_id
    LEFT JOIN venues v ON v.id = m.venue_id
    LEFT JOIN referees r ON r.id = m.referee_id
    LEFT JOIN referees a1 ON a1.id = m.assistant1_id
    LEFT JOIN referees a2 ON a2.id = m.assistant2_id
    LEFT JOIN referees f ON f.id = m.fourth_id
    LEFT JOIN referees d ON d.id = m.delegate_id
    WHERE m.id = ?`).get(matchId);
  if (!m) throw new Error('Partida não encontrada');

  const events = db.prepare(`SELECT e.*, a.name athlete_name, a.number athlete_number, rel.name rel_name
    FROM match_events e LEFT JOIN athletes a ON a.id = e.athlete_id LEFT JOIN athletes rel ON rel.id = e.related_athlete_id
    WHERE e.match_id = ? ORDER BY e.minute`).all(matchId);

  const lineup = (clubId) => db.prepare(`SELECT l.*, a.name, a.nickname, a.number num FROM lineups l
    LEFT JOIN athletes a ON a.id = l.athlete_id WHERE l.match_id = ? AND l.club_id = ? ORDER BY l.is_starter DESC, l.number`).all(matchId, clubId);

  const evLabel = {
    goal: '⚽ Gol', penalty_goal: '⚽ Gol (pênalti)', own_goal: '⚽ Gol contra', assist: '🅰 Assistência',
    yellow: '🟨 Cartão amarelo', red: '🟥 Cartão vermelho', substitution: '🔄 Substituição',
    injury: '🚑 Lesão', penalty_miss: '❌ Pênalti perdido'
  };

  const home = lineup(m.home_club_id), away = lineup(m.away_club_id);

  const lineupTable = (rows) => `
    <table class="lu"><thead><tr><th>Nº</th><th>Atleta</th><th>Pos</th><th>T/R</th></tr></thead><tbody>
    ${rows.length ? rows.map(r => `<tr><td>${esc(r.num || r.number || '')}</td><td>${esc(r.name || r.nickname || '')}</td><td>${esc(r.position || '')}</td><td>${r.is_starter ? 'Titular' : 'Reserva'}</td></tr>`).join('') : '<tr><td colspan="4">—</td></tr>'}
    </tbody></table>`;

  const eventsTable = events.length ? events.map(e => `
    <tr><td>${e.minute}'</td><td>${esc(evLabel[e.type] || e.type)}</td><td>${esc(e.athlete_name || '')}</td>
    <td>${e.type === 'substitution' ? 'entra ' + esc(e.rel_name || '') : (e.detail ? esc(e.detail) : '')}</td></tr>`).join('') : '<tr><td colspan="4">Nenhum evento registrado</td></tr>';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
  <style>
    *{box-sizing:border-box;font-family:'DejaVu Sans',Arial,sans-serif}
    body{margin:0;padding:24px;color:#12211c;font-size:12px}
    .head{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #0b6e4f;padding-bottom:10px}
    .head h1{margin:0;font-size:18px;color:#0b6e4f}
    .head .sub{font-size:11px;color:#555}
    .score{display:flex;align-items:center;justify-content:center;gap:26px;margin:18px 0;padding:14px;background:#f1f7f4;border-radius:10px}
    .team{text-align:center;width:180px}
    .team .n{font-weight:bold;font-size:14px}
    .sc{font-size:34px;font-weight:bold;color:#0b6e4f}
    .meta{display:flex;flex-wrap:wrap;gap:8px 24px;margin:10px 0;font-size:11px}
    .meta b{color:#0b6e4f}
    h2{font-size:13px;border-left:4px solid #0b6e4f;padding-left:8px;margin:16px 0 8px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border:1px solid #cfdcd6;padding:4px 6px;text-align:left}
    th{background:#eaf3ef;color:#0b6e4f}
    .cols{display:flex;gap:14px}
    .cols>div{flex:1}
    .foot{margin-top:22px;display:flex;justify-content:space-between;font-size:10px;color:#666}
    .sign{border-top:1px solid #999;width:200px;text-align:center;padding-top:4px;margin-top:40px}
    .occ{background:#fff8e6;border:1px solid #f0d98a;padding:8px;border-radius:6px;font-size:11px}
  </style></head><body>
    <div class="head">
      <div><h1>SÚMULA DIGITAL</h1><div class="sub">${esc(m.champ_name || '')} • ${esc(m.season || '')} ${m.category ? '• ' + esc(m.category) : ''} ${m.modality ? '• ' + esc(m.modality) : ''}</div></div>
      <div class="sub">Partida #${m.id}<br>${esc(m.match_date || '')} ${esc(m.match_time || '')}</div>
    </div>
    <div class="score">
      <div class="team"><div class="n">${esc(m.home_name || 'Mandante')}</div></div>
      <div class="sc">${m.home_score ?? '-'} <span style="font-size:18px">x</span> ${m.away_score ?? '-'}</div>
      <div class="team"><div class="n">${esc(m.away_name || 'Visitante')}</div></div>
    </div>
    <div class="meta">
      <div><b>Local:</b> ${esc(m.venue_name || '—')} ${m.venue_city ? '- ' + esc(m.venue_city) : ''}</div>
      <div><b>Rodada/Grupo:</b> ${esc(m.group_name || '')} ${m.round_id ? '(Rodada #' + m.round_id + ')' : ''}</div>
      <div><b>Status:</b> ${esc(m.status)}</div>
      ${m.penalties_home != null ? `<div><b>Pênaltis:</b> ${m.penalties_home} x ${m.penalties_away}</div>` : ''}
    </div>
    <h2>Arbitragem</h2>
    <div class="meta">
      <div><b>Árbitro:</b> ${esc(m.referee_name || '—')}</div>
      <div><b>Assistente 1:</b> ${esc(m.ass1 || '—')}</div>
      <div><b>Assistente 2:</b> ${esc(m.ass2 || '—')}</div>
      <div><b>4º Árbitro:</b> ${esc(m.fourth || '—')}</div>
      <div><b>Delegado:</b> ${esc(m.delegate || '—')}</div>
    </div>
    <h2>Escalações</h2>
    <div class="cols">
      <div><div style="font-weight:bold;margin-bottom:4px">${esc(m.home_name || 'Mandante')}</div>${lineupTable(home)}</div>
      <div><div style="font-weight:bold;margin-bottom:4px">${esc(m.away_name || 'Visitante')}</div>${lineupTable(away)}</div>
    </div>
    <h2>Eventos da Partida</h2>
    <table><thead><tr><th>Min</th><th>Evento</th><th>Atleta</th><th>Observação</th></tr></thead><tbody>${eventsTable}</tbody></table>
    ${m.occurrences ? `<h2>Ocorrências da Arbitragem</h2><div class="occ">${esc(m.occurrences)}</div>` : ''}
    ${m.notes ? `<h2>Observações</h2><div class="occ">${esc(m.notes)}</div>` : ''}
    <div class="foot">
      <div class="sign">Árbitro</div>
      <div class="sign">Delegado</div>
      <div class="sign">Responsável</div>
    </div>
    <div style="text-align:center;margin-top:18px;font-size:9px;color:#999">Documento gerado automaticamente pela Plataforma Liga — ${new Date().toLocaleString('pt-BR')}</div>
  </body></html>`;
}

function generateSumulaPDF(matchId) {
  return new Promise((resolve, reject) => {
    const html = buildSumulaHTML(matchId);
    const htmlPath = path.join(OUT_DIR, `sumula_${matchId}.html`);
    const pdfPath = path.join(OUT_DIR, `sumula_${matchId}.pdf`);
    fs.writeFileSync(htmlPath, html);
    execFile('wkhtmltopdf', ['--enable-local-file-access', '--quiet', '--page-size', 'A4', htmlPath, pdfPath],
      { timeout: 60000 }, (err) => {
        if (err) return reject(err);
        resolve({ pdfPath, htmlPath });
      });
  });
}

module.exports = { buildSumulaHTML, generateSumulaPDF };
