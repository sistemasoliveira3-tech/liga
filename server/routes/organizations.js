'use strict';
const express = require('express');
const db = require('../db');
const { requirePermission, audit } = require('../lib/auth');
const { slugify } = require('../lib/helpers');

const router = express.Router();
const COLS = ['name','slug','type','logo','cnpj','address','district','city','state','zip','phone','email','website','social','responsible','plan','status','primary_color'];

// Super admin sees all; others see their own org
router.get('/', requirePermission('organizacoes', 'view'), (req, res) => {
  let rows;
  if (req.user.is_super) rows = db.prepare('SELECT * FROM organizations ORDER BY name').all();
  else rows = db.prepare('SELECT * FROM organizations WHERE id = ?').all(req.user.org_id || -1);
  res.json({ data: rows, total: rows.length });
});

router.get('/:id', requirePermission('organizacoes', 'view'), (req, res) => {
  const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Organização não encontrada' });
  res.json(row);
});

router.post('/', requirePermission('organizacoes', 'include'), (req, res) => {
  try {
    const b = { ...req.body };
    if (!b.name) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!b.slug) b.slug = slugify(b.name) + '-' + Date.now().toString(36).slice(-4);
    const keys = Object.keys(b).filter(k => COLS.includes(k));
    const info = db.prepare(`INSERT INTO organizations (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => b[k]));
    const created = db.prepare('SELECT * FROM organizations WHERE id = ?').get(info.lastInsertRowid);
    audit(req, 'criar', 'organizations', created.id, null, created);
    res.status(201).json(created);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requirePermission('organizacoes', 'edit'), (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Organização não encontrada' });
    const keys = Object.keys(req.body).filter(k => COLS.includes(k));
    if (!keys.length) return res.status(400).json({ error: 'Nada para atualizar' });
    db.prepare(`UPDATE organizations SET ${keys.map(k => k + '=?').join(',')} WHERE id = ?`).run(...keys.map(k => req.body[k]), req.params.id);
    const updated = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
    audit(req, 'alterar', 'organizations', updated.id, old, updated);
    res.json(updated);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', requirePermission('organizacoes', 'delete'), (req, res) => {
  const old = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Organização não encontrada' });
  db.prepare('DELETE FROM organizations WHERE id = ?').run(req.params.id);
  audit(req, 'excluir', 'organizations', req.params.id, old, null);
  res.json({ ok: true });
});

module.exports = router;
