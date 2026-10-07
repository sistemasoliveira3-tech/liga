'use strict';
const express = require('express');
const fs = require('fs');
const db = require('../db');
const { requirePermission, audit } = require('../lib/auth');
const engine = require('../lib/engine');
const pdf = require('../lib/pdf');

const router = express.Router();
const COLS = ['championship_id','phase_id','round_id','group_name','home_club_id','away_club_id','match_date','match_time','venue_id','referee_id','assistant1_id','assistant2_id','fourth_id','delegate_id','status','home_score','away_score','penalties_home','penalties_away','leg','stream_url','stream_platform','live_minute','live_status','notes','occurrences','published'];

function matchFull(id) {
  const m = db.prepare(`SELECT m.*,
      hc.name home_name, hc.logo home_logo, hc.short_name home_short,
      ac.name away_name, ac.logo away_logo, ac.short_name away_short,
      c.name champ_name, c.season, c.category,
      v.name venue_name, v.address venue_addr, v.city venue_city,
      r.name referee_name, a1.name assistant1_name, a2.name assistant2_name, f.name fourth_name, d.name delegate_name
    FROM matches m
    LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id
    LEFT JOIN championships c ON c.id=m.championship_id
    LEFT JOIN venues v ON v.id=m.venue_id
    LEFT JOIN referees r ON r.id=m.referee_id LEFT JOIN referees a1 ON a1.id=m.assistant1_id
    LEFT JOIN referees a2 ON a2.id=m.assistant2_id LEFT JOIN referees f ON f.id=m.fourth_id
    LEFT JOIN referees d ON d.id=m.delegate_id
    WHERE m.id = ?`).get(id);
  if (!m) return null;
  m.events = db.prepare(`SELECT e.*, a.name athlete_name, a.nickname athlete_nick, a.photo athlete_photo, rel.name related_name
    FROM match_events e LEFT JOIN athletes a ON a.id=e.athlete_id LEFT JOIN athletes rel ON rel.id=e.related_athlete_id
    WHERE e.match_id = ? ORDER BY e.minute`).all(id);
  m.lineups = db.prepare(`SELECT l.*, a.name, a.nickname, a.photo, a.position pos FROM lineups l LEFT JOIN athletes a ON a.id=l.athlete_id WHERE l.match_id = ?`).all(id);
  m.home_lineup = m.lineups.filter(l => l.club_id === m.home_club_id);
  m.away_lineup = m.lineups.filter(l => l.club_id === m.away_club_id);
  m.photos = db.prepare('SELECT * FROM photos WHERE match_id = ?').all(id);
  m.streams = db.prepare('SELECT * FROM streams WHERE match_id = ?').all(id);
  return m;
}

