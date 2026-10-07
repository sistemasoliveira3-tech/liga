'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

// Public: list states
router.get('/states', (req, res) => {
  res.json(db.prepare('SELECT id,uf,name FROM states ORDER BY name').all());
});

// Public: cities filtered by state (uf or state_id)
router.get('/cities', (req, res) => {
  const { uf, state_id, q } = req.query;
  let stateId = state_id;
  if (!stateId && uf) {
    const s = db.prepare('SELECT id FROM states WHERE uf = ?').get(uf);
    stateId = s ? s.id : null;
  }
  if (!stateId) return res.json([]);
  let sql = 'SELECT id,name FROM cities WHERE state_id = ?';
  const params = [stateId];
  if (q) { sql += ' AND name LIKE ?'; params.push('%' + q + '%'); }
  sql += ' ORDER BY name LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

module.exports = router;
