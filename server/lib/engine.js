'use strict';
const db = require('../db');

/* =========================================================
   MOTOR DE TABELA (fixtures) + CLASSIFICAÇÃO
   ========================================================= */

// Round-robin (Berger tables). Returns array of rounds, each an array of [home, away].
function roundRobin(teamIds, doubleRound = false) {
  const teams = teamIds.slice();
  if (teams.length % 2 !== 0) teams.push(null); // bye
  const n = teams.length;
  const rounds = [];
  const fixed = teams[0];
  let rest = teams.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    const arr = [fixed, ...rest];
    for (let i = 0; i < n / 2; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home !== null && away !== null) {
        // alternate home/away for balance
        if (r % 2 === 0) round.push([home, away]);
        else round.push([away, home]);
      }
    }
    rounds.push(round);
    rest.unshift(rest.pop());
  }
  if (doubleRound) {
    const second = rounds.map(rd => rd.map(([h, a]) => [a, h]));
    return rounds.concat(second);
  }
  return rounds;
}

// Split teams into groups (serpentine)
function splitGroups(teamIds, numGroups) {
  const groups = Array.from({ length: numGroups }, () => []);
  teamIds.forEach((t, i) => {
    const row = Math.floor(i / numGroups);
    const col = row % 2 === 0 ? i % numGroups : numGroups - 1 - (i % numGroups);
    groups[col].push(t);
  });
  return groups;
}

// Generate fixtures for a championship
function generateFixtures(championshipId, options = {}) {
  const champ = db.prepare('SELECT * FROM championships WHERE id = ?').get(championshipId);
  if (!champ) throw new Error('Campeonato não encontrado');
  const participants = db.prepare('SELECT * FROM championship_clubs WHERE championship_id = ? ORDER BY seed, id').all(championshipId);
  if (participants.length < 2) throw new Error('É necessário ao menos 2 clubes participantes');

  // clear existing rounds/matches
  db.prepare('DELETE FROM matches WHERE championship_id = ?').run(championshipId);
  db.prepare('DELETE FROM rounds WHERE championship_id = ?').run(championshipId);

  const format = options.format || champ.format;
  const doubleRound = options.doubleRound !== undefined ? options.doubleRound : !!champ.double_round;
  const startDate = options.startDate || champ.start_date || new Date().toISOString().slice(0, 10);
  const intervalDays = options.intervalDays || 7;

  const insRound = db.prepare('INSERT INTO rounds (championship_id, phase_id, number, name, start_date, end_date) VALUES (?,?,?,?,?,?)');
  const insMatch = db.prepare(`INSERT INTO matches (championship_id, phase_id, round_id, group_name, home_club_id, away_club_id, match_date, match_time, status, leg)
    VALUES (?,?,?,?,?,?,?,?, 'agendada', ?)`);

  const created = [];

  function addRound(num, name, pairs, dateStr, groupName) {
    const r = insRound.run(championshipId, null, num, name, dateStr, dateStr);
    const roundId = r.lastInsertRowid;
    pairs.forEach(([h, a]) => {
      const m = insMatch.run(championshipId, null, roundId, groupName || null, h, a, dateStr, '15:00', doubleRound ? 1 : 1);
      created.push(m.lastInsertRowid);
    });
    return roundId;
  }

  const dateFor = (i) => {
    const d = new Date(startDate + 'T12:00:00');
    d.setDate(d.getDate() + i * intervalDays);
    return d.toISOString().slice(0, 10);
  };

  if (format === 'grupos_mata_mata') {
    const numGroups = options.numGroups || 2;
    const ids = participants.map(p => p.club_id);
    const groups = splitGroups(ids, numGroups);
    // persist group names
    groups.forEach((g, gi) => {
      const gname = 'Grupo ' + String.fromCharCode(65 + gi);
      g.forEach(clubId => db.prepare('UPDATE championship_clubs SET group_name = ? WHERE championship_id = ? AND club_id = ?').run(gname, championshipId, clubId));
    });
    let roundCounter = 1;
    let dayCounter = 0;
    groups.forEach((g, gi) => {
      const gname = 'Grupo ' + String.fromCharCode(65 + gi);
      const rr = roundRobin(g, doubleRound);
      rr.forEach((pairs, ri) => {
        addRound(roundCounter++, `Rodada ${ri + 1} - ${gname}`, pairs, dateFor(dayCounter++), gname);
      });
    });
  } else if (format === 'mata_mata' || format === 'eliminatoria_simples' || format === 'eliminatoria_dupla') {
    // generate bracket first round only (later rounds created as results come in)
    const ids = participants.map(p => p.club_id);
    const pairs = [];
    for (let i = 0; i < ids.length; i += 2) {
      if (ids[i + 1] !== undefined) pairs.push([ids[i], ids[i + 1]]);
    }
    const size = ids.length;
    let phaseName = 'Final';
    if (size >= 16) phaseName = 'Oitavas de Final';
    else if (size >= 8) phaseName = 'Quartas de Final';
    else if (size >= 4) phaseName = 'Semifinal';
    addRound(1, phaseName, pairs, dateFor(0), null);
  } else {
    // pontos_corridos / todos_contra_todos / liga
    const ids = participants.map(p => p.club_id);
    const rr = roundRobin(ids, doubleRound);
    rr.forEach((pairs, ri) => addRound(ri + 1, `Rodada ${ri + 1}`, pairs, dateFor(ri), null));
  }

  return { rounds: db.prepare('SELECT COUNT(*) c FROM rounds WHERE championship_id = ?').get(championshipId).c, matches: created.length };
}

