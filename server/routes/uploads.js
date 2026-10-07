'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requirePermission, audit } = require('../lib/auth');
const { uploadImage, uploadAny } = require('../lib/upload');

const router = express.Router();
router.use(authRequired);

// Generic single image upload (logos, banners, news images, athlete photos)
router.post('/image', uploadImage('images').single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
  const url = '/uploads/images/' + req.file.filename;
  // optionally attach to entity
  const { entity, entity_id, field } = req.body;
  const allowed = { organizations: ['logo'], clubs: ['logo'], athletes: ['photo'], news: ['image'], modalities: ['icon'], referees: ['photo'], sponsors: ['logo'], venues: ['photos'], championships: ['logo'] };
  if (entity && entity_id && field && allowed[entity] && allowed[entity].includes(field)) {
    db.prepare(`UPDATE ${entity} SET ${field} = ? WHERE id = ?`).run(url, entity_id);
    audit(req, 'upload', entity, entity_id, null, { field, url });
  }
  res.json({ ok: true, url });
});

// Multiple photos for a match (up to 20) + auto-share to public portal
router.post('/match/:id/photos', requirePermission('publicacoes', 'include'), uploadAny('photos').array('files', 20), (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Partida não encontrada' });
  const existing = db.prepare('SELECT COUNT(*) c FROM photos WHERE match_id = ?').get(match.id).c;
  const files = req.files || [];
  if (existing + files.length > 20) return res.status(400).json({ error: `Limite de 20 fotos por partida. Já existem ${existing}.` });
  const ins = db.prepare('INSERT INTO photos (org_id,match_id,championship_id,club_id,album,url,caption,shared) VALUES (?,?,?,?,?,?,?,1)');
  const created = [];
  files.forEach((f, i) => {
    const url = '/uploads/photos/' + f.filename;
    const info = ins.run(req.user.org_id, match.id, match.championship_id, null, 'Partida ' + match.id, url, (req.body.captions ? req.body.captions.split('|')[i] : null) || null);
    created.push(db.prepare('SELECT * FROM photos WHERE id = ?').get(info.lastInsertRowid));
  });
  audit(req, 'upload_fotos', 'matches', match.id, null, { count: created.length });
  res.status(201).json({ ok: true, photos: created, shared_to: ['Portal Público', 'Instagram', 'Facebook'] });
});

module.exports = router;
