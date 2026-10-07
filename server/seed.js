'use strict';
const db = require('./db');
const { hashPassword } = require('./lib/auth');
const engine = require('./lib/engine');

const FALLBACK_STATES = [
  ['AC','Acre'],['AL','Alagoas'],['AP','Amapá'],['AM','Amazonas'],['BA','Bahia'],['CE','Ceará'],
  ['DF','Distrito Federal'],['ES','Espírito Santo'],['GO','Goiás'],['MA','Maranhão'],['MT','Mato Grosso'],
  ['MS','Mato Grosso do Sul'],['MG','Minas Gerais'],['PA','Pará'],['PB','Paraíba'],['PR','Paraná'],
  ['PE','Pernambuco'],['PI','Piauí'],['RJ','Rio de Janeiro'],['RN','Rio Grande do Norte'],
  ['RS','Rio Grande do Sul'],['RO','Rondônia'],['RR','Roraima'],['SC','Santa Catarina'],
  ['SP','São Paulo'],['SE','Sergipe'],['TO','Tocantins']
];

async function seedGeo() {
  const count = db.prepare('SELECT COUNT(*) c FROM states').get().c;
  if (count > 0) return;
  let states = FALLBACK_STATES, munis = null;
  try {
    const rs = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados');
    if (rs.ok) {
      const data = await rs.json();
      states = data.map(s => [s.sigla, s.nome]).sort((a, b) => a[0].localeCompare(b[0]));
    }
    const rm = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios');
    if (rm.ok) munis = await rm.json();
    console.log('[seed] IBGE: estados e municípios carregados');
  } catch (e) { console.log('[seed] IBGE indisponível, usando fallback'); }

  const insState = db.prepare('INSERT OR IGNORE INTO states (uf,name) VALUES (?,?)');
  const insCity = db.prepare('INSERT INTO cities (state_id,name) VALUES (?,?)');
  const tx = db.transaction(() => {
    const idByUf = {};
    states.forEach(([uf, name]) => { const r = insState.run(uf, name); idByUf[uf] = r.lastInsertRowid || db.prepare('SELECT id FROM states WHERE uf=?').get(uf).id; });
    if (munis) {
      munis.forEach(m => {
        const uf = m.microrregiao?.mesorregiao?.UF?.sigla || m.regiao?.sigla || m['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla;
        if (uf && idByUf[uf]) insCity.run(idByUf[uf], m.nome);
      });
    } else {
      // minimal fallback cities
      const fb = { MG: ['Belo Horizonte','Caeté','Contagem','Betim','Sabará','Santa Luzia','Nova Lima','Ouro Preto'],
        SP: ['São Paulo','Campinas','Santos','Guarulhos','Ribeirão Preto'], RJ: ['Rio de Janeiro','Niterói','Nova Iguaçu','Campos'],
        BA: ['Salvador','Feira de Santana'], RS: ['Porto Alegre','Caxias do Sul'], PR: ['Curitiba','Londrina'],
        PE: ['Recife','Olinda'], CE: ['Fortaleza','Caucaia'], DF: ['Brasília'], GO: ['Goiânia','Anápolis'],
        SC: ['Florianópolis','Joinville'], ES: ['Vitória','Vila Velha'], AM: ['Manaus'], PA: ['Belém'], MA: ['São Luís'] };
      Object.entries(fb).forEach(([uf, cs]) => { if (idByUf[uf]) cs.forEach(c => insCity.run(idByUf[uf], c)); });
    }
  });
  tx();
  console.log('[seed] estados:', db.prepare('SELECT COUNT(*) c FROM states').get().c, 'cidades:', db.prepare('SELECT COUNT(*) c FROM cities').get().c);
}

const ALL_MODULES = ['organizacoes','modalidades','clubes','atletas','arbitragem','campeonatos','disputas','partidas','sumula','transferencias','financeiro','enquetes','publicacoes','relatorios','usuarios'];

function perms(mods, actions) {
  const o = {};
  mods.forEach(m => { o[m] = {}; actions.forEach(a => o[m][a] = true); });
  return JSON.stringify(o);
}

function seedCore() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) { console.log('[seed] já possui dados, pulando core'); return; }

  const insRole = db.prepare('INSERT INTO roles (org_id,name,description,is_system,permissions) VALUES (?,?,?,?,?)');
  const superRole = insRole.run(null, 'Super Administrador', 'Acesso total à plataforma', 1, perms(ALL_MODULES, ['view','include','edit','delete','approve','publish','admin'])).lastInsertRowid;
  const adminLigaRole = insRole.run(null, 'Administrador da Liga', 'Gestão completa da organização', 1, perms(ALL_MODULES.filter(m=>m!=='organizacoes'), ['view','include','edit','delete','approve','publish'])).lastInsertRowid;
  const gestorCampRole = insRole.run(null, 'Gestor do Campeonato', 'Gestão da competição', 1, perms(['campeonatos','disputas','partidas','sumula','clubes','atletas','arbitragem','relatorios'], ['view','include','edit','approve','publish'])).lastInsertRowid;
  const gestorEquipeRole = insRole.run(null, 'Gestor de Equipe', 'Gestão do elenco', 1, perms(['atletas','clubes','transferencias','partidas'], ['view','include','edit'])).lastInsertRowid;
  const arbitroRole = insRole.run(null, 'Árbitro', 'Acesso à escala e súmula', 1, perms(['partidas','sumula'], ['view','edit','publish'])).lastInsertRowid;
  const delegadoRole = insRole.run(null, 'Delegado', 'Validação de súmula', 1, perms(['partidas','sumula'], ['view','approve'])).lastInsertRowid;
  const atletaRole = insRole.run(null, 'Atleta', 'Acesso ao próprio perfil', 1, perms(['atletas'], ['view'])).lastInsertRowid;

  const insUser = db.prepare('INSERT INTO users (org_id,name,email,password_hash,role_id,is_super,phone,status) VALUES (?,?,?,?,?,?,?,?)');
  insUser.run(null, 'Super Administrador', 'admin@liga.com', hashPassword('admin123'), superRole, 1, '(31) 99999-0000', 'ativo');

  // Organization (Liga)
  const org = db.prepare(`INSERT INTO organizations (name,slug,type,cnpj,address,district,city,state,zip,phone,email,website,social,responsible,plan,status,primary_color)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'Liga Caeté de Futebol', 'liga-caete', 'Liga', '12.345.678/0001-90',
    'Rua das Palmeiras, 120', 'Centro', 'Caeté', 'MG', '34800-000',
    '(31) 3651-0000', 'contato@ligacaete.com.br', 'https://ligacaete.com.br',
    '@ligacaete', 'Renato Silva', 'PREMIUM', 'ativa', '#0b6e4f').lastInsertRowid;

  insUser.run(org, 'Renato Silva', 'liga@liga.com', hashPassword('liga123'), adminLigaRole, 0, '(31) 98888-1111', 'ativo');
  insUser.run(org, 'Gestor Campeonato', 'gestor@liga.com', hashPassword('gestor123'), gestorCampRole, 0, '(31) 98888-2222', 'ativo');
  insUser.run(org, 'Árbitro Central', 'arbitro@liga.com', hashPassword('arbitro123'), arbitroRole, 0, '(31) 98888-3333', 'ativo');

  // Modalities
  const insMod = db.prepare('INSERT INTO modalities (org_id,name,icon,sport_type,status) VALUES (?,?,?,?,?)');
  [['Futebol de Campo','⚽','coletivo'],['Futsal','🥅','coletivo'],['Futebol Society','⚽','coletivo'],
   ['Vôlei','🏐','coletivo'],['Basquete','🏀','coletivo'],['Handebol','🤾','coletivo'],['Beach Tennis','🎾','individual']]
    .forEach(([n,i,t]) => insMod.run(org, n, i, t, 'ativa'));

  // Venues
  const insVenue = db.prepare('INSERT INTO venues (org_id,name,address,city,state,capacity,field_type,contact,status) VALUES (?,?,?,?,?,?,?,?,?)');
  const v1 = insVenue.run(org,'Estádio Municipal de Caeté','Av. Central, 500','Caeté','MG',5000,'Grama natural','(31) 3651-1111','ativo').lastInsertRowid;
  const v2 = insVenue.run(org,'Campo do Bairro Pedra Branca','Rua 7, 45','Caeté','MG',1200,'Grama sintética','(31) 3651-2222','ativo').lastInsertRowid;
  const v3 = insVenue.run(org,'Arena Sabará','Rod. MG-262, km 3','Sabará','MG',3000,'Grama natural','(31) 3671-3333','ativo').lastInsertRowid;

  // Clubs
  const insClub = db.prepare(`INSERT INTO clubs (org_id,league_id,name,short_name,city,state,address,responsible,phone,email,social,founded,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const clubsData = [
    ['Penharol FC','Penharol','Caeté','MG','Rua A, 10','Carlos','(31) 99111-0001','penharol@clube.com','@penharol','1975'],
    ['União Caeté','União','Caeté','MG','Rua B, 20','Marcos','(31) 99111-0002','uniao@clube.com','@uniaocaete','1988'],
    ['Sport Sabará','Sabará','Sabará','MG','Rua C, 30','João','(31) 99111-0003','sport@clube.com','@sportsabara','1990'],
    ['Atlético Pedra Branca','Pedra','Caeté','MG','Rua D, 40','Pedro','(31) 99111-0004','pedra@clube.com','@atleticopedra','2001'],
    ['Real Contagem','Real','Contagem','MG','Rua E, 50','Lucas','(31) 99111-0005','real@clube.com','@realcontagem','1999'],
    ['Grêmio Betim','Grêmio','Betim','MG','Rua F, 60','Rafael','(31) 99111-0006','gremio@clube.com','@gremiobetim','1985'],
    ['Nova Lima EC','Nova Lima','Nova Lima','MG','Rua G, 70','Bruno','(31) 99111-0007','novalima@clube.com','@novalimaec','1995'],
    ['Santa Luzia AC','Santa Luzia','Santa Luzia','MG','Rua H, 80','Diego','(31) 99111-0008','sluzia@clube.com','@sluziaac','2003']
  ];
  const clubIds = clubsData.map(c => insClub.run(org, org, ...c, 'ativo').lastInsertRowid);

  // Referees
  const insRef = db.prepare('INSERT INTO referees (org_id,name,role,document,city,state,phone,email,level,status) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const refs = [
    ['Anderson Lima','Árbitro','MG-12345','Caeté','MG','(31) 99222-0001','anderson@ref.com','FIFA'],
    ['Bruno Costa','Assistente','MG-23456','Sabará','MG','(31) 99222-0002','bruno@ref.com','Nacional'],
    ['Carlos Dias','Assistente','MG-34567','Betim','MG','(31) 99222-0003','carlos@ref.com','Nacional'],
    ['Daniel Rocha','Quarto Árbitro','MG-45678','Contagem','MG','(31) 99222-0004','daniel@ref.com','Regional'],
    ['Eduardo Melo','Delegado','MG-56789','Nova Lima','MG','(31) 99222-0005','eduardo@ref.com','Estadual']
  ];
  const refIds = refs.map(r => insRef.run(org, ...r, 'ativo').lastInsertRowid);

  // Athletes
  const insAth = db.prepare(`INSERT INTO athletes (org_id,club_id,name,nickname,birth_date,cpf,position,number,dominant_foot,height,weight,city,state,phone,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const positions = ['Goleiro','Zagueiro','Lateral','Volante','Meia','Atacante'];
  const firstNames = ['Gabriel','Lucas','Matheus','Pedro','João','Rafael','Bruno','Thiago','Felipe','Rodrigo','Gustavo','Vinícius','André','Caio','Diego','Eduardo','Fábio','Henrique','Igor','Júlio'];
  const lastNames = ['Silva','Santos','Oliveira','Souza','Lima','Costa','Pereira','Almeida','Ferreira','Rodrigues','Gomes','Martins','Araújo','Barbosa','Ribeiro'];
  const athleteIds = [];
  let seed = 1;
  clubIds.forEach((clubId, ci) => {
    for (let i = 0; i < 16; i++) {
      const fn = firstNames[(seed * 3) % firstNames.length];
      const ln = lastNames[(seed * 7) % lastNames.length];
      const pos = positions[i % positions.length];
      const r = insAth.run(org, clubId, `${fn} ${ln}`, `${fn}`, `19${85 + (seed % 15)}-0${(seed % 9) + 1}-1${seed % 9}`,
        `${String(100 + seed).padStart(3,'0')}.${seed % 900 + 100}.${seed % 900 + 100}-0${seed % 9}`,
        pos, String(i + 1), seed % 3 === 0 ? 'Esquerdo' : 'Direito', `${1.68 + (seed % 20) / 100}`.slice(0,4), `${65 + (seed % 25)}`, 'Caeté', 'MG', `(31) 9${String(8000 + seed).slice(0,4)}-${String(1000 + seed).slice(0,4)}`, 'ativo');
      athleteIds.push(r.lastInsertRowid);
      seed++;
    }
  });

  // athlete history (previous clubs)
  const insHist = db.prepare('INSERT INTO athlete_history (athlete_id,club_name,season,start_date,end_date,goals,titles,notes) VALUES (?,?,?,?,?,?,?,?)');
  athleteIds.slice(0, 20).forEach((aid, i) => {
    insHist.run(aid, ['Juventus FC','América MG','Cruzeiro Sub-20','Villa Nova'][i % 4], '2023', '2023-01-10', '2023-12-15', 3 + (i % 8), i % 3 === 0 ? 'Campeão Mineiro Sub-20' : '', 'Clube anterior');
  });

  // Championship
  const modFutebol = db.prepare("SELECT id FROM modalities WHERE name = 'Futebol de Campo'").get().id;
  const champ = db.prepare(`INSERT INTO championships (org_id,league_id,modality_id,name,season,category,gender,age_group,regulation,format,start_date,end_date,status,location,points_win,points_draw,points_loss,tiebreakers,double_round)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    org, org, modFutebol, 'Caetezão 2026', '2026', 'Profissional', 'Masculino', 'Adulto',
    'Regulamento oficial do Caetezão 2026. Pontos corridos em turno único, os 4 primeiros avançam às semifinais.',
    'pontos_corridos', '2026-08-01', '2026-12-20', 'em_andamento', 'Caeté - MG', 3, 1, 0,
    '["points","wins","goal_diff","goals_for"]', 0).lastInsertRowid;

  const insCC = db.prepare('INSERT INTO championship_clubs (championship_id,club_id,seed) VALUES (?,?,?)');
  clubIds.forEach((cid, i) => insCC.run(champ, cid, i + 1));

  // Generate fixtures
  engine.generateFixtures(champ, { format: 'pontos_corridos', startDate: '2026-08-01', intervalDays: 7 });

  // Simulate results for first 3 rounds
  const matches = db.prepare('SELECT * FROM matches WHERE championship_id = ? ORDER BY match_date, id LIMIT 12').all(champ);
  const upd = db.prepare('UPDATE matches SET home_score=?, away_score=?, status=?, referee_id=?, assistant1_id=?, assistant2_id=?, delegate_id=?, venue_id=?, published=1 WHERE id=?');
  matches.forEach((m, i) => {
    const hs = (i * 3 + 1) % 4, as = (i * 2) % 3;
    upd.run(hs, as, 'finalizada', refIds[0], refIds[1], refIds[2], refIds[4], [v1,v2,v3][i % 3], m.id);
  });

  // Events for finished matches
  const insEv = db.prepare('INSERT INTO match_events (match_id,club_id,athlete_id,related_athlete_id,type,minute,detail) VALUES (?,?,?,?,?,?,?)');
  const finMatches = db.prepare("SELECT * FROM matches WHERE championship_id = ? AND status='finalizada'").all(champ);
  finMatches.forEach(m => {
    const homeAth = db.prepare('SELECT id FROM athletes WHERE club_id = ? LIMIT 6').all(m.home_club_id).map(a => a.id);
    const awayAth = db.prepare('SELECT id FROM athletes WHERE club_id = ? LIMIT 6').all(m.away_club_id).map(a => a.id);
    for (let g = 0; g < (m.home_score || 0); g++) insEv.run(m.id, m.home_club_id, homeAth[g % homeAth.length], null, 'goal', 10 + g * 15, null);
    for (let g = 0; g < (m.away_score || 0); g++) insEv.run(m.id, m.away_club_id, awayAth[g % awayAth.length], null, 'goal', 20 + g * 12, null);
    insEv.run(m.id, m.home_club_id, homeAth[5], null, 'yellow', 35, null);
    insEv.run(m.id, m.away_club_id, awayAth[4], null, 'yellow', 55, null);
  });

  // News
  const insNews = db.prepare('INSERT INTO news (org_id,championship_id,title,subtitle,content,image,category,author,publish_date,status,views) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  insNews.run(org, champ, 'Caetezão 2026 começa com jogos equilibrados', 'Primeira rodada movimenta a cidade',
    'A abertura do Caetezão 2026 reuniu torcedores no Estádio Municipal de Caeté. As equipes mostraram equilíbrio e prometem uma disputa acirrada pelo título da temporada.',
    '', 'Campeonato', 'Assessoria Liga', '2026-08-02', 'publicada', 154);
  insNews.run(org, champ, 'Artilharia: disputa acirrada pela ponta', 'Veja quem são os goleadores da competição',
    'A corrida pela artilharia do Caetezão está quente. Diversos atletas já balançaram as redes nas primeiras rodadas.',
    '', 'Rodada', 'Assessoria Liga', '2026-08-10', 'publicada', 98);

  // Poll
  const insPoll = db.prepare('INSERT INTO polls (org_id,championship_id,title,type,options,round,start_date,end_date,status,public_result) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const pollId = insPoll.run(org, champ, 'Craque da Rodada 3', 'craque_rodada',
    JSON.stringify(['Gabriel Silva (Penharol)', 'Lucas Santos (União)', 'Matheus Oliveira (Sport Sabará)', 'Pedro Souza (Pedra Branca)']),
    '3', '2026-08-15', '2026-08-22', 'aberta', 1).lastInsertRowid;
  const insVote = db.prepare('INSERT INTO poll_votes (poll_id,option_index,voter) VALUES (?,?,?)');
  for (let i = 0; i < 42; i++) insVote.run(pollId, i % 4, 'torcedor' + i);

  // Sponsors
  const insSp = db.prepare('INSERT INTO sponsors (org_id,championship_id,company,website,contract_value,start_date,end_date,placements,status) VALUES (?,?,?,?,?,?,?,?,?)');
  insSp.run(org, champ, 'Supermercado Central', 'https://central.com', 15000, '2026-01-01', '2026-12-31', JSON.stringify(['site','artes','jogos']), 'ativo');
  insSp.run(org, champ, 'Auto Peças Caeté', 'https://autopecas.com', 8000, '2026-01-01', '2026-12-31', JSON.stringify(['site','noticias']), 'ativo');

  // Finance
  const insTx = db.prepare('INSERT INTO transactions (org_id,championship_id,type,category,description,amount,date,due_date,status,payment_method,cost_center) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  insTx.run(org, champ, 'receita', 'Inscrições', 'Inscrição de equipes - Caetezão 2026', 8000, '2026-07-15', '2026-07-15', 'pago', 'PIX', 'Competição');
  insTx.run(org, champ, 'receita', 'Patrocínios', 'Cota de patrocínio - Supermercado Central', 15000, '2026-08-01', '2026-08-10', 'pago', 'Transferência', 'Marketing');
  insTx.run(org, champ, 'despesa', 'Arbitragem', 'Taxa de arbitragem - Rodada 1', 1200, '2026-08-01', '2026-08-05', 'pago', 'PIX', 'Operacional');
  insTx.run(org, champ, 'despesa', 'Campo', 'Aluguel de campo - Rodada 1', 900, '2026-08-01', '2026-08-05', 'pendente', 'Boleto', 'Operacional');
  insTx.run(org, champ, 'despesa', 'Premiação', 'Troféus e medalhas', 2500, '2026-08-20', '2026-09-01', 'pendente', 'Boleto', 'Competição');

  // Transfers
  const insTr = db.prepare('INSERT INTO transfers (org_id,athlete_id,from_club_id,to_club_id,championship_id,value,admin_fee,total,transfer_date,reason,status,responsible,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  insTr.run(org, athleteIds[0], clubIds[0], clubIds[1], champ, 5000, 500, 5500, '2026-07-20', 'Transferência definitiva', 'aprovada', 'Renato Silva', 'pago');
  insTr.run(org, athleteIds[20], clubIds[1], clubIds[2], champ, 3000, 300, 3300, '2026-07-25', 'Empréstimo', 'solicitada', 'Renato Silva', 'pendente');

  // Photos
  const insPh = db.prepare('INSERT INTO photos (org_id,match_id,championship_id,club_id,album,url,caption,shared) VALUES (?,?,?,?,?,?,?,?)');
  insPh.run(org, matches[0]?.id || null, champ, clubIds[0], 'Rodada 1', 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800', 'Abertura do Caetezão 2026', 1);
  insPh.run(org, matches[0]?.id || null, champ, clubIds[1], 'Rodada 1', 'https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?w=800', 'Torcida presente', 1);
  insPh.run(org, matches[1]?.id || null, champ, clubIds[2], 'Rodada 2', 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=800', 'Disputa pela bola', 1);

  // Streams
  const insSt = db.prepare('INSERT INTO streams (org_id,match_id,title,url,platform,status,scheduled_at) VALUES (?,?,?,?,?,?,?)');
  insSt.run(org, matches[3]?.id || null, 'Penharol x União - Ao Vivo', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YouTube', 'agendada', '2026-08-22 15:00');

  console.log('[seed] core criado. Clubes:', clubIds.length, 'Atletas:', athleteIds.length, 'Campeonato:', champ);
}

(async () => {
  await seedGeo();
  seedCore();
  console.log('[seed] concluído.');
  process.exit(0);
})();