/* ---------------- CLASSIFICAÇÃO ---------------- */
function computeStandings(championshipId, phaseId = null, groupName = null) {
  const champ = db.prepare('SELECT * FROM championships WHERE id = ?').get(championshipId);
  if (!champ) return [];
  const pw = champ.points_win ?? 3, pd = champ.points_draw ?? 1, pl = champ.points_loss ?? 0;

  let sql = `SELECT * FROM matches WHERE championship_id = ? AND status = 'finalizada'`;
  const params = [championshipId];
  if (phaseId) { sql += ' AND phase_id = ?'; params.push(phaseId); }
  if (groupName) { sql += ' AND group_name = ?'; params.push(groupName); }
  const matches = db.prepare(sql).all(...params);

  let clubsSql = `SELECT cc.*, c.name, c.short_name, c.logo FROM championship_clubs cc JOIN clubs c ON c.id = cc.club_id WHERE cc.championship_id = ?`;
  const cparams = [championshipId];
  if (groupName) { clubsSql += ' AND cc.group_name = ?'; cparams.push(groupName); }
  const clubs = db.prepare(clubsSql).all(...cparams);

  const table = {};
  clubs.forEach(c => {
    table[c.club_id] = {
      club_id: c.club_id, name: c.name, short_name: c.short_name, logo: c.logo,
      group_name: c.group_name, played: 0, wins: 0, draws: 0, losses: 0,
      goals_for: 0, goals_against: 0, goal_diff: 0, points: 0, form: []
    };
  });

  matches.forEach(m => {
    const h = table[m.home_club_id], a = table[m.away_club_id];
    if (!h || !a) return;
    const hs = m.home_score || 0, as = m.away_score || 0;
    h.played++; a.played++;
    h.goals_for += hs; h.goals_against += as;
    a.goals_for += as; a.goals_against += hs;
    if (hs > as) { h.wins++; h.points += pw; a.losses++; a.points += pl; h.form.push('V'); a.form.push('D'); }
    else if (hs < as) { a.wins++; a.points += pw; h.losses++; h.points += pl; a.form.push('V'); h.form.push('D'); }
    else { h.draws++; a.draws++; h.points += pd; a.points += pd; h.form.push('E'); a.form.push('E'); }
  });

  let rows = Object.values(table);
  rows.forEach(r => { r.goal_diff = r.goals_for - r.goals_against; r.form = r.form.slice(-5).join(''); });

  const tb = JSON.parse(champ.tiebreakers || '["points","wins","goal_diff","goals_for"]');
  const keyMap = { points: 'points', wins: 'wins', goal_diff: 'goal_diff', goals_for: 'goals_for', draws: 'draws', losses: 'losses' };
  rows.sort((x, y) => {
    for (const k of tb) {
      const kk = keyMap[k] || k;
      if (y[kk] !== x[kk]) return y[kk] - x[kk];
    }
    return (y.goal_diff - x.goal_diff) || (y.goals_for - x.goals_for);
  });
  rows.forEach((r, i) => { r.position = i + 1; });
  return rows;
}

