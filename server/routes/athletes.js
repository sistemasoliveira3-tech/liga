'use strict';
const express = require('express');
const fs = require('fs');
const db = require('../db');
const { requirePermission, audit } = require('../lib/auth');
const { listQuery } = require('../lib/helpers');
const { uploadImage, uploadAny } = require('../lib/upload');

const router = express.Router();
const COLS = ['org_id','club_id','name','nickname','photo','birth_date','document','cpf','position','number','dominant_foot','height','weight','city','state','phone','email','status','notes'];

router.get('/', requirePermission('atletas', 'view'), (req, res) => {
  const where = []; const params = [];
  if (req.user.org_id) { where.push('a.org_id = ?'); params.push(req.user.org_id); }
  if (req.query.club_id) { where.push('a.club_id = ?'); params.push(req.query.club_id); }
  if (req.query.status) { where.push('a.status = ?'); params.push(req.query.status); }
  if (req.query.position) { where.push('a.position = ?'); params.push(req.query.position); }
  if (req.query.q) { where.push('(a.name LIKE ? OR a.nickname LIKE ? OR a.cpf LIKE ?)'); const q = '%' + req.query.q + '%'; params.push(q, q, q); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(parseInt(req.query.limit) || 300, 2000);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare(`SELECT a.*, c.name club_name, c.logo club_logo FROM athletes a LEFT JOIN clubs c ON c.id = a.club_id ${whereSql} ORDER BY a.name LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM athletes a ${whereSql}`).get(...params).c;
  res.json({ data: rows, total });
});

router.get('/:id', requirePermission('atletas', 'view'), (req, res) => {
  const a = db.prepare(`SELECT a.*, c.name club_name, c.logo club_logo FROM athletes a LEFT JOIN clubs c ON c.id = a.club_id WHERE a.id = ?`).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Atleta não encontrado' });
  a.history = db.prepare('SELECT * FROM athlete_history WHERE athlete_id = ? ORDER BY start_date DESC').all(a.id);
  a.transfers = db.prepare(`SELECT t.*, fc.name from_club, tc.name to_club FROM transfers t
    LEFT JOIN clubs fc ON fc.id = t.from_club_id LEFT JOIN clubs tc ON tc.id = t.to_club_id
    WHERE t.athlete_id = ? ORDER BY t.transfer_date DESC`).all(a.id);
  a.documents = db.prepare("SELECT * FROM documents WHERE entity_type = 'athlete' AND entity_id = ? ORDER BY created_at DESC").all(a.id);
  a.stats = db.prepare(`SELECT m.championship_id, ch.name champ_name, ch.season,
      SUM(CASE WHEN e.type IN ('goal','penalty_goal') THEN 1 ELSE 0 END) goals,
      SUM(CASE WHEN e.type='assist' THEN 1 ELSE 0 END) assists,
      SUM(CASE WHEN e.type='yellow' THEN 1 ELSE 0 END) yellow,
      SUM(CASE WHEN e.type='red' THEN 1 ELSE 0 END) red
    FROM match_events e JOIN matches m ON m.id=e.match_id JOIN championships ch ON ch.id=m.championship_id
    WHERE e.athlete_id = ? GROUP BY m.championship_id`).all(a.id);
  a.totals = {
    goals: a.stats.reduce((s, x) => s + (x.goals || 0), 0),
    assists: a.stats.reduce((s, x) => s + (x.assists || 0), 0),
    yellow: a.stats.reduce((s, x) => s + (x.yellow || 0), 0),
    red: a.stats.reduce((s, x) => s + (x.red || 0), 0),
    titles: a.history.filter(h => h.titles).length
  };
  res.json(a);
});

router.post('/', requirePermission('atletas', 'include'), (req, res) => {
  try {
    const b = { ...req.body };
    if (!b.name) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!b.club_id) return res.status(400).json({ error: 'O atleta deve ser vinculado a um clube' });
    if (req.user.org_id) b.org_id = req.user.org_id;
    const keys = Object.keys(b).filter(k => COLS.includes(k));
    const info = db.prepare(`INSERT INTO athletes (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => b[k]));
    const created = db.prepare('SELECT * FROM athletes WHERE id = ?').get(info.lastInsertRowid);
    audit(req, 'criar', 'athletes', created.id, null, created);
    res.status(201).json(created);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requirePermission('atletas', 'edit'), (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM athletes WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Atleta não encontrado' });
    const keys = Object.keys(req.body).filter(k => COLS.includes(k));
    if (!keys.length) return res.status(400).json({ error: 'Nada para atualizar' });
    db.prepare(`UPDATE athletes SET ${keys.map(k => k + '=?').join(',')} WHERE id = ?`).run(...keys.map(k => req.body[k]), req.params.id);
    const updated = db.prepare('SELECT * FROM athletes WHERE id = ?').get(req.params.id);
    audit(req, 'alterar', 'athletes', updated.id, old, updated);
    res.json(updated);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', requirePermission('atletas', 'delete'), (req, res) => {
  const old = db.prepare('SELECT * FROM athletes WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Atleta não encontrado' });
  db.prepare('DELETE FROM athletes WHERE id = ?').run(req.params.id);
  audit(req, 'excluir', 'athletes', req.params.id, old, null);
  res.json({ ok: true });
});

// ---- Photo upload ----
router.post('/:id/photo', requirePermission('atletas', 'edit'), uploadImage('athletes').single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
  const url = '/uploads/athletes/' + req.file.filename;
  db.prepare('UPDATE athletes SET photo = ? WHERE id = ?').run(url, req.params.id);
  res.json({ ok: true, photo: url });
});

// ---- History ----
router.post('/:id/history', requirePermission('atletas', 'edit'), (req, res) => {
  const { club_name, season, start_date, end_date, goals, titles, notes } = req.body;
  const info = db.prepare('INSERT INTO athlete_history (athlete_id,club_name,season,start_date,end_date,goals,titles,notes) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.params.id, club_name, season, start_date, end_date, goals || 0, titles, notes);
  res.status(201).json(db.prepare('SELECT * FROM athlete_history WHERE id = ?').get(info.lastInsertRowid));
});
router.delete('/:id/history/:hid', requirePermission('atletas', 'edit'), (req, res) => {
  db.prepare('DELETE FROM athlete_history WHERE id = ? AND athlete_id = ?').run(req.params.hid, req.params.id);
  res.json({ ok: true });
});

// ---- Documents ----
router.post('/:id/documents', requirePermission('atletas', 'edit'), uploadAny('documents').single('file'), (req, res) => {
  const { type, valid_until } = req.body;
  const url = req.file ? '/uploads/documents/' + req.file.filename : null;
  const info = db.prepare("INSERT INTO documents (org_id,entity_type,entity_id,type,file,valid_until,status) VALUES (?,?,?,?,?,?,?)")
    .run(req.user.org_id, 'athlete', req.params.id, type || 'Documento', url, valid_until || null, 'pendente');
  res.status(201).json(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid));
});

// ---- Import CSV/TXT ----
// Accepts multipart file (field "file") or raw text in body.text
router.post('/import', requirePermission('atletas', 'include'), uploadAny('imports').single('file'), (req, res) => {
  try {
    let content = '';
    if (req.file) content = fs.readFileSync(req.file.path, 'utf8');
    else if (req.body && req.body.text) content = req.body.text;
    else return res.status(400).json({ error: 'Envie um arquivo CSV/TXT ou o conteúdo em text' });

    const delimiter = content.includes(';') && !content.includes(',') ? ';' : (content.includes('\t') ? '\t' : ',');
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return res.status(400).json({ error: 'Arquivo vazio' });

    // detect header
    const header = lines[0].toLowerCase();
    const hasHeader = /nome|name|atleta/.test(header);
    const start = hasHeader ? 1 : 0;
    const cols = hasHeader ? lines[0].split(delimiter).map(h => h.trim().toLowerCase()) : [];

    const idx = (names) => { for (const n of names) { const i = cols.indexOf(n); if (i >= 0) return i; } return -1; };
    const map = hasHeader ? {
      name: idx(['nome','name','atleta']), nickname: idx(['apelido','nickname','nome_esportivo']),
      club: idx(['clube','club','time']), club_id: idx(['club_id','id_clube']),
      birth_date: idx(['nascimento','data_nascimento','birth_date']), cpf: idx(['cpf']),
      document: idx(['rg','documento','document']), position: idx(['posicao','posição','position']),
      number: idx(['numero','número','number','camisa']), dominant_foot: idx(['pe','pé','dominant_foot','pe_dominante']),
      height: idx(['altura','height']), weight: idx(['peso','weight']),
      city: idx(['cidade','city']), state: idx(['estado','uf','state']), phone: idx(['telefone','phone','celular']), email: idx(['email','e-mail'])
    } : null;

    const insAth = db.prepare(`INSERT INTO athletes (org_id,club_id,name,nickname,birth_date,cpf,document,position,number,dominant_foot,height,weight,city,state,phone,email,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pendente')`);
    // resolve target organization (super admin has org_id = null)
    let targetOrg = req.user.org_id || (req.body.org_id ? parseInt(req.body.org_id) : null);
    if (!targetOrg) { const first = db.prepare('SELECT id FROM organizations ORDER BY id LIMIT 1').get(); targetOrg = first ? first.id : null; }

    // accent-insensitive club lookup map
    const norm = (s) => (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const clubRows = db.prepare('SELECT id, name, short_name FROM clubs WHERE (? IS NULL OR org_id = ?)').all(targetOrg, targetOrg);
    const clubMap = {};
    clubRows.forEach((c) => { clubMap[norm(c.name)] = c.id; if (c.short_name) clubMap[norm(c.short_name)] = c.id; });
    const findClubSmart = (q) => {
      const n = norm(q); if (!n) return null;
      if (clubMap[n]) return clubMap[n];
      const hit = Object.keys(clubMap).find((k) => k.includes(n) || n.includes(k));
      return hit ? clubMap[hit] : null;
    };

    let imported = 0; const errors = [];
    const tx = db.transaction(() => {
      for (let li = start; li < lines.length; li++) {
        const parts = lines[li].split(delimiter).map(p => p.trim());
        let rec;
        if (hasHeader) {
          const get = (k) => map[k] >= 0 ? (parts[map[k]] || '') : '';
          rec = { name: get('name'), nickname: get('nickname'), club: get('club'), club_id: get('club_id'),
            birth_date: get('birth_date'), cpf: get('cpf'), document: get('document'), position: get('position'),
            number: get('number'), dominant_foot: get('dominant_foot'), height: get('height'), weight: get('weight'),
            city: get('city'), state: get('state'), phone: get('phone'), email: get('email') };
        } else {
          rec = { name: parts[0], club: parts[1], position: parts[2], number: parts[3], cpf: parts[4], birth_date: parts[5] };
        }
        if (!rec.name) { errors.push(`Linha ${li + 1}: nome ausente`); continue; }
        let clubId = rec.club_id ? parseInt(rec.club_id) : null;
        if (!clubId && rec.club) { const c = findClubSmart(rec.club); clubId = c || null; }
        if (!clubId) { errors.push(`Linha ${li + 1}: clube "${rec.club || ''}" não encontrado (atleta não vinculado)`); }
        const info = insAth.run(targetOrg, clubId, rec.name, rec.nickname || null, rec.birth_date || null, rec.cpf || null,
          rec.document || null, rec.position || null, rec.number || null, rec.dominant_foot || null, rec.height || null,
          rec.weight || null, rec.city || null, rec.state || null, rec.phone || null, rec.email || null);
        imported++;
        if (clubId) {
          db.prepare('INSERT INTO athlete_history (athlete_id,club_id,club_name,season,start_date,notes) VALUES (?,?,?,?,?,?)')
            .run(info.lastInsertRowid, clubId, rec.club || null, new Date().getFullYear().toString(), new Date().toISOString().slice(0, 10), 'Importação');
        }
      }
    });
    tx();
    audit(req, 'importar', 'athletes', null, null, { imported });
    res.json({ ok: true, imported, errors, message: `${imported} atleta(s) importado(s)` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
