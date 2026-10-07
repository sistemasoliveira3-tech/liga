'use strict';
const express = require('express');
const db = require('../db');
const { requirePermission, audit, hashPassword } = require('../lib/auth');

const router = express.Router();

const MODULES = [
  { key: 'organizacoes', label: 'Organizações / Liga' },
  { key: 'modalidades', label: 'Modalidades' },
  { key: 'clubes', label: 'Clubes' },
  { key: 'atletas', label: 'Atletas' },
  { key: 'arbitragem', label: 'Arbitragem' },
  { key: 'campeonatos', label: 'Campeonatos' },
  { key: 'disputas', label: 'Disputas / Tabelas' },
  { key: 'partidas', label: 'Partidas' },
  { key: 'sumula', label: 'Súmula Digital' },
  { key: 'transferencias', label: 'Transferências' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'enquetes', label: 'Enquetes' },
  { key: 'publicacoes', label: 'Publicações / Notícias' },
  { key: 'relatorios', label: 'Relatórios' },
  { key: 'usuarios', label: 'Usuários' }
];
const ACTIONS = ['view','include','edit','delete','approve','publish','admin'];

router.get('/modules', (req, res) => res.json({ modules: MODULES, actions: ACTIONS }));

/* ---------------- USERS ---------------- */
router.get('/users', requirePermission('usuarios', 'view'), (req, res) => {
  const where = []; const params = [];
  if (!req.user.is_super && req.user.org_id) { where.push('u.org_id = ?'); params.push(req.user.org_id); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT u.id,u.name,u.email,u.org_id,u.role_id,u.is_super,u.phone,u.status,u.last_login,u.created_at,
      r.name role_name, o.name org_name FROM users u LEFT JOIN roles r ON r.id=u.role_id LEFT JOIN organizations o ON o.id=u.org_id
      ${whereSql} ORDER BY u.name`).all(...params);
  res.json({ data: rows, total: rows.length });
});

router.post('/users', requirePermission('usuarios', 'include'), (req, res) => {
  try {
    const { name, email, password, role_id, phone, org_id, status } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(400).json({ error: 'E-mail já cadastrado' });
    const info = db.prepare('INSERT INTO users (org_id,name,email,password_hash,role_id,phone,status) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.is_super ? (org_id || null) : req.user.org_id, name, email.toLowerCase(), hashPassword(password), role_id || null, phone || null, status || 'ativo');
    audit(req, 'criar', 'users', info.lastInsertRowid, null, { name, email });
    res.status(201).json(db.prepare('SELECT id,name,email,org_id,role_id,status FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/users/:id', requirePermission('usuarios', 'edit'), (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Usuário não encontrado' });
    const b = { ...req.body };
    const sets = []; const vals = [];
    ['name','email','role_id','phone','status','org_id'].forEach(k => { if (b[k] !== undefined) { sets.push(k + '=?'); vals.push(b[k]); } });
    if (b.password) { sets.push('password_hash=?'); vals.push(hashPassword(b.password)); }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
    db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id = ?`).run(...vals, req.params.id);
    audit(req, 'alterar', 'users', req.params.id, { name: old.name }, { name: b.name });
    res.json(db.prepare('SELECT id,name,email,org_id,role_id,status FROM users WHERE id = ?').get(req.params.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/users/:id', requirePermission('usuarios', 'delete'), (req, res) => {
  const old = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (old.is_super && old.id === req.user.id) return res.status(400).json({ error: 'Não é possível excluir o próprio super admin' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  audit(req, 'excluir', 'users', req.params.id, { name: old.name }, null);
  res.json({ ok: true });
});

/* ---------------- ROLES ---------------- */
router.get('/roles', requirePermission('usuarios', 'view'), (req, res) => {
  let rows;
  if (req.user.is_super) rows = db.prepare('SELECT * FROM roles ORDER BY name').all();
  else rows = db.prepare('SELECT * FROM roles WHERE org_id IS NULL OR org_id = ? ORDER BY name').all(req.user.org_id || -1);
  rows.forEach(r => { try { r.permissions = JSON.parse(r.permissions || '{}'); } catch { r.permissions = {}; } r.user_count = db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ?').get(r.id).c; });
  res.json({ data: rows, total: rows.length });
});

router.post('/roles', requirePermission('usuarios', 'include'), (req, res) => {
  try {
    const { name, description, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome do perfil é obrigatório' });
    const info = db.prepare('INSERT INTO roles (org_id,name,description,permissions) VALUES (?,?,?,?)')
      .run(req.user.is_super ? (req.body.org_id || null) : req.user.org_id, name, description || null, JSON.stringify(permissions || {}));
    audit(req, 'criar', 'roles', info.lastInsertRowid, null, { name });
    res.status(201).json(db.prepare('SELECT * FROM roles WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/roles/:id', requirePermission('usuarios', 'edit'), (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Perfil não encontrado' });
    const { name, description, permissions } = req.body;
    db.prepare('UPDATE roles SET name=COALESCE(?,name), description=COALESCE(?,description), permissions=COALESCE(?,permissions) WHERE id=?')
      .run(name ?? null, description ?? null, permissions !== undefined ? JSON.stringify(permissions) : null, req.params.id);
    audit(req, 'alterar', 'roles', req.params.id, { name: old.name }, { name });
    const r = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    try { r.permissions = JSON.parse(r.permissions); } catch { r.permissions = {}; }
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/roles/:id', requirePermission('usuarios', 'delete'), (req, res) => {
  const old = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Perfil não encontrado' });
  if (old.is_system) return res.status(400).json({ error: 'Perfis de sistema não podem ser excluídos' });
  db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
  audit(req, 'excluir', 'roles', req.params.id, { name: old.name }, null);
  res.json({ ok: true });
});

/* ---------------- AUDIT LOG ---------------- */
router.get('/audit', requirePermission('relatorios', 'view'), (req, res) => {
  const where = []; const params = [];
  if (req.user.org_id) { where.push('org_id = ?'); params.push(req.user.org_id); }
  if (req.query.entity) { where.push('entity = ?'); params.push(req.query.entity); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  res.json(db.prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT 300`).all(...params));
});

module.exports = router;