/* ---------------- ESTATÍSTICAS ---------------- */
function computePlayerStats(championshipId, clubId = null) {
  let sql = `SELECT e.*, a.name, a.nickname, a.photo, a.position, a.club_id, c.name AS club_name FROM match_events e
    JOIN matches m ON m.id = e.match_id
    LEFT JOIN athletes a ON a.id = e.athlete_id
    LEFT JOIN clubs c ON c.id = a.club_id
    WHERE m.championship_id = ?`;
  const params = [championshipId];
  if (clubId) { sql += ' AND a.club_id = ?'; params.push(clubId); }
  const events = db.prepare(sql).all(...params);

  const stats = {};
  const ensure = (id, e) => {
    if (!stats[id]) stats[id] = {
      athlete_id: id, name: e.name, nickname: e.nickname, photo: e.photo, position: e.position, club_id: e.club_id, club_name: e.club_name,
      goals: 0, assists: 0, yellow: 0, red: 0, appearances: 0
    };
    return stats[id];
  };
  events.forEach(e => {
    if (!e.athlete_id) return;
    const s = ensure(e.athlete_id, e);
    if (e.type === 'goal' || e.type === 'penalty_goal') s.goals++;
    else if (e.type === 'own_goal') s.goals--; // own goal counts negative for scorer
    else if (e.type === 'assist') s.assists++;
    else if (e.type === 'yellow') s.yellow++;
    else if (e.type === 'red') s.red++;
  });

  // appearances from lineups
  const apps = db.prepare(`SELECT l.athlete_id, COUNT(DISTINCT l.match_id) c FROM lineups l
    JOIN matches m ON m.id = l.match_id WHERE m.championship_id = ? GROUP BY l.athlete_id`).all(championshipId);
  apps.forEach(a => {
    if (stats[a.athlete_id]) stats[a.athlete_id].appearances = a.c;
    else {
      const ath = db.prepare('SELECT id,name,nickname,photo,position,club_id FROM athletes WHERE id = ?').get(a.athlete_id);
      if (ath) { stats[a.athlete_id] = { athlete_id: ath.id, name: ath.name, nickname: ath.nickname, photo: ath.photo, position: ath.position, club_id: ath.club_id, goals: 0, assists: 0, yellow: 0, red: 0, appearances: a.c }; }
    }
  });
  return Object.values(stats);
}

function topScorers(championshipId, limit = 20) {
  return computePlayerStats(championshipId).filter(s => s.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, limit);
}
function cardRanking(championshipId) {
  return computePlayerStats(championshipId).filter(s => s.yellow || s.red)
    .sort((a, b) => (b.red * 3 + b.yellow) - (a.red * 3 + a.yellow));
}

/* ---------------- SUSPENSÕES ---------------- */
function computeSuspensions(championshipId) {
  // Automatic: 3 yellows or 1 red => 1 game suspension
  const stats = computePlayerStats(championshipId);
  return stats.filter(s => s.red > 0 || s.yellow >= 3).map(s => ({
    athlete_id: s.athlete_id, name: s.name, club_id: s.club_id,
    yellow: s.yellow, red: s.red,
    games: s.red > 0 ? 1 : Math.floor(s.yellow / 3)
  }));
}

module.exports = {
  roundRobin, splitGroups, generateFixtures,
  computeStandings, computePlayerStats, topScorers, cardRanking, computeSuspensions
};
