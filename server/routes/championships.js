'use strict';
const express = require('express');
const db = require('../db');
const { requirePermission, audit } = require('../lib/auth');
const { listQuery } = require('../lib/helpers');
const engine = require('../lib/engine');

const router = express.Router();
const COLS = ['org_id','league_id','modality_id','name','season','category','gender','age_group','regulation','format','start_date','end_date','status','location','logo','points_win','points_draw','points_loss','tiebreakers','double_round'];

router.get('/', requirePermission('campeonatos', 'view'), (req, res) => {
  const { rows, total } = listQuery('championships', req, { orgScoped: true, search: 'name,season,category', order: 'id DESC', filters: { status: 'status', modality_id: 'modality_id' } });
  rows.forEach(r => {
    r.clubs = db.prepare('SELECT COUNT(*) c FROM championship_clubs WHERE championship_id = ?').get(r.id).c;
    r.matches = db.prepare('SELECT COUNT(*) c FROM matches WHERE championship_id = ?').get(r.id).c;
    r.modality_name = r.modality_id ? db.prepare('SELECT name FROM modalities WHERE id = ?').get(r.modality_id)?.name : null;
    r.league_name = r.league_id ? db.prepare('SELECT name FROM organizations WHERE id = ?').get(r.league_id)?.name : null;
  });
  res.json({ data: rows, total });
});

router.get('/:id', requirePermission('campeonatos', 'view'), (req, res) => {
  const c = db.prepare('SELECT * FROM championships WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campeonato não encontrado' });
  c.participants = db.prepare(`SELECT cc.*, cl.name, cl.short_name, cl.logo, cl.city FROM championship_clubs cc JOIN clubs cl ON cl.id = cc.club_id WHERE cc.championship_id = ? ORDER BY cc.seed, cl.name`).all(c.id);
  c.rounds = db.prepare('SELECT * FROM rounds WHERE championship_id = ? ORDER BY number').all(c.id);
  c.phases = db.prepare('SELECT * FROM championship_phases WHERE championship_id = ? ORDER BY order_index').all(c.id);
  c.modality_name = c.modality_id ? db.prepare('SELECT name FROM modalities WHERE id = ?').get(c.modality_id)?.name : null;
  res.json(c);
});

router.post('/', requirePermission('campeonatos', 'include'), (req, res) => {
  try {
    const b = { ...req.body };
    if (!b.name) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (req.user.org_id) b.org_id = req.user.org_id;
    if (b.tiebreakers && typeof b.tiebreakers !== 'string') b.tiebreakers = JSON.stringify(b.tiebreakers);
    const keys = Object.keys(b).filter(k => COLS.includes(k));
    const info = db.prepare(`INSERT INTO championships (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => b[k]));
    const created = db.prepare('SELECT * FROM championships WHERE id = ?').get(info.lastInsertRowid);
    audit(req, 'criar', 'championships', created.id, null, created);
    res.status(201).json(created);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requirePermission('campeonatos', 'edit'), (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM championships WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Campeonato não encontrado' });
    const b = { ...req.body };
    if (b.tiebreakers && typeof b.tiebreakers !== 'string') b.tiebreakers = JSON.stringify(b.tiebreakers);
    const keys = Object.keys(b).filter(k => COLS.includes(k));
    if (!keys.length) return res.status(400).json({ error: 'Nada para atualizar' });
    db.prepare(`UPDATE championships SET ${keys.map(k => k + '=?').join(',')} WHERE id = ?`).run(...keys.map(k => b[k]), req.params.id);
    const updated = db.prepare('SELECT * FROM championships WHERE id = ?').get(req.params.id);
    audit(req, 'alterar', 'championships', updated.id, old, updated);
    res.json(updated);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', requirePermission('campeonatos', 'delete'), (req, res) => {
  const old = db.prepare('SELECT * FROM championships WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Campeonato não encontrado' });
  db.prepare('DELETE FROM championships WHERE id = ?').run(req.params.id);
  audit(req, 'excluir', 'championships', req.params.id, old, null);
  res.json({ ok: true });
});

// ---- Participants ----
router.post('/:id/participants', requirePermission('campeonatos', 'edit'), (req, res) => {
  const { club_ids } = req.body; // array of ids
  if (!Array.isArray(club_ids)) return res.status(400).json({ error: 'club_ids deve ser uma lista' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM championship_clubs WHERE championship_id = ?').run(req.params.id);
    const ins = db.prepare('INSERT INTO championship_clubs (championship_id, club_id, seed) VALUES (?,?,?)');
    club_ids.forEach((cid, i) => ins.run(req.params.id, cid, i + 1));
  });
  tx();
  audit(req, 'editar_participantes', 'championships', req.params.id, null, { club_ids });
  res.json({ ok: true, count: club_ids.length });
});

// ---- Generate fixtures ----
router.post('/:id/fixtures', requirePermission('disputas', 'include'), (req, res) => {
  try {
    const result = engine.generateFixtures(req.params.id, req.body || {});
    audit(req, 'gerar_tabela', 'championships', req.params.id, null, result);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- Rounds + matches ----
router.get('/:id/rounds', requirePermission('campeonatos', 'view'), (req, res) => {
  const rounds = db.prepare('SELECT * FROM rounds WHERE championship_id = ? ORDER BY number').all(req.params.id);
  rounds.forEach(r => {
    r.matches = db.prepare(`SELECT m.*, hc.name home_name, hc.logo home_logo, ac.name away_name, ac.logo away_logo, v.name venue_name
      FROM matches m LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id LEFT JOIN venues v ON v.id=m.venue_id
      WHERE m.round_id = ? ORDER BY m.match_date, m.id`).all(r.id);
  });
  res.json(rounds);
});

// ---- Standings ----
router.get('/:id/standings', requirePermission('campeonatos', 'view'), (req, res) => {
  res.json(engine.computeStandings(req.params.id, req.query.phase_id || null, req.query.group_name || null));
});

// ---- Stats ----
router.get('/:id/stats', requirePermission('campeonatos', 'view'), (req, res) => {
  const stats = engine.computePlayerStats(req.params.id, req.query.club_id || null);
  res.json({
    scorers: stats.filter(s => s.goals > 0).sort((a, b) => b.goals - a.goals),
    assists: stats.filter(s => s.assists > 0).sort((a, b) => b.assists - a.assists),
    cards: stats.filter(s => s.yellow || s.red).sort((a, b) => (b.red * 3 + b.yellow) - (a.red * 3 + a.yellow)),
    all: stats
  });
});

router.get('/:id/suspensions', requirePermission('campeonatos', 'view'), (req, res) => {
  res.json(engine.computeSuspensions(req.params.id));
});

module.exports = router;
