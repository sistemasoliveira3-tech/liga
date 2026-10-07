'use strict';
const express = require('express');
const db = require('../db');
const { requirePermission, audit } = require('../lib/auth');

const router = express.Router();

function withResults(p) {
  let options = [];
  try { options = JSON.parse(p.options || '[]'); } catch { options = []; }
  const votes = db.prepare('SELECT option_index, COUNT(*) c FROM poll_votes WHERE poll_id = ? GROUP BY option_index').all(p.id);
  const total = votes.reduce((s, v) => s + v.c, 0);
  const results = options.map((label, i) => {
    const c = votes.find(v => v.option_index === i)?.c || 0;
    return { index: i, label, votes: c, percent: total ? Math.round((c / total) * 100) : 0 };
  });
  return { ...p, options, results, total_votes: total, winner: results.slice().sort((a, b) => b.votes - a.votes)[0] || null };
}

router.get('/', requirePermission('enquetes', 'view'), (req, res) => {
  const where = []; const params = [];
  if (req.user.org_id) { where.push('org_id = ?'); params.push(req.user.org_id); }
  if (req.query.championship_id) { where.push('championship_id = ?'); params.push(req.query.championship_id); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM polls ${whereSql} ORDER BY id DESC`).all(...params);
  res.json({ data: rows.map(withResults), total: rows.length });
});

router.get('/:id', requirePermission('enquetes', 'view'), (req, res) => {
  const p = db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Enquete não encontrada' });
  res.json(withResults(p));
});

router.post('/', requirePermission('enquetes', 'include'), (req, res) => {
  try {
    const b = { ...req.body };
    if (req.user.org_id) b.org_id = req.user.org_id;
    if (Array.isArray(b.options)) b.options = JSON.stringify(b.options);
    const cols = ['org_id','championship_id','title','type','options','round','start_date','end_date','status','public_result'];
    const keys = Object.keys(b).filter(k => cols.includes(k));
    const info = db.prepare(`INSERT INTO polls (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => b[k]));
    audit(req, 'criar', 'polls', info.lastInsertRowid, null, { title: b.title });
    res.status(201).json(withResults(db.prepare('SELECT * FROM polls WHERE id = ?').get(info.lastInsertRowid)));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requirePermission('enquetes', 'edit'), (req, res) => {
  const b = { ...req.body };
  if (Array.isArray(b.options)) b.options = JSON.stringify(b.options);
  const cols = ['championship_id','title','type','options','round','start_date','end_date','status','public_result'];
  const keys = Object.keys(b).filter(k => cols.includes(k));
  if (keys.length) db.prepare(`UPDATE polls SET ${keys.map(k => k + '=?').join(',')} WHERE id = ?`).run(...keys.map(k => b[k]), req.params.id);
  res.json(withResults(db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', requirePermission('enquetes', 'delete'), (req, res) => {
  db.prepare('DELETE FROM polls WHERE id = ?').run(req.params.id);
  audit(req, 'excluir', 'polls', req.params.id, null, null);
  res.json({ ok: true });
});

// admin lifecycle
router.post('/:id/close', requirePermission('enquetes', 'publish'), (req, res) => {
  db.prepare("UPDATE polls SET status='encerrada' WHERE id=?").run(req.params.id);
  res.json(withResults(db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id)));
});
router.post('/:id/reopen', requirePermission('enquetes', 'publish'), (req, res) => {
  db.prepare("UPDATE polls SET status='aberta' WHERE id=?").run(req.params.id);
  res.json(withResults(db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id)));
});
router.post('/:id/publish', requirePermission('enquetes', 'publish'), (req, res) => {
  db.prepare("UPDATE polls SET status='publicada', public_result=1 WHERE id=?").run(req.params.id);
  res.json(withResults(db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id)));
});

// PUBLIC vote
router.post('/:id/vote', (req, res) => {
  const p = db.prepare('SELECT * FROM polls WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Enquete não encontrada' });
  if (p.status !== 'aberta') return res.status(400).json({ error: 'Enquete não está aberta para votação' });
  const idx = parseInt(req.body.option_index);
  let options = []; try { options = JSON.parse(p.options); } catch {}
  if (isNaN(idx) || idx < 0 || idx >= options.length) return res.status(400).json({ error: 'Opção inválida' });
  const voter = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0] + ':' + (req.body.voter || 'anon');
  db.prepare('INSERT INTO poll_votes (poll_id,option_index,voter) VALUES (?,?,?)').run(p.id, idx, voter);
  res.json(withResults(p));
});

module.exports = { router, withResults };
