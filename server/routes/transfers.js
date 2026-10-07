'use strict';
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requirePermission, audit } = require('../lib/auth');

const router = express.Router();
const COLS = ['org_id','athlete_id','from_club_id','to_club_id','championship_id','value','admin_fee','total','transfer_date','reason','status','responsible','receipt','payment_status'];

function full(id) {
  return db.prepare(`SELECT t.*, a.name athlete_name, a.photo athlete_photo,
      fc.name from_club, tc.name to_club, c.name champ_name
    FROM transfers t LEFT JOIN athletes a ON a.id=t.athlete_id
    LEFT JOIN clubs fc ON fc.id=t.from_club_id LEFT JOIN clubs tc ON tc.id=t.to_club_id
    LEFT JOIN championships c ON c.id=t.championship_id WHERE t.id = ?`).get(id);
}

router.get('/', requirePermission('transferencias', 'view'), (req, res) => {
  const where = []; const params = [];
  if (req.user.org_id) { where.push('t.org_id = ?'); params.push(req.user.org_id); }
  if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
  if (req.query.athlete_id) { where.push('t.athlete_id = ?'); params.push(req.query.athlete_id); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT t.*, a.name athlete_name, fc.name from_club, tc.name to_club
    FROM transfers t LEFT JOIN athletes a ON a.id=t.athlete_id
    LEFT JOIN clubs fc ON fc.id=t.from_club_id LEFT JOIN clubs tc ON tc.id=t.to_club_id
    ${whereSql} ORDER BY t.transfer_date DESC, t.id DESC`).all(...params);
  res.json({ data: rows, total: rows.length });
});

router.get('/:id', requirePermission('transferencias', 'view'), (req, res) => {
  const t = full(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transferência não encontrada' });
  res.json(t);
});

router.post('/', requirePermission('transferencias', 'include'), (req, res) => {
  try {
    const b = { ...req.body };
    if (req.user.org_id) b.org_id = req.user.org_id;
    b.total = (parseFloat(b.value) || 0) + (parseFloat(b.admin_fee) || 0);
    const keys = Object.keys(b).filter(k => COLS.includes(k));
    const info = db.prepare(`INSERT INTO transfers (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => b[k]));
    audit(req, 'criar', 'transfers', info.lastInsertRowid, null, b);
    res.status(201).json(full(info.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requirePermission('transferencias', 'edit'), (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Transferência não encontrada' });
    const b = { ...req.body };
    if (b.value !== undefined || b.admin_fee !== undefined) b.total = (parseFloat(b.value ?? old.value) || 0) + (parseFloat(b.admin_fee ?? old.admin_fee) || 0);
    const keys = Object.keys(b).filter(k => COLS.includes(k));
    db.prepare(`UPDATE transfers SET ${keys.map(k => k + '=?').join(',')} WHERE id = ?`).run(...keys.map(k => b[k]), req.params.id);
    audit(req, 'alterar', 'transfers', req.params.id, old, b);
    res.json(full(req.params.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Approve -> updates athlete club + history + finance
router.post('/:id/approve', requirePermission('transferencias', 'approve'), (req, res) => {
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transferência não encontrada' });
  const tx = db.transaction(() => {
    db.prepare("UPDATE transfers SET status='aprovada' WHERE id=?").run(t.id);
    db.prepare('UPDATE athletes SET club_id=? WHERE id=?').run(t.to_club_id, t.athlete_id);
    const toClub = db.prepare('SELECT name FROM clubs WHERE id=?').get(t.to_club_id);
    db.prepare("UPDATE athlete_history SET end_date=?, notes=COALESCE(notes,?) WHERE athlete_id=? AND (end_date IS NULL OR end_date='')").run(t.transfer_date, 'Saída', t.athlete_id);
    db.prepare('INSERT INTO athlete_history (athlete_id,club_id,club_name,season,start_date,notes) VALUES (?,?,?,?,?,?)')
      .run(t.athlete_id, t.to_club_id, toClub?.name || null, new Date(t.transfer_date || Date.now()).getFullYear().toString(), t.transfer_date, 'Transferência aprovada');
    if (t.total > 0) {
      db.prepare(`INSERT INTO transactions (org_id,championship_id,club_id,athlete_id,type,category,description,amount,date,due_date,status,payment_method,cost_center)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.org_id, t.championship_id, t.to_club_id, t.athlete_id, 'receita', 'Transferências',
        `Taxa de transferência - ${toClub?.name || ''}`, t.total, t.transfer_date, t.transfer_date, 'pendente', 'Boleto', 'Transferências');
    }
  });
  tx();
  audit(req, 'aprovar', 'transfers', t.id, null, null);
  res.json(full(t.id));
});

// Generate boleto/PIX (simulated)
router.post('/:id/boleto', requirePermission('transferencias', 'edit'), (req, res) => {
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transferência não encontrada' });
  const barcode = '34191' + String(Date.now()).slice(-10) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  const pix = crypto.randomBytes(20).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  const boleto = { barcode, pix, amount: t.total, due: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) };
  db.prepare('UPDATE transfers SET receipt=? WHERE id=?').run(JSON.stringify(boleto), t.id);
  audit(req, 'gerar_boleto', 'transfers', t.id, null, boleto);
  res.json({ ok: true, boleto });
});

// Send boleto to club responsible (email + WhatsApp simulated)
router.post('/:id/send', requirePermission('transferencias', 'edit'), (req, res) => {
  const t = full(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transferência não encontrada' });
  const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(t.to_club_id);
  const channels = [];
  if (club?.email) channels.push({ channel: 'E-mail', to: club.email, status: 'enviado' });
  if (club?.phone) channels.push({ channel: 'WhatsApp', to: club.phone, status: 'enviado' });
  if (!channels.length) channels.push({ channel: 'Nenhum contato cadastrado', to: null, status: 'falha' });
  audit(req, 'enviar_boleto', 'transfers', t.id, null, channels);
  res.json({ ok: true, channels, message: 'Boleto enviado ao responsável do clube' });
});

router.delete('/:id', requirePermission('transferencias', 'delete'), (req, res) => {
  const old = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Transferência não encontrada' });
  db.prepare('DELETE FROM transfers WHERE id = ?').run(req.params.id);
  audit(req, 'excluir', 'transfers', req.params.id, old, null);
  res.json({ ok: true });
});

module.exports = router;