router.get('/', requirePermission('partidas', 'view'), (req, res) => {
  const where = []; const params = [];
  if (req.user.org_id) { where.push('c.org_id = ?'); params.push(req.user.org_id); }
  ['championship_id','round_id','status','venue_id','referee_id'].forEach(f => { if (req.query[f]) { where.push('m.' + f + ' = ?'); params.push(req.query[f]); } });
  if (req.query.club_id) { where.push('(m.home_club_id = ? OR m.away_club_id = ?)'); params.push(req.query.club_id, req.query.club_id); }
  if (req.query.date) { where.push('m.match_date = ?'); params.push(req.query.date); }
  if (req.query.from) { where.push('m.match_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('m.match_date <= ?'); params.push(req.query.to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(parseInt(req.query.limit) || 300, 1000);
  const rows = db.prepare(`SELECT m.*, hc.name home_name, hc.logo home_logo, ac.name away_name, ac.logo away_logo, c.name champ_name, v.name venue_name
    FROM matches m LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id
    LEFT JOIN championships c ON c.id=m.championship_id LEFT JOIN venues v ON v.id=m.venue_id
    ${whereSql} ORDER BY m.match_date DESC, m.match_time, m.id LIMIT ?`).all(...params, limit);
  res.json({ data: rows, total: rows.length });
});

router.get('/:id', requirePermission('partidas', 'view'), (req, res) => {
  const m = matchFull(req.params.id);
  if (!m) return res.status(404).json({ error: 'Partida não encontrada' });
  res.json(m);
});

router.post('/', requirePermission('partidas', 'include'), (req, res) => {
  try {
    const keys = Object.keys(req.body).filter(k => COLS.includes(k));
    if (!keys.length) return res.status(400).json({ error: 'Dados inválidos' });
    const info = db.prepare(`INSERT INTO matches (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => req.body[k]));
    audit(req, 'criar', 'matches', info.lastInsertRowid, null, req.body);
    res.status(201).json(matchFull(info.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requirePermission('partidas', 'edit'), (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Partida não encontrada' });
    const keys = Object.keys(req.body).filter(k => COLS.includes(k));
    if (!keys.length) return res.status(400).json({ error: 'Nada para atualizar' });
    db.prepare(`UPDATE matches SET ${keys.map(k => k + '=?').join(',')} WHERE id = ?`).run(...keys.map(k => req.body[k]), req.params.id);
    const updated = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    audit(req, 'alterar', 'matches', updated.id, old, updated);
    res.json(matchFull(req.params.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', requirePermission('partidas', 'delete'), (req, res) => {
  const old = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Partida não encontrada' });
  db.prepare('DELETE FROM matches WHERE id = ?').run(req.params.id);
  audit(req, 'excluir', 'matches', req.params.id, old, null);
  res.json({ ok: true });
});

// ---- Result ----
router.post('/:id/result', requirePermission('partidas', 'edit'), (req, res) => {
  const { home_score, away_score, status, penalties_home, penalties_away } = req.body;
  const old = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Partida não encontrada' });
  db.prepare('UPDATE matches SET home_score=?, away_score=?, status=?, penalties_home=?, penalties_away=? WHERE id=?')
    .run(home_score, away_score, status || 'finalizada', penalties_home ?? null, penalties_away ?? null, req.params.id);
  audit(req, 'registrar_resultado', 'matches', req.params.id, old, { home_score, away_score });
  res.json(matchFull(req.params.id));
});

// ---- Available players (lineup eligibility) ----
router.get('/:id/available-players', requirePermission('partidas', 'view'), (req, res) => {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Partida não encontrada' });
  const clubId = req.query.club_id;
  if (!clubId) return res.status(400).json({ error: 'club_id obrigatório' });
  const champ = db.prepare('SELECT * FROM championships WHERE id = ?').get(m.championship_id);
  const players = db.prepare('SELECT * FROM athletes WHERE club_id = ?').all(clubId);
  const susp = engine.computeSuspensions(m.championship_id);
  const suspIds = new Set(susp.map(s => s.athlete_id));
  const result = players.map(p => {
    const blocks = [];
    if (p.status === 'suspenso') blocks.push('Suspenso');
    if (p.status === 'irregular') blocks.push('Irregular');
    if (p.status === 'inativo') blocks.push('Inativo');
    if (suspIds.has(p.id)) blocks.push('Suspensão automática');
    const docs = db.prepare("SELECT COUNT(*) c FROM documents WHERE entity_type='athlete' AND entity_id=? AND status='aprovado'").get(p.id).c;
    return { ...p, blocked: blocks.length > 0, blocks, docs_ok: docs > 0 };
  });
  res.json({ players: result, championship: champ });
});

// ---- Lineups ----
router.post('/:id/lineups', requirePermission('sumula', 'edit'), (req, res) => {
  const { club_id, players } = req.body; // players: [{athlete_id,is_starter,is_captain,is_goalkeeper,position,number}]
  if (!club_id || !Array.isArray(players)) return res.status(400).json({ error: 'club_id e players são obrigatórios' });
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Partida não encontrada' });
  const susp = new Set(engine.computeSuspensions(m.championship_id).map(s => s.athlete_id));
  const blocked = players.filter(p => {
    const a = db.prepare('SELECT status FROM athletes WHERE id = ?').get(p.athlete_id);
    return !a || a.status === 'suspenso' || a.status === 'irregular' || a.status === 'inativo' || susp.has(p.athlete_id);
  });
  if (blocked.length) return res.status(400).json({ error: 'Escalação contém atletas bloqueados', blocked });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM lineups WHERE match_id = ? AND club_id = ?').run(req.params.id, club_id);
    const ins = db.prepare('INSERT INTO lineups (match_id,club_id,athlete_id,is_starter,is_captain,is_goalkeeper,position,number) VALUES (?,?,?,?,?,?,?,?)');
    players.forEach(p => ins.run(req.params.id, club_id, p.athlete_id, p.is_starter ? 1 : 0, p.is_captain ? 1 : 0, p.is_goalkeeper ? 1 : 0, p.position || null, p.number || null));
  });
  tx();
  audit(req, 'escalacao', 'matches', req.params.id, null, { club_id, count: players.length });
  res.json(matchFull(req.params.id));
});

// ---- Events ----
router.post('/:id/events', requirePermission('sumula', 'edit'), (req, res) => {
  const { club_id, athlete_id, related_athlete_id, type, minute, detail } = req.body;
  if (!type) return res.status(400).json({ error: 'Tipo do evento é obrigatório' });
  const info = db.prepare('INSERT INTO match_events (match_id,club_id,athlete_id,related_athlete_id,type,minute,detail) VALUES (?,?,?,?,?,?,?)')
    .run(req.params.id, club_id || null, athlete_id || null, related_athlete_id || null, type, minute || 0, detail || null);
  audit(req, 'evento', 'matches', req.params.id, null, req.body);
  // Return the enriched event (with athlete names) so the client can render it
  // in place without re-fetching the whole match (saves a round-trip).
  const row = db.prepare(`SELECT e.*, a.name athlete_name, a.nickname athlete_nick, a.photo athlete_photo, rel.name related_name
    FROM match_events e LEFT JOIN athletes a ON a.id=e.athlete_id LEFT JOIN athletes rel ON rel.id=e.related_athlete_id
    WHERE e.id = ?`).get(info.lastInsertRowid);
  res.status(201).json(row);
});
router.delete('/:id/events/:eid', requirePermission('sumula', 'edit'), (req, res) => {
  db.prepare('DELETE FROM match_events WHERE id = ? AND match_id = ?').run(req.params.eid, req.params.id);
  res.json({ ok: true });
});

// ---- Live ----
router.post('/:id/live', requirePermission('partidas', 'edit'), (req, res) => {
  const { live_minute, live_status, status } = req.body;
  db.prepare('UPDATE matches SET live_minute=COALESCE(?,live_minute), live_status=COALESCE(?,live_status), status=COALESCE(?,status) WHERE id=?')
    .run(live_minute ?? null, live_status ?? null, status ?? null, req.params.id);
  res.json(matchFull(req.params.id));
});

// ---- Súmula ----
router.get('/:id/sumula', requirePermission('sumula', 'view'), (req, res) => {
  const m = matchFull(req.params.id);
  if (!m) return res.status(404).json({ error: 'Partida não encontrada' });
  res.json(m);
});

router.post('/:id/publish', requirePermission('sumula', 'publish'), async (req, res) => {
  try {
    db.prepare('UPDATE matches SET published = 1, status = COALESCE(?, status) WHERE id = ?').run(req.body.status || 'finalizada', req.params.id);
    audit(req, 'publicar_sumula', 'matches', req.params.id, null, null);
    let pdfUrl = null;
    try { const r = await pdf.generateSumulaPDF(req.params.id); pdfUrl = '/uploads/sumulas/sumula_' + req.params.id + '.pdf'; } catch (e) { console.error('PDF error', e.message); }
    res.json({ ok: true, pdf_url: pdfUrl });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const pdfPath = require('path').join(__dirname, '..', '..', 'uploads', 'sumulas', 'sumula_' + req.params.id + '.pdf');
    if (!fs.existsSync(pdfPath)) await pdf.generateSumulaPDF(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sumula_${req.params.id}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, matchFull };
