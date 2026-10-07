'use strict';
const db = require('../db');

function slugify(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function ok(res, data) { res.json(data); }
function fail(res, code, msg) { res.status(code).json({ error: msg }); }
function pick(obj, keys) {
  const out = {};
  keys.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}
function nowISO() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// Generic list with search + pagination
function listQuery(table, req, opts = {}) {
  const where = [];
  const params = [];
  if (opts.orgScoped && req.user && req.user.org_id) {
    where.push('org_id = ?'); params.push(req.user.org_id);
  }
  if (opts.filters) {
    for (const [col, val] of Object.entries(opts.filters)) {
      if (req.query[col] !== undefined && req.query[col] !== '') {
        where.push(`${col} = ?`); params.push(req.query[col]);
      }
    }
  }
  if (opts.search && req.query.q) {
    const cols = opts.search.split(',');
    where.push('(' + cols.map(c => `${c} LIKE ?`).join(' OR ') + ')');
    cols.forEach(() => params.push('%' + req.query.q + '%'));
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const order = opts.order || 'id DESC';
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare(`SELECT * FROM ${table} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM ${table} ${whereSql}`).get(...params).c;
  return { rows, total };
}

module.exports = { slugify, ok, fail, pick, nowISO, listQuery };
