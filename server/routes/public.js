'use strict';
const express = require('express');
const db = require('../db');
const engine = require('../lib/engine');
const { withResults } = require('./polls');

const router = express.Router();

// list leagues (organizations)
router.get('/orgs', (req, res) => {
  res.json(db.prepare("SELECT id,name,slug,logo,city,state,type,primary_color FROM organizations WHERE status='ativa' ORDER BY name").all());
});

// league home by slug or id
router.get('/org/:slug', (req, res) => {
  const key = req.params.slug;
  const org = db.prepare('SELECT * FROM organizations WHERE slug = ? OR id = ?').get(key, key);
  if (!org) return res.status(404).json({ error: 'Liga não encontrada' });
  const championships = db.prepare('SELECT * FROM championships WHERE org_id = ? ORDER BY id DESC').all(org.id);
  championships.forEach(c => {
    c.modality_name = c.modality_id ? db.prepare('SELECT name FROM modalities WHERE id=?').get(c.modality_id)?.name : null;
    c.clubs = db.prepare('SELECT COUNT(*) c FROM championship_clubs WHERE championship_id=?').get(c.id).c;
  });
  const news = db.prepare("SELECT id,title,subtitle,image,category,publish_date FROM news WHERE org_id=? AND status='publicada' ORDER BY publish_date DESC LIMIT 6").all(org.id);
  const sponsors = db.prepare('SELECT * FROM sponsors WHERE org_id=? ORDER BY id DESC').all(org.id);
  res.json({ org, championships, news, sponsors });
});

// championship public page
router.get('/championship/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM championships WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campeonato não encontrado' });
  c.modality_name = c.modality_id ? db.prepare('SELECT name FROM modalities WHERE id=?').get(c.modality_id)?.name : null;
  c.org = db.prepare('SELECT id,name,logo,slug,primary_color FROM organizations WHERE id=?').get(c.org_id);

  const rounds = db.prepare('SELECT * FROM rounds WHERE championship_id=? ORDER BY number').all(c.id);
  rounds.forEach(r => {
    r.matches = db.prepare(`SELECT m.id,m.match_date,m.match_time,m.status,m.home_score,m.away_score,m.home_club_id,m.away_club_id,m.group_name,m.stream_url,m.published,
      hc.name home_name, hc.logo home_logo, ac.name away_name, ac.logo away_logo, v.name venue_name
      FROM matches m LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id LEFT JOIN venues v ON v.id=m.venue_id
      WHERE m.round_id=? ORDER BY m.match_date, m.match_time`).all(r.id);
  });

  const standings = engine.computeStandings(c.id);
  const stats = engine.computePlayerStats(c.id);
  const scorers = stats.filter(s => s.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 20);
  const assists = stats.filter(s => s.assists > 0).sort((a, b) => b.assists - a.assists).slice(0, 20);
  const cards = stats.filter(s => s.yellow || s.red).sort((a, b) => (b.red * 3 + b.yellow) - (a.red * 3 + a.yellow)).slice(0, 20);
  const clubs = db.prepare(`SELECT cl.*, cc.group_name FROM championship_clubs cc JOIN clubs cl ON cl.id=cc.club_id WHERE cc.championship_id=? ORDER BY cl.name`).all(c.id);
  const news = db.prepare("SELECT id,title,subtitle,image,category,publish_date FROM news WHERE championship_id=? AND status='publicada' ORDER BY publish_date DESC LIMIT 8").all(c.id);
  const photos = db.prepare('SELECT * FROM photos WHERE championship_id=? AND shared=1 ORDER BY id DESC LIMIT 12').all(c.id);
  const streams = db.prepare('SELECT * FROM streams WHERE org_id=? ORDER BY id DESC LIMIT 6').all(c.org_id);
  const polls = db.prepare('SELECT * FROM polls WHERE championship_id=? ORDER BY id DESC').all(c.id).map(withResults);
  const sponsors = db.prepare('SELECT * FROM sponsors WHERE championship_id=? OR org_id=? ORDER BY id DESC').all(c.id, c.org_id);

  res.json({ championship: c, rounds, standings, scorers, assists, cards, clubs, news, photos, streams, polls, sponsors });
});

