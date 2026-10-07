'use strict';
const express = require('express');
const db = require('../db');
const { requirePermission, audit } = require('./auth');
const { listQuery, slugify } = require('./helpers');

/**
 * Build a standard CRUD router for a table.
 * opts: { table, module, columns[], search, order, orgScoped, beforeCreate, beforeUpdate, slugFrom, filters }
 */
function crudRouter(opts) {
  const r = express.Router();
  const { table, module: mod, columns, search, order, orgScoped = true, filters } = opts;

  r.get('/', requirePermission(mod, 'view'), (req, res) => {
    const { rows, total } = listQuery(table, req, { orgScoped, search, order: order || 'id DESC', filters });
    res.json({ data: rows, total });
  });

  r.get('/:id', requirePermission(mod, 'view'), (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json(row);
  });

  r.post('/', requirePermission(mod, 'include'), (req, res) => {
    try {
      const body = opts.beforeCreate ? opts.beforeCreate(req.body, req) : { ...req.body };
      if (orgScoped && req.user.org_id && body.org_id === undefined) body.org_id = req.user.org_id;
      if (opts.slugFrom && !body.slug) body.slug = slugify(body[opts.slugFrom]) + '-' + Date.now().toString(36).slice(-4);
      const keys = Object.keys(body).filter(k => columns.includes(k));
      if (!keys.length) return res.status(400).json({ error: 'Nenhum campo válido informado' });
      const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
      const info = db.prepare(sql).run(...keys.map(k => body[k]));
      const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
      audit(req, 'criar', table, created.id, null, created);
      res.status(201).json(created);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.put('/:id', requirePermission(mod, 'edit'), (req, res) => {
    try {
      const old = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      if (!old) return res.status(404).json({ error: 'Registro não encontrado' });
      const body = opts.beforeUpdate ? opts.beforeUpdate(req.body, old, req) : { ...req.body };
      const keys = Object.keys(body).filter(k => columns.includes(k));
      if (!keys.length) return res.status(400).json({ error: 'Nenhum campo válido informado' });
      const sql = `UPDATE ${table} SET ${keys.map(k => k + '=?').join(',')} WHERE id = ?`;
      db.prepare(sql).run(...keys.map(k => body[k]), req.params.id);
      const updated = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
      audit(req, 'alterar', table, updated.id, old, updated);
      res.json(updated);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.delete('/:id', requirePermission(mod, 'delete'), (req, res) => {
    const old = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Registro não encontrado' });
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    audit(req, 'excluir', table, req.params.id, old, null);
    res.json({ ok: true });
  });

  return r;
}

module.exports = { crudRouter };
