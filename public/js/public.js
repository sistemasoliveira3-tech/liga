'use strict';
const API = (function () {
  const p = location.pathname.replace(/\/(index\.html|admin\.html|admin)?$/, '');
  return (p || '') + '/api/public';
})();
const state = { orgs: [], org: null, championships: [], champ: null, data: null };

/* ---------- utils ---------- */
const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));
const money = (v) => 'R$ ' + (Number(v)||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
const fdate = (d) => { if(!d) return '—'; const p=String(d).slice(0,10).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d; };
const wd = (d) => { if(!d) return ''; const dt=new Date(String(d).slice(0,10)+'T12:00:00'); return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][dt.getDay()]; };
async function api(path){ const r = await fetch(API+path); if(!r.ok) throw new Error('Falha ao carregar'); return r.json(); }
function toast(msg, type){ const t=document.createElement('div'); t.className='toast '+(type||''); t.textContent=msg; document.getElementById('toasts').appendChild(t); setTimeout(()=>t.remove(),3500); }
function initials(n){ return (n||'?').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase(); }
function logoImg(url, name, cls){ return url ? `<img class="${cls||'logo-sm'}" src="${esc(url)}" alt="">` : `<span class="${cls||'logo-sm'}" style="display:inline-flex;align-items:center;justify-content:center;background:var(--brand-050);color:var(--brand);font-weight:700;font-size:.7rem">${esc(initials(name))}</span>`; }

const NAV = [
  ['home','Início'],['jogos','Jogos'],['resultados','Resultados'],['classificacao','Classificação'],
  ['equipes','Equipes'],['atletas','Atletas'],['artilharia','Artilharia'],['cartoes','Cartões'],
  ['noticias','Notícias'],['fotos','Fotos'],['videos','Vídeos'],['enquetes','Enquetes'],
  ['transmissao','Transmissão'],['regulamento','Regulamento']
];

/* ---------- boot ---------- */
async function boot(){
  state.orgs = await api('/orgs');
  if(!state.orgs.length){ document.getElementById('app').innerHTML='<div class="pub-wrap"><p class="muted">Nenhuma liga publicada ainda.</p></div>'; return; }
  const savedOrg = localStorage.getItem('liga_org');
  state.org = state.orgs.find(o=>String(o.id)===savedOrg) || state.orgs[0];
  const home = await api('/org/'+state.org.slug);
  state.championships = home.championships;
  const savedChamp = localStorage.getItem('liga_champ');
  state.champ = state.championships.find(c=>String(c.id)===savedChamp) || state.championships[0];
  if(state.champ){ state.data = await api('/championship/'+state.champ.id); }
  renderHeader();
  window.addEventListener('hashchange', route);
  route();
}

function renderHeader(){
  const org = state.org;
  document.getElementById('brandName').textContent = org.name;
  const logo = document.getElementById('brandLogo');
  if(org.logo){ logo.src = org.logo; logo.style.display=''; } else { logo.style.display='none'; }
  document.title = org.name + ' — Portal do Torcedor';
  document.documentElement.style.setProperty('--brand', org.primary_color || '#0b6e4f');
  const nav = document.getElementById('pubNav');
  const champSel = state.championships.length>1 ? `<select id="champSel" style="width:auto;background:rgba(255,255,255,.15);color:#fff;border-color:rgba(255,255,255,.3)">${state.championships.map(c=>`<option value="${c.id}" ${state.champ&&c.id===state.champ.id?'selected':''}>${esc(c.name)} ${esc(c.season||'')}</option>`).join('')}</select>` : '';
  nav.innerHTML = NAV.map(([k,l])=>`<a href="#/${k}" data-k="${k}">${l}</a>`).join('') + champSel;
  const sel = document.getElementById('champSel');
  if(sel) sel.onchange = async ()=>{ state.champ = state.championships.find(c=>String(c.id)===sel.value); localStorage.setItem('liga_champ', sel.value); state.data = await api('/championship/'+state.champ.id); route(); };
}

