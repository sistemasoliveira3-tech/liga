'use strict';
const express = require('express');
const db = require('../db');
const { can } = require('../lib/auth');

const router = express.Router();

// Generic org-scoped list (mirrors lib/helpers.listQuery defaults).
function rows(table, user, { order = 'name', limit = 1000, orgScoped = true } = {}) {
  const where = []; const params = [];
  if (orgScoped && user.org_id) { where.push('org_id = ?'); params.push(user.org_id); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`SELECT * FROM ${table} ${whereSql} ORDER BY ${order} LIMIT ?`).all(...params, limit);
}

// One-shot reference data for the SPA: collapses ~9 round-trips into 1.
// Only includes modules the user is allowed to view (RBAC respected).
router.get('/', (req, res) => {
  const u = req.user;
  const out = {};
  try {
    if (can(u, 'organizacoes', 'view')) {
      out.orgs = u.is_super
        ? db.prepare('SELECT * FROM organizations ORDER BY name').all()
        : db.prepare('SELECT * FROM organizations WHERE id = ?').all(u.org_id || -1);
    }
    if (can(u, 'clubes', 'view')) out.clubs = rows('clubs', u, { limit: 1000 });
    if (can(u, 'modalidades', 'view')) out.modalities = rows('modalities', u, { limit: 1000 });
    if (can(u, 'campeonatos', 'view')) {
      const champs = rows('championships', u, { order: 'id DESC', limit: 1000 });
      const modName = db.prepare('SELECT name FROM modalities WHERE id = ?');
      const orgName = db.prepare('SELECT name FROM organizations WHERE id = ?');
      champs.forEach((r) => {
        r.modality_name = r.modality_id ? (modName.get(r.modality_id) || {}).name : null;
        r.league_name = r.league_id ? (orgName.get(r.league_id) || {}).name : null;
      });
      out.championships = champs;
    }
    if (can(u, 'disputas', 'view')) out.venues = rows('venues', u, { limit: 1000 });
    if (can(u, 'arbitragem', 'view')) out.referees = rows('referees', u, { limit: 1000 });
    if (can(u, 'atletas', 'view')) {
      const where = []; const params = [];
      if (u.org_id) { where.push('a.org_id = ?'); params.push(u.org_id); }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      out.athletes = db.prepare(
        `SELECT a.*, c.name club_name, c.logo club_logo FROM athletes a
         LEFT JOIN clubs c ON c.id = a.club_id ${whereSql} ORDER BY a.name LIMIT 2000`
      ).all(...params);
    }
    if (can(u, 'usuarios', 'view')) {
      out.roles = u.is_super
        ? db.prepare('SELECT * FROM roles ORDER BY name').all()
        : db.prepare('SELECT * FROM roles WHERE org_id IS NULL OR org_id = ? ORDER BY name').all(u.org_id || -1);
    }
    out.states = db.prepare('SELECT id,uf,name FROM states ORDER BY name').all();
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
