'use strict';
const express = require('express');
const db = require('../db');
const { requirePermission } = require('../lib/auth');

const router = express.Router();

router.get('/', requirePermission('relatorios', 'view'), (req, res) => {
  const org = req.user.org_id;
  const scoped = (sql, ...p) => org ? db.prepare(sql).get(org, ...p) : db.prepare(sql.replace('WHERE org_id = ?', '')).get(...p);
  const scopedAll = (sql, ...p) => org ? db.prepare(sql).all(org, ...p) : db.prepare(sql.replace('WHERE org_id = ?', '')).all(...p);

  const orgFilter = org ? 'WHERE org_id = ?' : '';
  const orgFilterA = org ? 'AND org_id = ?' : '';

  const stats = {
    championships_active: org ? db.prepare("SELECT COUNT(*) c FROM championships WHERE org_id=? AND status IN ('em_andamento','inscricoes_abertas','planejamento')").get(org).c : db.prepare("SELECT COUNT(*) c FROM championships WHERE status IN ('em_andamento','inscricoes_abertas','planejamento')").get().c,
    championships_total: org ? db.prepare('SELECT COUNT(*) c FROM championships WHERE org_id=?').get(org).c : db.prepare('SELECT COUNT(*) c FROM championships').get().c,
    clubs: org ? db.prepare('SELECT COUNT(*) c FROM clubs WHERE org_id=?').get(org).c : db.prepare('SELECT COUNT(*) c FROM clubs').get().c,
    athletes: org ? db.prepare('SELECT COUNT(*) c FROM athletes WHERE org_id=?').get(org).c : db.prepare('SELECT COUNT(*) c FROM athletes').get().c,
    matches: org ? db.prepare('SELECT COUNT(*) c FROM matches m JOIN championships c ON c.id=m.championship_id WHERE c.org_id=?').get(org).c : db.prepare('SELECT COUNT(*) c FROM matches').get().c,
    goals: org ? db.prepare("SELECT COUNT(*) c FROM match_events e JOIN matches m ON m.id=e.match_id JOIN championships c ON c.id=m.championship_id WHERE c.org_id=? AND e.type IN ('goal','penalty_goal')").get(org).c : db.prepare("SELECT COUNT(*) c FROM match_events WHERE type IN ('goal','penalty_goal')").get().c,
    users: org ? db.prepare('SELECT COUNT(*) c FROM users WHERE org_id=?').get(org).c : db.prepare('SELECT COUNT(*) c FROM users').get().c,
    cards: org ? db.prepare("SELECT COUNT(*) c FROM match_events e JOIN matches m ON m.id=e.match_id JOIN championships c ON c.id=m.championship_id WHERE c.org_id=? AND e.type IN ('yellow','red')").get(org).c : db.prepare("SELECT COUNT(*) c FROM match_events WHERE type IN ('yellow','red')").get().c
  };

  const revenue = org ? db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE org_id=? AND type='receita'").get(org).s : db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='receita'").get().s;
  const expense = org ? db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE org_id=? AND type='despesa'").get(org).s : db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='despesa'").get().s;
  stats.revenue = revenue; stats.expense = expense; stats.balance = revenue - expense;

  // charts
  const goalsByMonth = org ? db.prepare(`SELECT substr(m.match_date,1,7) mes, COUNT(*) jogos, SUM(CASE WHEN e.type IN ('goal','penalty_goal') THEN 1 ELSE 0 END) gols
      FROM matches m LEFT JOIN match_events e ON e.match_id=m.id JOIN championships c ON c.id=m.championship_id
      WHERE c.org_id=? GROUP BY mes ORDER BY mes`).all(org) : db.prepare(`SELECT substr(m.match_date,1,7) mes, COUNT(DISTINCT m.id) jogos, SUM(CASE WHEN e.type IN ('goal','penalty_goal') THEN 1 ELSE 0 END) gols
      FROM matches m LEFT JOIN match_events e ON e.match_id=m.id
      GROUP BY mes ORDER BY mes`).all();
  const financeByMonth = org ? db.prepare(`SELECT substr(date,1,7) mes,
      SUM(CASE WHEN type='receita' THEN amount ELSE 0 END) receita,
      SUM(CASE WHEN type='despesa' THEN amount ELSE 0 END) despesa
      FROM transactions WHERE org_id=? GROUP BY mes ORDER BY mes`).all(org) : db.prepare(`SELECT substr(date,1,7) mes,
      SUM(CASE WHEN type='receita' THEN amount ELSE 0 END) receita,
      SUM(CASE WHEN type='despesa' THEN amount ELSE 0 END) despesa
      FROM transactions GROUP BY mes ORDER BY mes`).all();

  const recentMatches = db.prepare(`SELECT m.*, hc.name home_name, ac.name away_name, c.name champ_name
    FROM matches m LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id
    LEFT JOIN championships c ON c.id=m.championship_id ${org ? 'WHERE c.org_id=?' : ''}
    ORDER BY m.match_date DESC, m.id DESC LIMIT 6`).all(...(org ? [org] : []));

  const topScorers = org ? db.prepare(`SELECT a.name, a.nickname, cl.name club, COUNT(*) gols
    FROM match_events e JOIN matches m ON m.id=e.match_id JOIN championships c ON c.id=m.championship_id
    JOIN athletes a ON a.id=e.athlete_id LEFT JOIN clubs cl ON cl.id=a.club_id
    WHERE c.org_id=? AND e.type IN ('goal','penalty_goal') GROUP BY e.athlete_id ORDER BY gols DESC LIMIT 5`).all(org) : db.prepare(`SELECT a.name, a.nickname, cl.name club, COUNT(*) gols
    FROM match_events e JOIN athletes a ON a.id=e.athlete_id LEFT JOIN clubs cl ON cl.id=a.club_id
    WHERE e.type IN ('goal','penalty_goal') GROUP BY e.athlete_id ORDER BY gols DESC LIMIT 5`).all();

  res.json({ stats, goalsByMonth, financeByMonth, recentMatches, topScorers });
});

module.exports = router;
