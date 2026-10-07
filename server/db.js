'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'liga.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
  -- ============ GEO ============
  CREATE TABLE IF NOT EXISTS states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uf TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cities_state ON cities(state_id);

  -- ============ CORE / TENANCY ============
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    type TEXT DEFAULT 'Liga',           -- Liga | Federação | Empresa | Organizador
    logo TEXT, cnpj TEXT, address TEXT, district TEXT,
    city TEXT, state TEXT, zip TEXT,
    phone TEXT, email TEXT, website TEXT, social TEXT,
    responsible TEXT, plan TEXT DEFAULT 'FREE', status TEXT DEFAULT 'ativa',
    primary_color TEXT DEFAULT '#0b6e4f',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    is_system INTEGER DEFAULT 0,
    permissions TEXT DEFAULT '{}',       -- JSON { module: {view,include,edit,delete,approve,publish,admin} }
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
    is_super INTEGER DEFAULT 0,
    phone TEXT, avatar TEXT, club_id INTEGER,
    status TEXT DEFAULT 'ativo',
    reset_token TEXT, reset_expires TEXT,
    last_login TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ============ MODALITIES ============
  CREATE TABLE IF NOT EXISTS modalities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER,
    name TEXT NOT NULL,
    icon TEXT, sport_type TEXT,
    status TEXT DEFAULT 'ativa',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ============ CLUBS ============
  CREATE TABLE IF NOT EXISTS clubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    league_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    name TEXT NOT NULL, short_name TEXT, logo TEXT,
    city TEXT, state TEXT, address TEXT, district TEXT, zip TEXT,
    responsible TEXT, phone TEXT, email TEXT, social TEXT, website TEXT,
    founded TEXT, status TEXT DEFAULT 'ativo',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ============ ATHLETES ============
  CREATE TABLE IF NOT EXISTS athletes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
    name TEXT NOT NULL, nickname TEXT, photo TEXT,
    birth_date TEXT, document TEXT, cpf TEXT,
    position TEXT, number TEXT, dominant_foot TEXT,
    height TEXT, weight TEXT,
    city TEXT, state TEXT, phone TEXT, email TEXT,
    status TEXT DEFAULT 'ativo',     -- ativo|inativo|suspenso|transferido|pendente|irregular
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_athletes_club ON athletes(club_id);

  CREATE TABLE IF NOT EXISTS athlete_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    club_id INTEGER, club_name TEXT,
    season TEXT, start_date TEXT, end_date TEXT,
    goals INTEGER DEFAULT 0, titles TEXT, notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, entity_type TEXT, entity_id INTEGER,
    type TEXT, file TEXT, valid_until TEXT,
    status TEXT DEFAULT 'pendente', approved_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, athlete_id INTEGER REFERENCES athletes(id) ON DELETE CASCADE,
    from_club_id INTEGER, to_club_id INTEGER, championship_id INTEGER,
    value REAL DEFAULT 0, admin_fee REAL DEFAULT 0, total REAL DEFAULT 0,
    transfer_date TEXT, reason TEXT, status TEXT DEFAULT 'solicitada',
    responsible TEXT, receipt TEXT, payment_status TEXT DEFAULT 'pendente',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ============ REFEREES ============
  CREATE TABLE IF NOT EXISTS referees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, role TEXT DEFAULT 'Árbitro',   -- Árbitro|Assistente|Quarto Árbitro|Delegado
    document TEXT, cpf TEXT, city TEXT, state TEXT,
    phone TEXT, email TEXT, level TEXT, photo TEXT,
    status TEXT DEFAULT 'ativo',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ============ CHAMPIONSHIPS ============
  CREATE TABLE IF NOT EXISTS championships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    league_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    modality_id INTEGER REFERENCES modalities(id) ON DELETE SET NULL,
    name TEXT NOT NULL, season TEXT, category TEXT, gender TEXT, age_group TEXT,
    regulation TEXT, format TEXT DEFAULT 'pontos_corridos',
    start_date TEXT, end_date TEXT, status TEXT DEFAULT 'planejamento',
    location TEXT, logo TEXT,
    points_win INTEGER DEFAULT 3, points_draw INTEGER DEFAULT 1, points_loss INTEGER DEFAULT 0,
    tiebreakers TEXT DEFAULT '["points","wins","goal_diff","goals_for"]',
    double_round INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS championship_clubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    group_name TEXT, seed INTEGER
  );

  CREATE TABLE IF NOT EXISTS championship_phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    name TEXT, type TEXT, order_index INTEGER DEFAULT 0, config TEXT
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    phase_id INTEGER, number INTEGER, name TEXT,
    start_date TEXT, end_date TEXT
  );

  -- ============ VENUES ============
  CREATE TABLE IF NOT EXISTS venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, address TEXT, city TEXT, state TEXT,
    capacity INTEGER, field_type TEXT, photos TEXT, contact TEXT,
    availability TEXT, status TEXT DEFAULT 'ativo',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ============ MATCHES ============
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
    phase_id INTEGER, round_id INTEGER, group_name TEXT,
    home_club_id INTEGER, away_club_id INTEGER,
    match_date TEXT, match_time TEXT, venue_id INTEGER,
    referee_id INTEGER, assistant1_id INTEGER, assistant2_id INTEGER,
    fourth_id INTEGER, delegate_id INTEGER,
    status TEXT DEFAULT 'agendada',
    home_score INTEGER, away_score INTEGER,
    penalties_home INTEGER, penalties_away INTEGER,
    leg INTEGER DEFAULT 1,
    stream_url TEXT, stream_platform TEXT,
    live_minute INTEGER DEFAULT 0, live_status TEXT,
    notes TEXT, occurrences TEXT,
    published INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_matches_champ ON matches(championship_id);

  CREATE TABLE IF NOT EXISTS lineups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    club_id INTEGER, athlete_id INTEGER,
    is_starter INTEGER DEFAULT 0, is_captain INTEGER DEFAULT 0,
    is_goalkeeper INTEGER DEFAULT 0, position TEXT, number TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS match_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    club_id INTEGER, athlete_id INTEGER, related_athlete_id INTEGER,
    type TEXT, minute INTEGER, detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  -- Performance indexes for the digital s\u00famula (fast event/lineup lookups)
  CREATE INDEX IF NOT EXISTS idx_lineups_match ON lineups(match_id);
  CREATE INDEX IF NOT EXISTS idx_lineups_club ON lineups(club_id);
  CREATE INDEX IF NOT EXISTS idx_events_match ON match_events(match_id);
  CREATE INDEX IF NOT EXISTS idx_events_athlete ON match_events(athlete_id);
  CREATE INDEX IF NOT EXISTS idx_events_match_type ON match_events(match_id, type);

  -- ============ CONTENT ============
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, championship_id INTEGER,
    title TEXT NOT NULL, subtitle TEXT, content TEXT,
    image TEXT, video TEXT, category TEXT, author TEXT,
    publish_date TEXT, status TEXT DEFAULT 'rascunho', views INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, match_id INTEGER, championship_id INTEGER, club_id INTEGER,
    album TEXT, url TEXT, caption TEXT, shared INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, championship_id INTEGER, match_id INTEGER,
    title TEXT, url TEXT, platform TEXT, type TEXT, thumbnail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS streams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, match_id INTEGER, title TEXT, url TEXT,
    platform TEXT DEFAULT 'YouTube', status TEXT DEFAULT 'agendada',
    scheduled_at TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_photos_match ON photos(match_id);
  CREATE INDEX IF NOT EXISTS idx_streams_match ON streams(match_id);

  -- ============ POLLS ============
  CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, championship_id INTEGER,
    title TEXT, type TEXT, options TEXT, round TEXT,
    start_date TEXT, end_date TEXT, status TEXT DEFAULT 'aberta',
    public_result INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS poll_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_index INTEGER, voter TEXT, created_at TEXT DEFAULT (datetime('now'))
  );

  -- ============ SPONSORS ============
  CREATE TABLE IF NOT EXISTS sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, championship_id INTEGER,
    company TEXT, logo TEXT, website TEXT, social TEXT,
    contract_value REAL DEFAULT 0, start_date TEXT, end_date TEXT,
    placements TEXT, status TEXT DEFAULT 'ativo',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ============ FINANCE ============
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, championship_id INTEGER, club_id INTEGER, athlete_id INTEGER,
    type TEXT, category TEXT, description TEXT,
    amount REAL DEFAULT 0, date TEXT, due_date TEXT,
    status TEXT DEFAULT 'pendente', payment_method TEXT,
    document TEXT, cost_center TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, transaction_id INTEGER, amount REAL DEFAULT 0,
    method TEXT, status TEXT DEFAULT 'pendente', boleto_url TEXT,
    pix_code TEXT, paid_at TEXT, created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, match_id INTEGER, lot TEXT, price REAL DEFAULT 0,
    quantity INTEGER DEFAULT 0, sold INTEGER DEFAULT 0, status TEXT DEFAULT 'ativo',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ============ MISC ============
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, user_id INTEGER, title TEXT, message TEXT,
    type TEXT, is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER, user_id INTEGER, user_name TEXT, action TEXT,
    entity TEXT, entity_id INTEGER, old_value TEXT, new_value TEXT,
    ip TEXT, created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT
  );
  `);
}

migrate();

module.exports = db;