// match detail
router.get('/match/:id', (req, res) => {
  const m = db.prepare(`SELECT m.*, hc.name home_name, hc.logo home_logo, ac.name away_name, ac.logo away_logo,
      c.name champ_name, c.season, v.name venue_name, v.city venue_city, r.name referee_name
    FROM matches m LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id
    LEFT JOIN championships c ON c.id=m.championship_id LEFT JOIN venues v ON v.id=m.venue_id LEFT JOIN referees r ON r.id=m.referee_id
    WHERE m.id=?`).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Partida não encontrada' });
  m.events = db.prepare(`SELECT e.*, a.name athlete_name, a.nickname athlete_nick, rel.name related_name FROM match_events e
    LEFT JOIN athletes a ON a.id=e.athlete_id LEFT JOIN athletes rel ON rel.id=e.related_athlete_id WHERE e.match_id=? ORDER BY e.minute`).all(m.id);
  m.lineups = db.prepare(`SELECT l.*, a.name, a.nickname, a.number num FROM lineups l LEFT JOIN athletes a ON a.id=l.athlete_id WHERE l.match_id=?`).all(m.id);
  m.home_lineup = m.lineups.filter(l => l.club_id === m.home_club_id);
  m.away_lineup = m.lineups.filter(l => l.club_id === m.away_club_id);
  m.photos = db.prepare('SELECT * FROM photos WHERE match_id=?').all(m.id);
  m.streams = db.prepare('SELECT * FROM streams WHERE match_id=?').all(m.id);
  res.json(m);
});

// club profile
router.get('/club/:id', (req, res) => {
  const club = db.prepare('SELECT * FROM clubs WHERE id=?').get(req.params.id);
  if (!club) return res.status(404).json({ error: 'Clube não encontrado' });
  club.athletes = db.prepare("SELECT id,name,nickname,photo,position,number,status FROM athletes WHERE club_id=? AND status!='inativo' ORDER BY name").all(club.id);
  club.matches = db.prepare(`SELECT m.id,m.match_date,m.match_time,m.status,m.home_score,m.away_score,m.home_club_id,m.away_club_id,
      hc.name home_name, ac.name away_name FROM matches m LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id
      WHERE m.home_club_id=? OR m.away_club_id=? ORDER BY m.match_date DESC LIMIT 20`).all(club.id, club.id);
  club.titles = db.prepare('SELECT DISTINCT ch.name, ch.season FROM athlete_history h JOIN athletes a ON a.id=h.athlete_id JOIN championships ch ON 1=1 WHERE a.club_id=? AND h.titles IS NOT NULL LIMIT 5').all(club.id);
  res.json(club);
});

// athlete profile
router.get('/athlete/:id', (req, res) => {
  const a = db.prepare('SELECT a.*, c.name club_name, c.logo club_logo FROM athletes a LEFT JOIN clubs c ON c.id=a.club_id WHERE a.id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Atleta não encontrado' });
  a.history = db.prepare('SELECT * FROM athlete_history WHERE athlete_id=? ORDER BY start_date DESC').all(a.id);
  a.transfers = db.prepare(`SELECT t.*, fc.name from_club, tc.name to_club FROM transfers t LEFT JOIN clubs fc ON fc.id=t.from_club_id LEFT JOIN clubs tc ON tc.id=t.to_club_id WHERE t.athlete_id=? ORDER BY t.transfer_date DESC`).all(a.id);
  const stats = db.prepare(`SELECT m.championship_id, ch.name champ_name, ch.season,
      SUM(CASE WHEN e.type IN ('goal','penalty_goal') THEN 1 ELSE 0 END) goals,
      SUM(CASE WHEN e.type='assist' THEN 1 ELSE 0 END) assists,
      SUM(CASE WHEN e.type='yellow' THEN 1 ELSE 0 END) yellow,
      SUM(CASE WHEN e.type='red' THEN 1 ELSE 0 END) red
    FROM match_events e JOIN matches m ON m.id=e.match_id JOIN championships ch ON ch.id=m.championship_id WHERE e.athlete_id=? GROUP BY m.championship_id`).all(a.id);
  a.stats = stats;
  a.totals = { goals: stats.reduce((s, x) => s + (x.goals || 0), 0), assists: stats.reduce((s, x) => s + (x.assists || 0), 0),
    yellow: stats.reduce((s, x) => s + (x.yellow || 0), 0), red: stats.reduce((s, x) => s + (x.red || 0), 0),
    titles: a.history.filter(h => h.titles).length, clubs: new Set(a.history.map(h => h.club_name)).size };
  res.json(a);
});