/* ---------- router ---------- */
function route(){
  const hash = location.hash.replace(/^#\/?/,'') || 'home';
  const [page, arg] = hash.split('/');
  document.querySelectorAll('#pubNav a').forEach(a=>a.classList.toggle('active', a.dataset.k===page));
  const app = document.getElementById('app');
  window.scrollTo(0,0);
  const fn = { home:vHome, jogos:vJogos, resultados:vResultados, classificacao:vClass, equipes:vEquipes,
    atletas:vAtletas, artilharia:vArtilharia, cartoes:vCartoes, noticias:vNoticias, noticia:vNoticia,
    fotos:vFotos, videos:vVideos, enquetes:vEnquetes, transmissao:vTransmissao, regulamento:vRegulamento,
    clube:vClube, atleta:vAtleta, jogo:vJogo }[page] || vHome;
  Promise.resolve(fn(arg)).catch(e=>{ app.innerHTML=`<div class="pub-wrap"><p class="muted">Erro: ${esc(e.message)}</p></div>`; });
}

function hero(title, sub){
  return `<section class="pub-hero"><div class="inner"><h1>${esc(title)}</h1>${sub?`<p style="margin:0;opacity:.9">${esc(sub)}</p>`:''}</div></section>`;
}
function matchRow(m){
  const live = m.status==='em_andamento' ? '<span class="live-badge">AO VIVO</span>' : '';
  const score = (m.home_score!=null) ? `${m.home_score} x ${m.away_score}` : 'vs';
  return `<a class="match-card" href="#/jogo/${m.id}" style="color:inherit">
    <div class="team">${logoImg(m.home_logo,m.home_name,'logo-sm')}<span>${esc(m.home_name)}</span></div>
    <div class="meta">${live||fdate(m.match_date)}<br>${esc(m.match_time||'')}</div>
    <div class="score">${score}</div>
    <div class="meta">${esc(m.venue_name||'')}</div>
    <div class="team away"><span>${esc(m.away_name)}</span>${logoImg(m.away_logo,m.away_name,'logo-sm')}</div>
  </a>`;
}
function standingsTable(rows){
  if(!rows||!rows.length) return '<p class="muted">Sem dados de classificação.</p>';
  return `<div class="table-wrap"><table class="standings"><thead><tr>
    <th>#</th><th>Equipe</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>Forma</th></tr></thead><tbody>
    ${rows.map(r=>`<tr class="${r.position<=4?'qualify':''}">
      <td>${r.position}</td>
      <td><div class="row" style="gap:.4rem">${logoImg(r.logo,r.name,'logo-xs')}<a href="#/clube/${r.club_id}">${esc(r.short_name||r.name)}</a></div></td>
      <td><b>${r.points}</b></td><td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td>
      <td>${r.goals_for}</td><td>${r.goals_against}</td><td>${r.goal_diff>0?'+':''}${r.goal_diff}</td>
      <td><span class="pill-form">${(r.form||'').split('').map(f=>`<span class="f-${f}">${f}</span>`).join('')}</span></td>
    </tr>`).join('')}</tbody></table></div>`;
}

/* ---------- views ---------- */
async function vHome(){
  const d = state.data; if(!d) return empty();
  const all = d.rounds.flatMap(r=>r.matches);
  const upcoming = all.filter(m=>m.status==='agendada'||m.status==='confirmada').slice(0,5);
  const results = all.filter(m=>m.status==='finalizada').slice(-5).reverse();
  document.getElementById('app').innerHTML = hero(d.championship.name, `${d.championship.season||''} • ${d.championship.modality_name||''} • ${d.championship.category||''}`) + `
  <div class="pub-wrap"><div class="pub-grid">
    <div>
      <div class="section-title"><h2>Próximos Jogos</h2><a href="#/jogos">Ver todos</a></div>
      ${upcoming.length?upcoming.map(matchRow).join(''):'<p class="muted">Sem jogos agendados.</p>'}
      <div class="section-title"><h2>Últimos Resultados</h2><a href="#/resultados">Ver todos</a></div>
      ${results.length?results.map(matchRow).join(''):'<p class="muted">Sem resultados.</p>'}
      <div class="section-title"><h2>Notícias</h2><a href="#/noticias">Ver todas</a></div>
      <div class="pub-grid" style="grid-template-columns:1fr 1fr">
        ${d.news.slice(0,4).map(newsCard).join('')||'<p class="muted">Sem notícias.</p>'}
      </div>
    </div>
    <div>
      <div class="section-title"><h2>Classificação</h2><a href="#/classificacao">Completa</a></div>
      <div class="card pad0">${standingsTable(d.standings.slice(0,8))}</div>
      <div class="section-title"><h2>Artilharia</h2></div>
      <div class="card pad0"><div class="table-wrap"><table class="data"><tbody>
        ${d.scorers.slice(0,6).map((s,i)=>`<tr><td class="num">${i+1}º</td><td>${logoImg(s.photo,s.name,'avatar')}</td><td><a href="#/atleta/${s.athlete_id}">${esc(s.name)}</a></td><td class="num"><b>${s.goals}</b></td></tr>`).join('')||'<tr><td class="muted">Sem gols registrados.</td></tr>'}
      </tbody></table></div></div>
      ${d.polls.filter(p=>p.status==='aberta').slice(0,1).map(pollCard).join('')}
    </div>
  </div>
  ${d.sponsors.length?`<div class="section-title"><h2>Patrocinadores</h2></div><div class="row" style="gap:1rem">${d.sponsors.map(s=>`<div class="card" style="text-align:center;min-width:150px">${s.logo?`<img src="${esc(s.logo)}" style="height:44px;object-fit:contain;margin:0 auto">`:''}<div style="font-weight:700;margin-top:.3rem">${esc(s.company)}</div></div>`).join('')}</div>`:''}
  </div>`;
}
function empty(){ return `<div class="pub-wrap"><p class="muted">Nenhum campeonato disponível.</p></div>`; }

async function vJogos(){
  const d=state.data; if(!d) return empty();
  document.getElementById('app').innerHTML = hero('Jogos','Agenda de partidas') + `<div class="pub-wrap">
    ${d.rounds.map(r=>`<div class="section-title"><h2>${esc(r.name)}</h2><span class="muted small">${fdate(r.start_date)}</span></div>${r.matches.map(matchRow).join('')}`).join('')}
  </div>`;
}
async function vResultados(){
  const d=state.data; if(!d) return empty();
  const fin = d.rounds.flatMap(r=>r.matches).filter(m=>m.status==='finalizada').reverse();
  document.getElementById('app').innerHTML = hero('Resultados','Partidas encerradas') + `<div class="pub-wrap">${fin.length?fin.map(matchRow).join(''):'<p class="muted">Sem resultados.</p>'}</div>`;
}
async function vClass(){
  const d=state.data; if(!d) return empty();
  document.getElementById('app').innerHTML = hero('Classificação', d.championship.name) + `<div class="pub-wrap">
    <div class="card pad0">${standingsTable(d.standings)}</div>
    <p class="muted small" style="margin-top:.6rem">Critérios: ${esc(d.championship.tiebreakers)}</p>
  </div>`;
}
async function vEquipes(){
  const d=state.data; if(!d) return empty();
  document.getElementById('app').innerHTML = hero('Equipes', d.clubs.length+' clubes participantes') + `<div class="pub-wrap">
    <div class="gallery" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
      ${d.clubs.map(c=>`<a class="card" href="#/clube/${c.id}" style="text-align:center;color:inherit">
        <div style="display:flex;justify-content:center">${logoImg(c.logo,c.name,'logo-sm')}</div>
        <div style="font-weight:700;margin-top:.5rem">${esc(c.name)}</div>
        <div class="muted small">${esc(c.city||'')} ${esc(c.state||'')}</div>
        ${c.group_name?`<span class="badge brand">${esc(c.group_name)}</span>`:''}
      </a>`).join('')}
    </div></div>`;
}
async function vAtletas(){
  const d=state.data; if(!d) return empty();
  document.getElementById('app').innerHTML = hero('Atletas','Jogadores do campeonato') + `<div class="pub-wrap">
    <div class="toolbar"><input id="athSearch" placeholder="Buscar atleta..." oninput="filterAth()"></div>
    <div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Atleta</th><th>Clube</th><th>Posição</th><th class="num">Nº</th><th class="num">Gols</th></tr></thead>
    <tbody id="athBody">${d.clubs.flatMap(c=>[]).join('')}</tbody></table></div></div>
  </div>`;
  // load athletes for each club lazily
  const clubs = d.clubs; const rows=[];
  for(const c of clubs){ try{ const cl=await api('/club/'+c.id); cl.athletes.forEach(a=>rows.push({...a,club_name:c.name})); }catch(e){} }
  window._athRows = rows;
  document.getElementById('athBody').innerHTML = rows.map(athRow).join('');
}
function athRow(a){ return `<tr data-name="${esc((a.name+' '+a.club_name).toLowerCase())}"><td><div class="row" style="gap:.5rem">${logoImg(a.photo,a.name,'avatar')}<a href="#/atleta/${a.id}">${esc(a.name)}</a></div></td><td>${esc(a.club_name)}</td><td>${esc(a.position||'')}</td><td class="num">${esc(a.number||'')}</td><td class="num">—</td></tr>`; }
window.filterAth = function(){ const q=document.getElementById('athSearch').value.toLowerCase(); document.querySelectorAll('#athBody tr').forEach(tr=>tr.style.display=tr.dataset.name.includes(q)?'':'none'); };

async function vArtilharia(){
  const d=state.data; if(!d) return empty();
  document.getElementById('app').innerHTML = hero('Artilharia','Goleadores do campeonato') + `<div class="pub-wrap"><div class="card pad0">
    <div class="table-wrap"><table class="data"><thead><tr><th class="num">#</th><th>Atleta</th><th class="num">Gols</th><th class="num">Assist.</th></tr></thead><tbody>
    ${d.scorers.map((s,i)=>`<tr><td class="num"><b>${i+1}</b></td><td><div class="row" style="gap:.5rem">${logoImg(s.photo,s.name,'avatar')}<a href="#/atleta/${s.athlete_id}">${esc(s.name)}</a></div></td><td class="num"><b>${s.goals}</b></td><td class="num">${s.assists}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">Sem gols.</td></tr>'}
    </tbody></table></div></div></div>`;
}
async function vCartoes(){
  const d=state.data; if(!d) return empty();
  document.getElementById('app').innerHTML = hero('Cartões','Disciplina') + `<div class="pub-wrap"><div class="card pad0">
    <div class="table-wrap"><table class="data"><thead><tr><th>Atleta</th><th class="num">🟨</th><th class="num">🟥</th></tr></thead><tbody>
    ${d.cards.map(s=>`<tr><td><a href="#/atleta/${s.athlete_id}">${esc(s.name)}</a></td><td class="num">${s.yellow}</td><td class="num">${s.red}</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Sem cartões.</td></tr>'}
    </tbody></table></div></div></div>`;
}
function newsCard(n){ return `<a class="news-card" href="#/noticia/${n.id}" style="color:inherit">${n.image?`<img src="${esc(n.image)}" alt="">`:''}<div class="body"><span class="badge brand">${esc(n.category||'Notícia')}</span><h4>${esc(n.title)}</h4><div class="muted small">${fdate(n.publish_date)}</div></div></a>`; }
async function vNoticias(){
  const news = await api('/news?org_id='+state.org.id);
  document.getElementById('app').innerHTML = hero('Notícias','Últimas da liga') + `<div class="pub-wrap"><div class="pub-grid" style="grid-template-columns:1fr 1fr 1fr">${news.map(newsCard).join('')||'<p class="muted">Sem notícias.</p>'}</div></div>`;
}
async function vNoticia(id){
  const n = await api('/news/'+id);
  document.getElementById('app').innerHTML = hero(n.title, n.subtitle||'') + `<div class="pub-wrap" style="max-width:800px">
    <div class="card">${n.image?`<img src="${esc(n.image)}" style="border-radius:10px;margin-bottom:1rem">`:''}
    <div class="muted small">${esc(n.author||'')} • ${fdate(n.publish_date)} • ${n.views} visualizações</div>
    <div style="margin-top:1rem;white-space:pre-wrap">${esc(n.content)}</div></div>
    <p style="margin-top:1rem"><a href="#/noticias">← Voltar</a></p></div>`;
}
async function vFotos(){
  const photos = await api('/photos?championship_id='+(state.champ?state.champ.id:''));
  document.getElementById('app').innerHTML = hero('Galeria de Fotos','Momentos do campeonato') + `<div class="pub-wrap"><div class="gallery">${photos.map(p=>`<figure style="margin:0"><img src="${esc(p.url)}" title="${esc(p.caption||'')}"><figcaption class="muted small">${esc(p.caption||'')}</figcaption></figure>`).join('')||'<p class="muted">Sem fotos.</p>'}</div></div>`;
}
async function vVideos(){
  const vids = await api('/videos?championship_id='+(state.champ?state.champ.id:''));
  document.getElementById('app').innerHTML = hero('Vídeos','Melhores momentos e entrevistas') + `<div class="pub-wrap"><div class="pub-grid" style="grid-template-columns:1fr 1fr 1fr">${vids.map(v=>`<div class="news-card"><div class="body"><span class="badge gray">${esc(v.platform||'')}</span><h4>${esc(v.title)}</h4><a class="btn sm" href="${esc(v.url)}" target="_blank">Assistir</a></div></div>`).join('')||'<p class="muted">Sem vídeos.</p>'}</div></div>`;
}
function pollCard(p){
  const closed = p.status!=='aberta';
  return `<div class="card" style="margin-top:1rem" data-poll="${p.id}">
    <div class="row"><h3 style="margin:0;font-size:1rem">${esc(p.title)}</h3><span class="badge ${p.status==='aberta'?'ok':'gray'}">${esc(p.status)}</span></div>
    <div style="margin-top:.6rem">${p.results.map(o=>`<div class="poll-opt" ${closed?'':'onclick="votePoll('+p.id+','+o.index+')"'}>
      <b>${o.percent}%</b><span style="flex:1">${esc(o.label)}</span><span class="muted small">${o.votes} votos</span></div>`).join('')}</div>
    <div class="muted small">${p.total_votes} votos no total${closed?' • Enquete encerrada':''}</div></div>`;
}
async function vEnquetes(){
  const polls = await api('/polls?championship_id='+(state.champ?state.champ.id:''));
  document.getElementById('app').innerHTML = hero('Enquetes','Participe das votações') + `<div class="pub-wrap" style="max-width:760px">${polls.map(pollCard).join('')||'<p class="muted">Sem enquetes.</p>'}</div>`;
}
window.votePoll = async function(id, idx){
  try{ const r = await fetch(API+'/polls/'+id+'/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({option_index:idx})});
    const data = await r.json(); if(!r.ok) throw new Error(data.error);
    toast('Voto registrado!','ok'); vEnquetes();
  }catch(e){ toast(e.message,'err'); }
};
async function vTransmissao(){
  const streams = await api('/streams?org_id='+state.org.id);
  document.getElementById('app').innerHTML = hero('Transmissões','Acompanhe ao vivo') + `<div class="pub-wrap">${streams.map(s=>`<div class="card" style="margin-bottom:.8rem"><div class="row"><span class="badge ${s.status==='ao_vivo'?'danger':'info'}">${esc(s.platform)}</span><b>${esc(s.title)}</b><span class="spacer"></span><a class="btn accent" href="${esc(s.url)}" target="_blank">🔴 Assistir</a></div></div>`).join('')||'<p class="muted">Sem transmissões agendadas.</p>'}</div>`;
}
async function vRegulamento(){
  const d=state.data; if(!d) return empty();
  document.getElementById('app').innerHTML = hero('Regulamento', d.championship.name) + `<div class="pub-wrap" style="max-width:800px"><div class="card" style="white-space:pre-wrap">${esc(d.championship.regulation||'Regulamento não informado.')}</div></div>`;
}
async function vClube(id){
  const c = await api('/club/'+id);
  document.getElementById('app').innerHTML = hero(c.name, `${c.city||''} ${c.state||''}`) + `<div class="pub-wrap"><div class="pub-grid">
    <div><div class="section-title"><h2>Elenco</h2></div><div class="card pad0"><div class="table-wrap"><table class="data"><tbody>
      ${c.athletes.map(a=>`<tr><td>${logoImg(a.photo,a.name,'avatar')}</td><td><a href="#/atleta/${a.id}">${esc(a.name)}</a></td><td>${esc(a.position||'')}</td><td class="num">${esc(a.number||'')}</td></tr>`).join('')||'<tr><td class="muted">Sem atletas.</td></tr>'}
    </tbody></table></div></div></div>
    <div><div class="section-title"><h2>Jogos</h2></div>${c.matches.map(m=>`<a class="match-card" href="#/jogo/${m.id}" style="color:inherit"><div class="team">${esc(m.home_name)}</div><div class="score">${m.home_score!=null?m.home_score+' x '+m.away_score:'vs'}</div><div class="team away">${esc(m.away_name)}</div></a>`).join('')||'<p class="muted">Sem jogos.</p>'}</div>
  </div></div>`;
}
async function vAtleta(id){
  const a = await api('/athlete/'+id);
  document.getElementById('app').innerHTML = hero(a.name, a.nickname||'') + `<div class="pub-wrap"><div class="pub-grid">
    <div><div class="card"><div class="row" style="gap:1rem">${logoImg(a.photo,a.name,'logo-sm')}<div><h2 style="margin:0">${esc(a.name)}</h2><div class="muted">${esc(a.club_name||'')} • ${esc(a.position||'')} ${a.number?'#'+esc(a.number):''}</div></div></div>
      <div class="stats" style="margin-top:1rem">
        <div class="stat"><div class="k">Jogos</div><div class="v">${a.totals.goals+a.totals.assists}</div></div>
        <div class="stat"><div class="k">Gols</div><div class="v">${a.totals.goals}</div></div>
        <div class="stat"><div class="k">Assist.</div><div class="v">${a.totals.assists}</div></div>
        <div class="stat"><div class="k">Títulos</div><div class="v">${a.totals.titles}</div></div>
      </div></div>
      <div class="section-title"><h2>Gols por Temporada</h2></div><div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Temporada</th><th>Campeonato</th><th class="num">Gols</th><th class="num">Assist.</th></tr></thead><tbody>
        ${a.stats.map(s=>`<tr><td>${esc(s.season||'')}</td><td>${esc(s.champ_name)}</td><td class="num">${s.goals}</td><td class="num">${s.assists}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">Sem dados.</td></tr>'}
      </tbody></table></div></div></div>
    <div><div class="section-title"><h2>Histórico</h2></div><div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Clube</th><th>Temporada</th><th class="num">Gols</th></tr></thead><tbody>
      ${a.history.map(h=>`<tr><td>${esc(h.club_name||'')}${h.titles?`<br><span class="badge ok">${esc(h.titles)}</span>`:''}</td><td>${esc(h.season||'')}</td><td class="num">${h.goals||0}</td></tr>`).join('')||'<tr><td colspan="3" class="muted">Sem histórico.</td></tr>'}
    </tbody></table></div></div>
    <div class="section-title"><h2>Transferências</h2></div><div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Data</th><th>De → Para</th><th>Status</th></tr></thead><tbody>
      ${a.transfers.map(t=>`<tr><td>${fdate(t.transfer_date)}</td><td>${esc(t.from_club||'')} → ${esc(t.to_club||'')}</td><td><span class="badge ${t.status==='aprovada'?'ok':'warn'}">${esc(t.status)}</span></td></tr>`).join('')||'<tr><td colspan="3" class="muted">Sem transferências.</td></tr>'}
    </tbody></table></div></div></div>
  </div></div>`;
}
async function vJogo(id){
  const m = await api('/match/'+id);
  const evIcon = {goal:'⚽',penalty_goal:'⚽',own_goal:'⚽',assist:'🅰',yellow:'🟨',red:'🟥',substitution:'🔄',injury:'🚑',penalty_miss:'❌'};
  const evLabel = {goal:'Gol',penalty_goal:'Gol (pênalti)',own_goal:'Gol contra',assist:'Assistência',yellow:'Cartão amarelo',red:'Cartão vermelho',substitution:'Substituição',injury:'Lesão',penalty_miss:'Pênalti perdido'};
  const live = m.status==='em_andamento';
  document.getElementById('app').innerHTML = hero(m.champ_name, `${fdate(m.match_date)} • ${esc(m.match_time||'')} • ${esc(m.venue_name||'')}`) + `<div class="pub-wrap">
    <div class="card" style="text-align:center">
      ${live?'<span class="live-badge">AO VIVO '+ (m.live_minute||0) +"'"+'</span>':''}
      <div class="row" style="justify-content:center;gap:2rem;margin-top:.6rem">
        <div style="flex:1;text-align:right"><b style="font-size:1.1rem">${esc(m.home_name)}</b></div>
        <div style="font-size:2.2rem;font-weight:800;color:var(--brand)">${m.home_score!=null?m.home_score:'-'} <span style="font-size:1.2rem">x</span> ${m.away_score!=null?m.away_score:'-'}</div>
        <div style="flex:1;text-align:left"><b style="font-size:1.1rem">${esc(m.away_name)}</b></div>
      </div>
      ${m.penalties_home!=null?`<div class="muted small">Pênaltis: ${m.penalties_home} x ${m.penalties_away}</div>`:''}
      <div class="row" style="justify-content:center;margin-top:.8rem">
        ${m.streams.map(s=>`<a class="btn accent" href="${esc(s.url)}" target="_blank">🔴 Assistir ao Vivo</a>`).join('')}
        ${m.published?`<a class="btn ghost" href="/api/public/match/${m.id}/pdf" target="_blank">📄 Súmula (PDF)</a>`:''}
      </div>
    </div>
    <div class="pub-grid" style="margin-top:1rem">
      <div><div class="section-title"><h2>Linha do Tempo</h2></div><div class="card"><ul class="timeline">
        ${m.events.map(e=>`<li><span class="min">${e.minute}'</span><span>${evIcon[e.type]||'•'}</span><span><b>${esc(e.athlete_name||'')}</b> <span class="muted small">${evLabel[e.type]||e.type}${e.type==='substitution'&&e.related_name?' (entra '+esc(e.related_name)+')':''}</span></span></li>`).join('')||'<li class="muted">Sem eventos registrados.</li>'}
      </ul></div>
      <div class="section-title"><h2>Fotos</h2></div><div class="gallery">${m.photos.map(p=>`<img src="${esc(p.url)}" title="${esc(p.caption||'')}">`).join('')||'<p class="muted small">Sem fotos.</p>'}</div></div>
      <div><div class="section-title"><h2>Escalações</h2></div>
        <div class="card" style="margin-bottom:.8rem"><b>${esc(m.home_name)}</b><div class="muted small">${m.home_lineup.map(l=>esc(l.name||'')).join(', ')||'Não divulgada'}</div></div>
        <div class="card"><b>${esc(m.away_name)}</b><div class="muted small">${m.away_lineup.map(l=>esc(l.name||'')).join(', ')||'Não divulgada'}</div></div>
        <div class="section-title"><h2>Arbitragem</h2></div><div class="card small">Árbitro: ${esc(m.referee_name||'—')}<br>Local: ${esc(m.venue_name||'—')} ${esc(m.venue_city||'')}</div>
      </div>
    </div>
    <p style="margin-top:1rem"><a href="#/home">← Voltar</a></p></div>`;
}

boot().catch(e=>{ document.getElementById('app').innerHTML=`<div class="pub-wrap"><p class="muted">Erro ao carregar: ${esc(e.message)}</p></div>`; });