// news
router.get('/news', (req, res) => {
  const where = ["status='publicada'"]; const params = [];
  if (req.query.org_id) { where.push('org_id=?'); params.push(req.query.org_id); }
  if (req.query.championship_id) { where.push('championship_id=?'); params.push(req.query.championship_id); }
  res.json(db.prepare(`SELECT * FROM news WHERE ${where.join(' AND ')} ORDER BY publish_date DESC LIMIT 50`).all(...params));
});
router.get('/news/:id', (req, res) => {
  const n = db.prepare('SELECT * FROM news WHERE id=?').get(req.params.id);
  if (!n) return res.status(404).json({ error: 'Notícia não encontrada' });
  db.prepare('UPDATE news SET views = views + 1 WHERE id=?').run(n.id);
  res.json(n);
});

// photos / videos / streams / polls
router.get('/photos', (req, res) => {
  const where = ['shared=1']; const params = [];
  if (req.query.championship_id) { where.push('championship_id=?'); params.push(req.query.championship_id); }
  res.json(db.prepare(`SELECT * FROM photos WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 60`).all(...params));
});
router.get('/videos', (req, res) => {
  const where = []; const params = [];
  if (req.query.championship_id) { where.push('championship_id=?'); params.push(req.query.championship_id); }
  res.json(db.prepare(`SELECT * FROM videos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 40`).all(...params));
});
router.get('/streams', (req, res) => {
  const where = []; const params = [];
  if (req.query.org_id) { where.push('org_id=?'); params.push(req.query.org_id); }
  res.json(db.prepare(`SELECT * FROM streams ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 20`).all(...params));
});
router.get('/polls', (req, res) => {
  const where = []; const params = [];
  if (req.query.championship_id) { where.push('championship_id=?'); params.push(req.query.championship_id); }
  if (req.query.org_id) { where.push('org_id=?'); params.push(req.query.org_id); }
  res.json(db.prepare(`SELECT * FROM polls ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 20`).all(...params).map(withResults));
});

// public poll vote
router.post('/polls/:id/vote', (req, res) => {
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

// public súmula PDF (view/download/print)
router.get('/match/:id/pdf', async (req, res) => {
  try {
    const pdf = require('../lib/pdf');
    const fs = require('fs');
    const path = require('path');
    const pdfPath = path.join(__dirname, '..', '..', 'uploads', 'sumulas', 'sumula_' + req.params.id + '.pdf');
    if (!fs.existsSync(pdfPath)) await pdf.generateSumulaPDF(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sumula_${req.params.id}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// global search
router.get('/search', (req, res) => {
  const q = '%' + (req.query.q || '') + '%';
  res.json({
    clubs: db.prepare('SELECT id,name,logo FROM clubs WHERE name LIKE ? LIMIT 8').all(q),
    athletes: db.prepare('SELECT id,name,nickname,photo FROM athletes WHERE name LIKE ? OR nickname LIKE ? LIMIT 8').all(q, q),
    championships: db.prepare('SELECT id,name,season FROM championships WHERE name LIKE ? LIMIT 8').all(q)
  });
});

module.exports = router;
