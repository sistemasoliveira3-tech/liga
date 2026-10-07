'use strict';
/* ============================================================
   Liga — Painel Administrativo: views complexas
   ============================================================ */
(function () {
  const App = window.App;
  const { esc, fmtMoney, fmtDate, fmtDateTime, qs, optLabel, img, avatar, api, can, formModal, confirm, toast, pageHead, state, genericCRUD } = App;

  const STATUS_BADGE = {
    agendada: 'info', em_andamento: 'warn', finalizada: 'ok', adiada: 'gray', cancelada: 'danger',
    ativo: 'ok', inativo: 'gray', pendente: 'warn', suspenso: 'danger', irregular: 'danger',
    aprovada: 'ok', reprovada: 'danger', publicada: 'ok', rascunho: 'gray', encerrada: 'gray', aberta: 'ok',
    pago: 'ok', paga: 'ok', atrasado: 'danger', atrasada: 'danger', receita: 'ok', despesa: 'danger'
  };
  const badge = (v) => '<span class="badge ' + (STATUS_BADGE[v] || 'gray') + '">' + esc((v || '').replace(/_/g, ' ')) + '</span>';

  // Render a semicolon-delimited CSV string (as produced by the report endpoints)
  // as an HTML table so the Reports screen can preview data on screen.
  function renderCSV(csv) {
    const lines = String(csv || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length);
    if (!lines.length) return '<p class="muted">Sem dados para exibir.</p>';
    const parse = (line) => line.split(';').map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const head = parse(lines[0]);
    const body = lines.slice(1).map(parse);
    return '<div class="table-wrap"><table class="data"><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      (body.length ? body.map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('')
        : '<tr><td colspan="' + head.length + '" class="muted center">Sem registros</td></tr>') +
      '</tbody></table></div>';
  }

  function tabbed(container, tabs, active) {
    const bar = '<div class="tabs">' + tabs.map((t) => '<button data-tab="' + t.key + '"' + (t.key === active ? ' class="active"' : '') + '>' + esc(t.label) + '</button>').join('') + '</div>';
    const pane = '<div id="tabpane"></div>';
    container.insertAdjacentHTML('beforeend', bar + pane);
    const show = (key) => {
      container.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
      const t = tabs.find((x) => x.key === key);
      const p = container.querySelector('#tabpane');
      p.innerHTML = '<p class="muted">Carregando…</p>';
      Promise.resolve(t.render(p)).catch((e) => { p.innerHTML = '<p class="muted">Erro: ' + esc(e.message) + '</p>'; });
    };
    container.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => show(b.dataset.tab));
    show(active);
    return show;
  }

  /* ==================== ATLETAS ==================== */
  App.registerView('athletes', async function (content, param) {
    if (param) return athleteDetail(content, param);

    content.innerHTML = pageHead('Atletas',
      (can('atletas', 'include') ? '<button class="btn ghost" id="impBtn">⬆ Importar CSV/TXT</button><button class="btn" id="newBtn">+ Novo Atleta</button>' : '')) +
      '<div class="toolbar"><input id="q" placeholder="Buscar nome, apelido ou CPF…" style="min-width:240px">' +
      '<select id="f_club"><option value="">Todos os clubes</option>' + state.refs.clubs.map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select>' +
      '<select id="f_status"><option value="">Situação</option>' + ['ativo', 'pendente', 'suspenso', 'irregular', 'inativo'].map((s) => '<option value="' + s + '">' + s + '</option>').join('') + '</select>' +
      '<span class="spacer"></span><span class="chip" id="cnt"></span></div>' +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Foto</th><th>Atleta</th><th>Clube</th><th>Posição</th><th class="num">Nº</th><th>Cidade/UF</th><th>Situação</th><th class="num">Ações</th></tr></thead><tbody id="rows"><tr><td colspan="8" class="muted center">Carregando…</td></tr></tbody></table></div></div>';

    const rows = document.getElementById('rows');
    async function load() {
      const params = { q: document.getElementById('q').value, club_id: document.getElementById('f_club').value, status: document.getElementById('f_status').value, limit: 1000 };
      const r = await api('/athletes?' + qs(params));
      document.getElementById('cnt').textContent = r.total + ' atleta(s)';
      if (!r.data.length) { rows.innerHTML = '<tr><td colspan="8" class="muted center">Nenhum atleta</td></tr>'; return; }
      rows.innerHTML = r.data.map((a) => '<tr>' +
        '<td>' + avatar(a.photo, a.name) + '</td>' +
        '<td><b>' + esc(a.name) + '</b>' + (a.nickname ? '<div class="small muted">' + esc(a.nickname) + '</div>' : '') + '</td>' +
        '<td>' + (a.club_logo ? img(a.club_logo, 'logo-xs') + ' ' : '') + esc(a.club_name || '—') + '</td>' +
        '<td>' + esc(a.position || '—') + '</td><td class="num">' + esc(a.number || '—') + '</td>' +
        '<td>' + esc((a.city || '') + (a.state ? '/' + a.state : '')) + '</td>' +
        '<td>' + badge(a.status) + '</td>' +
        '<td class="num"><div class="row" style="justify-content:center;flex-wrap:nowrap"><button class="btn ghost sm" data-view="' + a.id + '">Ver</button>' +
        (can('atletas', 'edit') ? '<button class="btn ghost sm" data-edit="' + a.id + '">✎</button>' : '') +
        (can('atletas', 'delete') ? '<button class="btn ghost sm" data-del="' + a.id + '">🗑</button>' : '') + '</div></td></tr>').join('');
      rows.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => App.go('#/athletes/' + b.dataset.view));
      rows.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openForm(r.data.find((x) => String(x.id) === b.dataset.edit)));
      rows.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirm('Excluir este atleta?')) { await api('/athletes/' + b.dataset.del, { method: 'DELETE' }); toast('Excluído', 'ok'); load(); } });
    }
    const ATH_FIELDS = [
      { key: 'name', label: 'Nome completo', required: true }, { key: 'nickname', label: 'Apelido / Nome esportivo' },
      { key: 'club_id', label: 'Clube (obrigatório)', type: 'select', required: true, options: App.opt.clubs },
      { key: 'position', label: 'Posição' }, { key: 'number', label: 'Número da camisa', type: 'number' },
      { key: 'birth_date', label: 'Data de nascimento', type: 'date' }, { key: 'dominant_foot', label: 'Pé dominante', type: 'select', options: [{ value: 'Direito', label: 'Direito' }, { value: 'Esquerdo', label: 'Esquerdo' }, { value: 'Ambos', label: 'Ambos' }] },
      { key: 'cpf', label: 'CPF' }, { key: 'document', label: 'RG / Documento' },
      { key: 'height', label: 'Altura (m)' }, { key: 'weight', label: 'Peso (kg)' },
      { key: 'state', label: 'Estado (UF)', type: 'state' }, { key: 'city', label: 'Cidade', type: 'city' },
      { key: 'phone', label: 'Telefone' }, { key: 'email', label: 'E-mail', type: 'email' },
      { key: 'status', label: 'Situação', type: 'select', options: ['ativo', 'pendente', 'suspenso', 'irregular', 'inativo'].map((s) => ({ value: s, label: s })) },
      { key: 'notes', label: 'Observações', type: 'textarea', col: 2 }
    ];
    async function openForm(row) {
      const r = await formModal({ title: (row ? 'Editar Atleta' : 'Novo Atleta'), fields: ATH_FIELDS, values: row || { status: 'ativo' }, wide: true });
      if (!r) return;
      try {
        const saved = row ? await api('/athletes/' + row.id, { method: 'PUT', body: r.values }) : await api('/athletes', { method: 'POST', body: r.values });
        if (r.files.photo) { const fd = new FormData(); fd.append('photo', r.files.photo); await api('/athletes/' + saved.id + '/photo', { method: 'POST', body: fd }); }
        toast('Atleta salvo', 'ok'); App.reloadRefs(); load();
      } catch (e) { toast(e.message, 'err'); }
    }
    if (document.getElementById('newBtn')) document.getElementById('newBtn').onclick = () => openForm(null);
    document.getElementById('q').oninput = App.debounce(load, 350);
    document.getElementById('f_club').onchange = load;
    document.getElementById('f_status').onchange = load;
    if (document.getElementById('impBtn')) document.getElementById('impBtn').onclick = () => importModal(load);
    load();
  });

  function importModal(reload) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal"><div class="modal-head"><h3>Importar atletas (CSV/TXT)</h3><button class="x-btn" data-x>&times;</button></div>' +
      '<div class="modal-body"><p class="small muted">Formato com cabeçalho: <b>nome;clube;posicao;numero;cpf;nascimento</b> (delimitador ; ou , ou tab). O clube deve existir para vincular o atleta.</p>' +
      (state.user && state.user.is_super ? '<div class="field"><label>Organiza\u00e7\u00e3o / Liga</label><select id="impOrg"><option value="">\u2014 Padr\u00e3o \u2014</option>' + (state.refs.orgs || []).map((o) => '<option value="' + o.id + '">' + esc(o.name) + '</option>').join('') + '</select></div>' : '') +
      '<div class="field"><label>Arquivo CSV/TXT</label><input type="file" id="impFile" accept=".csv,.txt"></div>' +
      '<div class="field"><label>ou cole o conteúdo</label><textarea id="impText" placeholder="nome;clube;posicao;numero;cpf;nascimento"></textarea></div>' +
      '<div id="impResult" class="small"></div></div>' +
      '<div class="modal-foot"><button class="btn ghost" data-x>Cancelar</button><button class="btn" id="impGo">Importar</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => overlay.remove());
    overlay.querySelector('#impGo').onclick = async () => {
      const file = overlay.querySelector('#impFile').files[0];
      const text = overlay.querySelector('#impText').value;
      const fd = new FormData();
      const orgSel = overlay.querySelector('#impOrg');
      if (orgSel && orgSel.value) fd.append('org_id', orgSel.value);
      if (file) fd.append('file', file); else if (text) fd.append('text', text); else return toast('Envie um arquivo ou texto', 'err');
      try {
        const r = await api('/athletes/import', { method: 'POST', body: fd });
        overlay.querySelector('#impResult').innerHTML = '<div class="badge ok">' + esc(r.message) + '</div>' + (r.errors && r.errors.length ? '<ul style="margin:.5rem 0 0 1rem">' + r.errors.slice(0, 12).map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '');
        toast(r.message, 'ok'); reload();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  async function athleteDetail(content, id) {
    const a = await api('/athletes/' + id);
    const tabs = [
      { key: 'dados', label: 'Dados', render: (p) => { p.innerHTML = '<div class="card"><table class="data"><tbody>' + [['Nome', a.name], ['Apelido', a.nickname], ['Clube', a.club_name], ['Posição', a.position], ['Número', a.number], ['Nascimento', fmtDate(a.birth_date)], ['Pé dominante', a.dominant_foot], ['CPF', a.cpf], ['RG', a.document], ['Altura', a.height], ['Peso', a.weight], ['Cidade/UF', (a.city || '') + (a.state ? '/' + a.state : '')], ['Telefone', a.phone], ['E-mail', a.email], ['Situação', a.status], ['Observações', a.notes]].map(([k, v]) => '<tr><td class="muted" style="width:200px">' + esc(k) + '</td><td>' + esc(v || '—') + '</td></tr>').join('') + '</tbody></table></div>'; } },
      { key: 'hist', label: 'Histórico do Atleta', render: (p) => renderHistory(p, a) },
      { key: 'transf', label: 'Transferências', render: (p) => { p.innerHTML = '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Data</th><th>De</th><th>Para</th><th class="num">Valor</th><th>Status</th></tr></thead><tbody>' + (a.transfers.length ? a.transfers.map((t) => '<tr><td>' + fmtDate(t.transfer_date) + '</td><td>' + esc(t.from_club || '—') + '</td><td>' + esc(t.to_club || '—') + '</td><td class="num">' + fmtMoney(t.total) + '</td><td>' + badge(t.status) + '</td></tr>').join('') : '<tr><td colspan="5" class="muted center">Sem transferências</td></tr>') + '</tbody></table></div></div>'; } },
      { key: 'docs', label: 'Documentos', render: (p) => renderDocs(p, a) },
      { key: 'stats', label: 'Estatísticas', render: (p) => renderAthStats(p, a) }
    ];
    content.innerHTML = pageHead('', '<button class="btn ghost" onclick="App.go(\'#/athletes\')">← Voltar</button>' +
      (can('atletas', 'edit') ? '<button class="btn" id="editBtn">Editar</button>' : '')) +
      '<div class="card" style="display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap">' + avatar(a.photo, a.name) +
      '<div><h2 style="margin:0">' + esc(a.name) + '</h2><div class="muted">' + esc(a.nickname || '') + ' · ' + esc(a.position || '') + ' · ' + esc(a.club_name || 'Sem clube') + '</div></div>' +
      '<div class="spacer"></div><div class="row"><span class="chip">⚽ ' + a.totals.goals + ' gols</span><span class="chip">🅰 ' + a.totals.assists + ' assists</span><span class="chip">🟨 ' + a.totals.yellow + '</span><span class="chip">🟥 ' + a.totals.red + '</span><span class="chip">🏆 ' + a.totals.titles + ' títulos</span></div></div>';
    if (document.getElementById('editBtn')) document.getElementById('editBtn').onclick = async () => {
      const r = await formModal({ title: 'Editar Atleta', wide: true, values: a, fields: [
        { key: 'name', label: 'Nome', required: true }, { key: 'nickname', label: 'Apelido' },
        { key: 'club_id', label: 'Clube', type: 'select', options: App.opt.clubs },
        { key: 'position', label: 'Posição' }, { key: 'number', label: 'Número', type: 'number' }, { key: 'status', label: 'Situação', type: 'select', options: ['ativo', 'pendente', 'suspenso', 'irregular', 'inativo'].map((s) => ({ value: s, label: s })) },
        { key: 'state', label: 'UF', type: 'state' }, { key: 'city', label: 'Cidade', type: 'city' }, { key: 'phone', label: 'Telefone' }, { key: 'email', label: 'E-mail' }
      ] });
      if (!r) return; try { await api('/athletes/' + a.id, { method: 'PUT', body: r.values }); toast('Salvo', 'ok'); App.route(); } catch (e) { toast(e.message, 'err'); }
    };
    tabbed(content, tabs, 'dados');
  }

  function renderHistory(p, a) {
    p.innerHTML = '<div class="section-title"><h2>Histórico do Atleta</h2>' + (can('atletas', 'edit') ? '<button class="btn sm" id="addH">+ Adicionar</button>' : '') + '</div>' +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Clube</th><th>Temporada</th><th>Início</th><th>Fim</th><th class="num">Gols</th><th>Títulos</th><th class="num">Ações</th></tr></thead><tbody>' +
      (a.history.length ? a.history.map((h) => '<tr><td><b>' + esc(h.club_name || '—') + '</b></td><td>' + esc(h.season || '') + '</td><td>' + fmtDate(h.start_date) + '</td><td>' + fmtDate(h.end_date) + '</td><td class="num">' + (h.goals || 0) + '</td><td>' + esc(h.titles || '—') + '</td><td class="num">' + (can('atletas', 'edit') ? '<button class="btn ghost sm" data-del="' + h.id + '">🗑</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="7" class="muted center">Sem histórico</td></tr>') + '</tbody></table></div></div>';
    if (document.getElementById('addH')) document.getElementById('addH').onclick = async () => {
      const r = await formModal({ title: 'Adicionar ao histórico', fields: [
        { key: 'club_name', label: 'Clube' }, { key: 'season', label: 'Temporada (ex: 2025)' },
        { key: 'start_date', label: 'Início', type: 'date' }, { key: 'end_date', label: 'Fim', type: 'date' },
        { key: 'goals', label: 'Gols', type: 'number' }, { key: 'titles', label: 'Títulos' }, { key: 'notes', label: 'Obs', type: 'textarea', col: 2 }
      ] });
      if (!r) return; try { await api('/athletes/' + a.id + '/history', { method: 'POST', body: r.values }); toast('Adicionado', 'ok'); App.route(); } catch (e) { toast(e.message, 'err'); }
    };
    p.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirm('Remover?')) { await api('/athletes/' + a.id + '/history/' + b.dataset.del, { method: 'DELETE' }); App.route(); } });
  }

  function renderDocs(p, a) {
    p.innerHTML = '<div class="section-title"><h2>Documentos</h2>' + (can('atletas', 'edit') ? '<button class="btn sm" id="addD">+ Enviar documento</button>' : '') + '</div>' +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Tipo</th><th>Arquivo</th><th>Validade</th><th>Status</th></tr></thead><tbody>' +
      (a.documents.length ? a.documents.map((d) => '<tr><td>' + esc(d.type) + '</td><td>' + (d.file ? '<a href="' + esc(d.file) + '" target="_blank">Ver arquivo</a>' : '—') + '</td><td>' + fmtDate(d.valid_until) + '</td><td>' + badge(d.status) + '</td></tr>').join('') : '<tr><td colspan="4" class="muted center">Sem documentos</td></tr>') + '</tbody></table></div></div>';
    if (document.getElementById('addD')) document.getElementById('addD').onclick = () => {
      const ov = document.createElement('div'); ov.className = 'modal-overlay';
      ov.innerHTML = '<div class="modal"><div class="modal-head"><h3>Enviar documento</h3><button class="x-btn" data-x>&times;</button></div><div class="modal-body"><div class="field"><label>Tipo</label><input id="dtype" placeholder="Ex: Contrato, RG, Exame"></div><div class="field"><label>Validade</label><input id="dvalid" type="date"></div><div class="field"><label>Arquivo</label><input id="dfile" type="file"></div></div><div class="modal-foot"><button class="btn ghost" data-x>Cancelar</button><button class="btn" id="dgo">Enviar</button></div></div>';
      document.body.appendChild(ov); ov.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => ov.remove());
      ov.querySelector('#dgo').onclick = async () => { const fd = new FormData(); fd.append('type', ov.querySelector('#dtype').value || 'Documento'); fd.append('valid_until', ov.querySelector('#dvalid').value); if (ov.querySelector('#dfile').files[0]) fd.append('file', ov.querySelector('#dfile').files[0]); try { await api('/athletes/' + a.id + '/documents', { method: 'POST', body: fd }); toast('Enviado', 'ok'); ov.remove(); App.route(); } catch (e) { toast(e.message, 'err'); } };
    };
  }

  function renderAthStats(p, a) {
    const avg = a.stats.reduce((s, x) => s + (x.goals || 0), 0);
    p.innerHTML = '<div class="stats" style="margin-bottom:1rem"><div class="stat"><div class="k">Gols</div><div class="v">' + a.totals.goals + '</div></div><div class="stat"><div class="k">Assistências</div><div class="v">' + a.totals.assists + '</div></div><div class="stat"><div class="k">Amarelos</div><div class="v">' + a.totals.yellow + '</div></div><div class="stat"><div class="k">Vermelhos</div><div class="v">' + a.totals.red + '</div></div><div class="stat"><div class="k">Média de gols/temporada</div><div class="v">' + (a.stats.length ? (avg / a.stats.length).toFixed(2) : '0.00') + '</div></div></div>' +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Campeonato</th><th>Temporada</th><th class="num">Gols</th><th class="num">Assist.</th><th class="num">Amarelos</th><th class="num">Vermelhos</th></tr></thead><tbody>' +
      (a.stats.length ? a.stats.map((s) => '<tr><td>' + esc(s.champ_name || '') + '</td><td>' + esc(s.season || '') + '</td><td class="num">' + s.goals + '</td><td class="num">' + s.assists + '</td><td class="num">' + s.yellow + '</td><td class="num">' + s.red + '</td></tr>').join('') : '<tr><td colspan="6" class="muted center">Sem estatísticas registradas</td></tr>') + '</tbody></table></div></div>';
  }

  /* ==================== CAMPEONATOS ==================== */
  App.registerView('championships', async function (content, param) {
    if (param) return champDetail(content, param);
    content.innerHTML = pageHead('Campeonatos', (can('campeonatos', 'include') ? '<button class="btn" id="newBtn">+ Novo Campeonato</button>' : '')) +
      '<div class="toolbar"><input id="q" placeholder="Buscar…" style="min-width:220px"><select id="f_status"><option value="">Status</option>' + ['planejamento', 'inscricoes_abertas', 'em_andamento', 'encerrado'].map((s) => '<option value="' + s + '">' + s.replace(/_/g, ' ') + '</option>').join('') + '</select><span class="spacer"></span><span class="chip" id="cnt"></span></div>' +
      '<div id="grid" class="stats" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))"></div>';
    const grid = document.getElementById('grid');
    async function load() {
      const r = await api('/championships?' + qs({ q: document.getElementById('q').value, status: document.getElementById('f_status').value, limit: 500 }));
      document.getElementById('cnt').textContent = r.total + ' campeonato(s)';
      if (!r.data.length) { grid.innerHTML = '<div class="card muted">Nenhum campeonato</div>'; return; }
      grid.innerHTML = r.data.map((c) => '<div class="card"><div class="row"><div style="font-size:1.6rem">🏆</div><div><b style="font-size:1.05rem">' + esc(c.name) + '</b><div class="small muted">' + esc(c.modality_name || '') + ' · ' + esc(c.season || '') + '</div></div><div class="spacer"></div>' + badge(c.status) + '</div>' +
        '<div class="row small muted" style="margin-top:.6rem"><span class="chip">🛡️ ' + c.clubs + ' clubes</span><span class="chip">⚽ ' + c.matches + ' jogos</span><span class="chip">' + esc((c.format || '').replace(/_/g, ' ')) + '</span></div>' +
        '<div class="row" style="margin-top:.8rem"><button class="btn sm" data-view="' + c.id + '">Abrir</button>' + (can('campeonatos', 'edit') ? '<button class="btn ghost sm" data-edit="' + c.id + '">Editar</button>' : '') + (can('campeonatos', 'delete') ? '<button class="btn ghost sm" data-del="' + c.id + '">🗑</button>' : '') + '</div></div>').join('');
      grid.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => App.go('#/championships/' + b.dataset.view));
      grid.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openForm(r.data.find((x) => String(x.id) === b.dataset.edit)));
      grid.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirm('Excluir campeonato?')) { await api('/championships/' + b.dataset.del, { method: 'DELETE' }); toast('Excluído', 'ok'); load(); } });
    }
    const CH_FIELDS = [
      { key: 'name', label: 'Nome do campeonato', required: true }, { key: 'season', label: 'Temporada', placeholder: '2026' },
      { key: 'modality_id', label: 'Modalidade', type: 'select', options: App.opt.modalities },
      { key: 'league_id', label: 'Liga / Organização', type: 'select', options: App.opt.orgs },
      { key: 'category', label: 'Categoria' }, { key: 'gender', label: 'Gênero', type: 'select', options: [{ value: 'Masculino', label: 'Masculino' }, { value: 'Feminino', label: 'Feminino' }, { value: 'Misto', label: 'Misto' }] },
      { key: 'age_group', label: 'Faixa etária', type: 'select', options: ['Livre', 'Sub-23', 'Sub-20', 'Sub-17', 'Sub-15', 'Sub-13'].map((x) => ({ value: x, label: x })) },
      { key: 'format', label: 'Formato de disputa', type: 'select', options: [['pontos_corridos', 'Pontos corridos'], ['mata_mata', 'Mata-mata'], ['grupos_mata_mata', 'Grupos + Mata-mata'], ['todos_contra_todos', 'Todos contra todos'], ['eliminatoria_simples', 'Eliminatória simples'], ['eliminatoria_dupla', 'Eliminatória dupla']].map(([v, l]) => ({ value: v, label: l })) },
      { key: 'double_round', label: 'Turno e returno', type: 'checkbox' },
      { key: 'points_win', label: 'Pontos vitória', type: 'number', default: 3 }, { key: 'points_draw', label: 'Pontos empate', type: 'number', default: 1 }, { key: 'points_loss', label: 'Pontos derrota', type: 'number', default: 0 },
      { key: 'start_date', label: 'Início', type: 'date' }, { key: 'end_date', label: 'Término', type: 'date' },
      { key: 'location', label: 'Local' },
      { key: 'status', label: 'Status', type: 'select', options: [['planejamento', 'Planejamento'], ['inscricoes_abertas', 'Inscrições abertas'], ['em_andamento', 'Em andamento'], ['encerrado', 'Encerrado']].map(([v, l]) => ({ value: v, label: l })) },
      { key: 'regulation', label: 'Regulamento', type: 'textarea', col: 2 }
    ];
    async function openForm(row) {
      const r = await formModal({ title: (row ? 'Editar' : 'Novo') + ' Campeonato', fields: CH_FIELDS, values: row || { points_win: 3, points_draw: 1, points_loss: 0, status: 'planejamento' }, wide: true });
      if (!r) return;
      try { row ? await api('/championships/' + row.id, { method: 'PUT', body: r.values }) : await api('/championships', { method: 'POST', body: r.values }); toast('Salvo', 'ok'); App.reloadRefs(); load(); }
      catch (e) { toast(e.message, 'err'); }
    }
    if (document.getElementById('newBtn')) document.getElementById('newBtn').onclick = () => openForm(null);
    document.getElementById('q').oninput = App.debounce(load, 350);
    document.getElementById('f_status').onchange = load;
    load();
  });

  async function champDetail(content, id) {
    const c = await api('/championships/' + id);
    content.innerHTML = pageHead('', '<button class="btn ghost" onclick="App.go(\'#/championships\')">← Voltar</button>' +
      (can('disputas', 'include') ? '<button class="btn accent" id="genBtn">⚙ Gerar tabela</button>' : '') +
      (can('campeonatos', 'edit') ? '<button class="btn" id="partBtn">Participantes</button>' : '')) +
      '<div class="card"><div class="row"><div style="font-size:2rem">🏆</div><div><h2 style="margin:0">' + esc(c.name) + '</h2><div class="muted">' + esc(c.modality_name || '') + ' · ' + esc(c.season || '') + ' · ' + esc((c.format || '').replace(/_/g, ' ')) + '</div></div><div class="spacer"></div>' + badge(c.status) + '</div></div>';
    const tabs = [
      { key: 'tab', label: 'Tabela de Jogos', render: (p) => renderRounds(p, c) },
      { key: 'class', label: 'Classificação', render: (p) => renderStandings(p, c.id) },
      { key: 'stats', label: 'Estatísticas', render: (p) => renderChampStats(p, c.id) },
      { key: 'susp', label: 'Suspensões', render: (p) => renderSuspensions(p, c.id) }
    ];
    if (document.getElementById('genBtn')) document.getElementById('genBtn').onclick = async () => {
      if (!await confirm('Gerar a tabela de jogos? Isso substituirá jogos ainda não realizados.')) return;
      try { const r = await api('/championships/' + id + '/fixtures', { method: 'POST', body: { doubleRound: !!c.double_round, format: c.format } }); toast('Tabela gerada: ' + (r.matches || r.created || '') + ' jogos', 'ok'); App.route(); } catch (e) { toast(e.message, 'err'); }
    };
    if (document.getElementById('partBtn')) document.getElementById('partBtn').onclick = () => participantsModal(c);
    tabbed(content, tabs, 'tab');
  }

  function participantsModal(c) {
    const selected = new Set(c.participants.map((p) => p.club_id));
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    ov.innerHTML = '<div class="modal"><div class="modal-head"><h3>Participantes — ' + esc(c.name) + '</h3><button class="x-btn" data-x>&times;</button></div>' +
      '<div class="modal-body"><p class="small muted">Selecione os clubes participantes.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem">' +
      state.refs.clubs.map((cl) => '<label style="display:flex;align-items:center;gap:.5rem;padding:.4rem;border:1px solid var(--line);border-radius:8px"><input type="checkbox" value="' + cl.id + '"' + (selected.has(cl.id) ? ' checked' : '') + '> ' + esc(cl.name) + '</label>').join('') + '</div></div>' +
      '<div class="modal-foot"><button class="btn ghost" data-x>Cancelar</button><button class="btn" id="pgo">Salvar participantes</button></div></div>';
    document.body.appendChild(ov); ov.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => ov.remove());
    ov.querySelector('#pgo').onclick = async () => {
      const ids = Array.from(ov.querySelectorAll('input:checked')).map((i) => parseInt(i.value));
      try { await api('/championships/' + c.id + '/participants', { method: 'POST', body: { club_ids: ids } }); toast(ids.length + ' clubes definidos', 'ok'); ov.remove(); App.route(); } catch (e) { toast(e.message, 'err'); }
    };
  }

  async function renderRounds(p, c) {
    const rounds = await api('/championships/' + c.id + '/rounds');
    if (!rounds.length) { p.innerHTML = '<div class="card muted">Nenhuma tabela gerada. Use “Gerar tabela”.</div>'; return; }
    p.innerHTML = rounds.map((r) => '<div class="card" style="margin-bottom:.8rem"><h4>' + esc(r.name || ('Rodada ' + r.number)) + '</h4><table class="data"><tbody>' +
      r.matches.map((m) => '<tr><td style="width:110px">' + fmtDate(m.match_date) + ' ' + esc((m.match_time || '').slice(0, 5)) + '</td>' +
      '<td style="text-align:right">' + esc(m.home_name || '') + ' ' + (m.home_logo ? img(m.home_logo, 'logo-xs') : '') + '</td>' +
      '<td class="num" style="width:80px"><b>' + (m.home_score ?? '-') + ' x ' + (m.away_score ?? '-') + '</b></td>' +
      '<td>' + (m.away_logo ? img(m.away_logo, 'logo-xs') : '') + ' ' + esc(m.away_name || '') + '</td>' +
      '<td class="small muted">' + esc(m.venue_name || '') + '</td><td class="num"><button class="btn ghost sm" data-m="' + m.id + '">Súmula</button></td></tr>').join('') + '</tbody></table></div>').join('');
    p.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => App.go('#/matches/' + b.dataset.m));
  }

  async function renderStandings(p, champId) {
    const s = await api('/championships/' + champId + '/standings');
    p.innerHTML = '<div class="card pad0"><div class="table-wrap"><table class="standings"><thead><tr><th>#</th><th>Clube</th><th>P</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>Pts</th><th>Forma</th></tr></thead><tbody>' +
      (s.length ? s.map((r) => '<tr class="' + (r.position <= 4 ? 'qualify' : '') + '"><td>' + r.position + '</td><td style="text-align:left">' + (r.logo ? img(r.logo, 'logo-xs') + ' ' : '') + esc(r.name) + '</td><td>' + r.played + '</td><td>' + r.wins + '</td><td>' + r.draws + '</td><td>' + r.losses + '</td><td>' + r.goals_for + '</td><td>' + r.goals_against + '</td><td>' + (r.goal_diff > 0 ? '+' : '') + r.goal_diff + '</td><td><b>' + r.points + '</b></td><td><span class="pill-form">' + String(r.form || '').split('').map((f) => '<span class="f-' + f + '">' + f + '</span>').join('') + '</span></td></tr>').join('') : '<tr><td colspan="11" class="muted center">Sem dados</td></tr>') + '</tbody></table></div></div>';
  }

  async function renderChampStats(p, champId) {
    const s = await api('/championships/' + champId + '/stats');
    const tbl = (title, rows, cols) => '<div class="card pad0" style="margin-bottom:1rem"><div style="padding:.8rem 1rem;border-bottom:1px solid var(--line)"><b>' + title + '</b></div><div class="table-wrap"><table class="data"><thead><tr>' + cols.map((c) => '<th' + (c.num ? ' class="num"' : '') + '>' + c.label + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.map((r, i) => '<tr>' + cols.map((c) => '<td' + (c.num ? ' class="num"' : '') + '>' + c.render(r, i) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + cols.length + '" class="muted center">Sem dados</td></tr>') + '</tbody></table></div></div>';
    p.innerHTML = tbl('Artilharia', s.scorers, [{ label: '#', num: true, render: (r, i) => i + 1 }, { label: 'Atleta', render: (r) => esc(r.nickname || r.name) }, { label: 'Clube', render: (r) => esc(r.club_name || '') }, { label: 'Gols', num: true, render: (r) => '<b>' + r.goals + '</b>' }]) +
      tbl('Assistências', s.assists, [{ label: '#', num: true, render: (r, i) => i + 1 }, { label: 'Atleta', render: (r) => esc(r.nickname || r.name) }, { label: 'Clube', render: (r) => esc(r.club_name || '') }, { label: 'Assist.', num: true, render: (r) => '<b>' + r.assists + '</b>' }]) +
      tbl('Disciplina', s.cards, [{ label: 'Atleta', render: (r) => esc(r.nickname || r.name) }, { label: 'Clube', render: (r) => esc(r.club_name || '') }, { label: '🟨', num: true, render: (r) => r.yellow }, { label: '🟥', num: true, render: (r) => r.red }]);
  }

  async function renderSuspensions(p, champId) {
    const s = await api('/championships/' + champId + '/suspensions');
    p.innerHTML = '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Atleta</th><th>Clube</th><th class="num">Amarelos</th><th class="num">Vermelhos</th><th class="num">Jogos de suspensão</th></tr></thead><tbody>' +
      (s.length ? s.map((r) => '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.club_name || '') + '</td><td class="num">' + r.yellow + '</td><td class="num">' + r.red + '</td><td class="num"><b>' + r.games + '</b></td></tr>').join('') : '<tr><td colspan="5" class="muted center">Nenhuma suspensão</td></tr>') + '</tbody></table></div></div>';
  }

  /* ==================== PARTIDAS ==================== */
  App.registerView('matches', async function (content, param) {
    if (param) return matchDetail(content, param);
    content.innerHTML = pageHead('Partidas', (can('partidas', 'include') ? '<button class="btn" id="newBtn">+ Nova Partida</button>' : '')) +
      '<div class="toolbar"><select id="f_champ"><option value="">Todos os campeonatos</option>' + state.refs.championships.map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select>' +
      '<select id="f_status"><option value="">Status</option>' + ['agendada', 'em_andamento', 'finalizada', 'adiada', 'cancelada'].map((s) => '<option value="' + s + '">' + s.replace(/_/g, ' ') + '</option>').join('') + '</select>' +
      '<input id="f_date" type="date"><span class="spacer"></span><span class="chip" id="cnt"></span></div>' +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Data</th><th>Partida</th><th class="num">Placar</th><th>Campeonato</th><th>Local</th><th>Status</th><th class="num">Ações</th></tr></thead><tbody id="rows"><tr><td colspan="7" class="muted center">Carregando…</td></tr></tbody></table></div></div>';
    const rows = document.getElementById('rows');
    async function load() {
      const r = await api('/matches?' + qs({ championship_id: document.getElementById('f_champ').value, status: document.getElementById('f_status').value, date: document.getElementById('f_date').value, limit: 1000 }));
      document.getElementById('cnt').textContent = r.total + ' partida(s)';
      if (!r.data.length) { rows.innerHTML = '<tr><td colspan="7" class="muted center">Nenhuma partida</td></tr>'; return; }
      rows.innerHTML = r.data.map((m) => '<tr><td>' + fmtDate(m.match_date) + '<div class="small muted">' + esc((m.match_time || '').slice(0, 5)) + '</div></td>' +
        '<td>' + (m.home_logo ? img(m.home_logo, 'logo-xs') + ' ' : '') + esc(m.home_name || '') + ' <span class="muted">x</span> ' + esc(m.away_name || '') + (m.away_logo ? ' ' + img(m.away_logo, 'logo-xs') : '') + '</td>' +
        '<td class="num"><b>' + (m.home_score ?? '-') + ' x ' + (m.away_score ?? '-') + '</b></td>' +
        '<td class="small">' + esc(m.champ_name || '') + '</td><td class="small muted">' + esc(m.venue_name || '') + '</td><td>' + badge(m.status) + '</td>' +
        '<td class="num"><div class="row" style="justify-content:center;flex-wrap:nowrap"><button class="btn sm" data-view="' + m.id + '">Abrir</button>' + (can('partidas', 'delete') ? '<button class="btn ghost sm" data-del="' + m.id + '">🗑</button>' : '') + '</div></td></tr>').join('');
      rows.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => App.go('#/matches/' + b.dataset.view));
      rows.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirm('Excluir partida?')) { await api('/matches/' + b.dataset.del, { method: 'DELETE' }); toast('Excluída', 'ok'); load(); } });
    }
    if (document.getElementById('newBtn')) document.getElementById('newBtn').onclick = async () => {
      const r = await formModal({ title: 'Nova Partida', wide: true, fields: [
        { key: 'championship_id', label: 'Campeonato', type: 'select', required: true, options: App.opt.championships },
        { key: 'home_club_id', label: 'Mandante', type: 'select', required: true, options: App.opt.clubs },
        { key: 'away_club_id', label: 'Visitante', type: 'select', required: true, options: App.opt.clubs },
        { key: 'match_date', label: 'Data', type: 'date', required: true }, { key: 'match_time', label: 'Hora', type: 'time' },
        { key: 'venue_id', label: 'Local', type: 'select', options: App.opt.venues },
        { key: 'referee_id', label: 'Árbitro', type: 'select', options: App.opt.referees },
        { key: 'status', label: 'Status', type: 'select', options: ['agendada', 'em_andamento', 'finalizada'].map((s) => ({ value: s, label: s })) }
      ], values: { status: 'agendada', match_date: new Date().toISOString().slice(0, 10) } });
      if (!r) return; try { const m = await api('/matches', { method: 'POST', body: r.values }); toast('Partida criada', 'ok'); App.go('#/matches/' + m.id); } catch (e) { toast(e.message, 'err'); }
    };
    document.getElementById('f_champ').onchange = load; document.getElementById('f_status').onchange = load; document.getElementById('f_date').onchange = load;
    load();
  });

  async function matchDetail(content, id) {
    const m = await api('/matches/' + id);
    const evTypes = { goal: '⚽ Gol', penalty_goal: '⚽ Gol de pênalti', own_goal: '🥅 Gol contra', assist: '🅰 Assistência', yellow: '🟨 Amarelo', red: '🟥 Vermelho', substitution: '🔄 Substituição', injury: '🚑 Lesão', penalty_miss: '❌ Pênalti perdido', penalty_save: '🧤 Pênalti defendido', occurrence: '📋 Ocorrência' };
    content.innerHTML = pageHead('', '<button class="btn ghost" onclick="App.go(\'#/matches\')">← Voltar</button>' +
      '<button class="btn ghost" onclick="window.open(\'' + App.authedUrl('/matches/' + id + '/pdf') + '\',\'_blank\')">📄 Ver PDF</button>' +
      (can('sumula', 'publish') ? '<button class="btn accent" id="pubBtn">✔ Publicar súmula</button>' : '')) +
      '<div class="card"><div class="match-card" style="border:none;box-shadow:none;margin:0"><div class="team">' + (m.home_logo ? img(m.home_logo, 'logo-sm') : '') + esc(m.home_name || '') + '</div>' +
      '<div class="score">' + (m.home_score ?? '-') + ' x ' + (m.away_score ?? '-') + '</div><div class="team away">' + esc(m.away_name || '') + (m.away_logo ? img(m.away_logo, 'logo-sm') : '') + '</div></div>' +
      '<div class="row center small muted" style="justify-content:center;margin-top:.5rem">' + fmtDate(m.match_date) + ' ' + esc((m.match_time || '').slice(0, 5)) + ' · ' + esc(m.venue_name || 'Sem local') + ' · ' + badge(m.status) + (m.published ? ' <span class="badge ok">Publicada</span>' : '') + '</div></div>';
    const tabs = [
      { key: 'resumo', label: 'Resumo & Resultado', render: (p) => renderMatchResumo(p, m) },
      { key: 'esc', label: 'Escalação', render: (p) => renderLineups(p, m) },
      { key: 'ev', label: 'Súmula / Eventos', render: (p) => renderEvents(p, m, evTypes) },
      { key: 'fotos', label: 'Fotos', render: (p) => renderMatchPhotos(p, m) },
      { key: 'trans', label: 'Transmissões', render: (p) => renderMatchStreams(p, m) }
    ];
    if (document.getElementById('pubBtn')) document.getElementById('pubBtn').onclick = async () => {
      try { const r = await api('/matches/' + id + '/publish', { method: 'POST', body: { status: 'finalizada' } }); toast('Súmula publicada' + (r.pdf_url ? ' e PDF gerado' : ''), 'ok'); App.route(); } catch (e) { toast(e.message, 'err'); }
    };
    tabbed(content, tabs, 'resumo');
  }

  function renderMatchResumo(p, m) {
    p.innerHTML = '<div class="grid2"><div class="card"><h3>Registrar resultado</h3>' + (can('partidas', 'edit') ? '<form id="resForm"><div class="grid3"><div class="field"><label>Gols mandante</label><input type="number" name="home_score" value="' + (m.home_score ?? 0) + '"></div><div class="field"><label>Gols visitante</label><input type="number" name="away_score" value="' + (m.away_score ?? 0) + '"></div><div class="field"><label>Status</label><select name="status">' + ['agendada', 'em_andamento', 'finalizada'].map((s) => '<option' + (m.status === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div></div>' +
      '<div class="grid2"><div class="field"><label>Pênaltis mandante</label><input type="number" name="penalties_home" value="' + (m.penalties_home ?? '') + '"></div><div class="field"><label>Pênaltis visitante</label><input type="number" name="penalties_away" value="' + (m.penalties_away ?? '') + '"></div></div>' +
      '<button class="btn" type="submit">Salvar resultado</button></form>' : '<p class="muted">Sem permissão.</p>') + '</div>' +
      '<div class="card"><h3>Arbitragem & Local</h3><table class="data"><tbody>' + [['Árbitro', m.referee_name], ['Assistente 1', m.assistant1_name], ['Assistente 2', m.assistant2_name], ['Quarto árbitro', m.fourth_name], ['Delegado', m.delegate_name], ['Local', m.venue_name], ['Endereço', m.venue_addr], ['Campeonato', m.champ_name]].map(([k, v]) => '<tr><td class="muted">' + esc(k) + '</td><td>' + esc(v || '—') + '</td></tr>').join('') + '</tbody></table></div></div>';
    const f = document.getElementById('resForm');
    if (f) f.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(f); const body = Object.fromEntries(fd.entries()); ['home_score', 'away_score', 'penalties_home', 'penalties_away'].forEach((k) => { if (body[k] === '') body[k] = null; else body[k] = parseInt(body[k]); }); try { await api('/matches/' + m.id + '/result', { method: 'POST', body }); toast('Resultado salvo', 'ok'); App.route(); } catch (er) { toast(er.message, 'err'); } };
  }

  async function renderLineups(p, m) {
    p.innerHTML = '<div class="row" style="margin-bottom:.8rem"><select id="lclub"><option value="">Selecione o clube…</option><option value="' + m.home_club_id + '">' + esc(m.home_name) + '</option><option value="' + m.away_club_id + '">' + esc(m.away_name) + '</option></select><span class="spacer"></span><span class="chip" id="lcount"></span></div><div id="lbox"><p class="muted">Selecione um clube para escalar.</p></div>';
    document.getElementById('lclub').onchange = async (e) => {
      const clubId = e.target.value; if (!clubId) return;
      const r = await api('/matches/' + m.id + '/available-players?club_id=' + clubId);
      const existing = m.lineups.filter((l) => l.club_id === parseInt(clubId));
      const box = document.getElementById('lbox');
      box.innerHTML = '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Titular</th><th>Atleta</th><th>Posição</th><th>Nº</th><th>Bloqueio</th></tr></thead><tbody>' +
        r.players.map((pl) => { const ex = existing.find((x) => x.athlete_id === pl.id); return '<tr><td><input type="checkbox" class="lstart" value="' + pl.id + '"' + (ex && ex.is_starter ? ' checked' : '') + (pl.blocked ? ' disabled' : '') + '></td>' +
          '<td>' + esc(pl.name) + (pl.blocked ? ' <span class="badge danger">' + esc(pl.blocks.join(', ')) + '</span>' : '') + '</td><td>' + esc(pl.position || '') + '</td><td>' + esc(pl.number || '') + '</td><td>' + (pl.blocked ? '🚫' : '✅') + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
        '<div class="row" style="margin-top:.8rem"><button class="btn" id="saveLine">Salvar escalação</button><span class="muted small">Marque os titulares. Atletas bloqueados não podem ser escalados.</span></div>';
      document.getElementById('saveLine').onclick = async () => {
        const players = Array.from(box.querySelectorAll('.lstart')).map((c) => ({ athlete_id: parseInt(c.value), is_starter: c.checked ? 1 : 0 }));
        try { await api('/matches/' + m.id + '/lineups', { method: 'POST', body: { club_id: parseInt(clubId), players } }); toast('Escalação salva', 'ok'); App.route(); } catch (er) { toast(er.message, 'err'); }
      };
    };
  }

  function renderEvents(p, m, evTypes) {
    p.innerHTML = '<div class="section-title"><h2>Eventos da partida</h2>' + (can('sumula', 'edit') ? '<button class="btn sm" id="addEv">+ Evento</button>' : '') + '</div>' +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th class="num">Min</th><th>Evento</th><th>Atleta</th><th>Clube</th><th class="num">A\u00e7\u00f5es</th></tr></thead><tbody id="evrows"></tbody></table></div></div>';
    const tbody = document.getElementById('evrows');
    const clubName = (e) => (e.club_id === m.home_club_id ? m.home_name : (e.club_id === m.away_club_id ? m.away_name : ''));
    function renderRows() {
      tbody.innerHTML = m.events.length ? m.events.map((e) => '<tr><td class="num">' + (e.minute || 0) + "'</td><td>" + esc(evTypes[e.type] || e.type) + '</td><td>' + esc(e.athlete_name || e.related_name || '\u2014') + '</td><td>' + esc(clubName(e)) + '</td><td class="num">' + (can('sumula', 'edit') ? '<button class="btn ghost sm" data-del="' + e.id + '">\ud83d\uddd1</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="5" class="muted center">Sem eventos</td></tr>';
      tbody.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        try {
          await api('/matches/' + m.id + '/events/' + b.dataset.del, { method: 'DELETE' });
          m.events = m.events.filter((x) => String(x.id) !== String(b.dataset.del));
          renderRows(); toast('Evento removido', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      });
    }
    renderRows();
    if (document.getElementById('addEv')) document.getElementById('addEv').onclick = async () => {
      const r = await formModal({ title: 'Adicionar evento', fields: [
        { key: 'type', label: 'Tipo', type: 'select', required: true, options: Object.entries(evTypes).map(([v, l]) => ({ value: v, label: l })) },
        { key: 'minute', label: 'Minuto', type: 'number' },
        { key: 'club_id', label: 'Clube', type: 'select', options: [{ value: m.home_club_id, label: m.home_name }, { value: m.away_club_id, label: m.away_name }] },
        { key: 'athlete_id', label: 'Atleta', type: 'select', options: m.lineups.map((l) => ({ value: l.athlete_id, label: l.name })) },
        { key: 'related_athlete_id', label: 'Atleta relacionado (assist./subst.)', type: 'select', options: m.lineups.map((l) => ({ value: l.athlete_id, label: l.name })) },
        { key: 'detail', label: 'Detalhe', col: 2 }
      ] });
      if (!r) return;
      try {
        const ev = await api('/matches/' + m.id + '/events', { method: 'POST', body: r.values });
        m.events.push(ev);
        m.events.sort((a, b) => (a.minute || 0) - (b.minute || 0));
        renderRows(); toast('Evento adicionado', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  function renderMatchPhotos(p, m) {
    p.innerHTML = '<div class="section-title"><h2>Galeria (' + m.photos.length + '/20)</h2>' + (can('publicacoes', 'include') && m.photos.length < 20 ? '<button class="btn sm" id="upPhotos">⬆ Enviar fotos</button>' : '') + '</div>' +
      '<div class="gallery">' + (m.photos.length ? m.photos.map((ph) => '<div><img src="' + esc(ph.url) + '"><div class="small muted">' + esc(ph.caption || '') + '</div></div>').join('') : '<p class="muted">Sem fotos. Envie até 20 fotos — serão publicadas automaticamente no portal, Instagram e Facebook.</p>') + '</div>';
    if (document.getElementById('upPhotos')) document.getElementById('upPhotos').onclick = () => {
      const ov = document.createElement('div'); ov.className = 'modal-overlay';
      ov.innerHTML = '<div class="modal"><div class="modal-head"><h3>Enviar fotos da partida</h3><button class="x-btn" data-x>&times;</button></div><div class="modal-body"><div class="field"><label>Fotos (até ' + (20 - m.photos.length) + ')</label><input type="file" id="pf" multiple accept="image/*"></div><p class="small muted">Integração automática: Portal Público, Instagram e Facebook.</p></div><div class="modal-foot"><button class="btn ghost" data-x>Cancelar</button><button class="btn" id="pgo">Enviar</button></div></div>';
      document.body.appendChild(ov); ov.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => ov.remove());
      ov.querySelector('#pgo').onclick = async () => { const files = ov.querySelector('#pf').files; if (!files.length) return; const fd = new FormData(); Array.from(files).forEach((f) => fd.append('files', f)); try { const r = await api('/upload/match/' + m.id + '/photos', { method: 'POST', body: fd }); toast(r.photos.length + ' foto(s) enviada(s)', 'ok'); ov.remove(); App.route(); } catch (e) { toast(e.message, 'err'); } };
    };
  }

  function renderMatchStreams(p, m) {
    p.innerHTML = '<div class="section-title"><h2>Transmissões</h2>' + (can('publicacoes', 'include') ? '<button class="btn sm" id="addSt">+ Transmissão</button>' : '') + '</div>' +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Plataforma</th><th>Título</th><th>Link</th><th>Status</th></tr></thead><tbody>' +
      (m.streams.length ? m.streams.map((s) => '<tr><td>' + esc(s.platform) + '</td><td>' + esc(s.title) + '</td><td><a href="' + esc(s.url) + '" target="_blank">Abrir</a></td><td>' + badge(s.status) + '</td></tr>').join('') : '<tr><td colspan="4" class="muted center">Sem transmissões</td></tr>') + '</tbody></table></div></div>';
    if (document.getElementById('addSt')) document.getElementById('addSt').onclick = async () => {
      const r = await formModal({ title: 'Nova transmissão', fields: [
        { key: 'title', label: 'Título', required: true }, { key: 'url', label: 'URL', required: true },
        { key: 'platform', label: 'Plataforma', type: 'select', options: ['YouTube', 'Facebook Live', 'Instagram'].map((x) => ({ value: x, label: x })) },
        { key: 'status', label: 'Status', type: 'select', options: [['agendada', 'Agendada'], ['ao_vivo', 'Ao vivo'], ['encerrada', 'Encerrada']].map(([v, l]) => ({ value: v, label: l })) },
        { key: 'scheduled_at', label: 'Agendada para', type: 'datetime' }
      ] });
      if (!r) return; r.values.match_id = m.id; try { await api('/streams', { method: 'POST', body: r.values }); toast('Transmissão adicionada', 'ok'); App.route(); } catch (e) { toast(e.message, 'err'); }
    };
  }

  /* ==================== SÚMULA (atalho) ==================== */
  App.registerView('sumula', async function (content) {
    content.innerHTML = pageHead('Súmula Digital') + '<div class="card"><p class="muted">Selecione uma partida para abrir a súmula digital (escalação, eventos, gols, cartões, substituições e geração de PDF).</p></div>' +
      '<div class="toolbar"><select id="f_champ"><option value="">Todos os campeonatos</option>' + state.refs.championships.map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select></div>' +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Data</th><th>Partida</th><th class="num">Placar</th><th>Status</th><th class="num">Súmula</th></tr></thead><tbody id="rows"></tbody></table></div></div>';
    async function load() { const r = await api('/matches?' + qs({ championship_id: document.getElementById('f_champ').value, limit: 500 })); document.getElementById('rows').innerHTML = r.data.length ? r.data.map((m) => '<tr><td>' + fmtDate(m.match_date) + '</td><td>' + esc(m.home_name) + ' x ' + esc(m.away_name) + '</td><td class="num"><b>' + (m.home_score ?? '-') + ' x ' + (m.away_score ?? '-') + '</b></td><td>' + badge(m.status) + (m.published ? ' <span class="badge ok">Publicada</span>' : '') + '</td><td class="num"><button class="btn sm" data-m="' + m.id + '">Abrir súmula</button></td></tr>').join('') : '<tr><td colspan="5" class="muted center">Nenhuma partida</td></tr>'; document.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => App.go('#/matches/' + b.dataset.m)); }
    document.getElementById('f_champ').onchange = load; load();
  });

  /* ==================== CLASSIFICAÇÃO / ESTATÍSTICAS ==================== */
  function champPicker(title, render) {
    return async function (content) {
      content.innerHTML = pageHead(title) + '<div class="toolbar"><select id="sel"><option value="">Selecione o campeonato…</option>' + state.refs.championships.map((c) => '<option value="' + c.id + '">' + esc(c.name) + ' ' + esc(c.season || '') + '</option>').join('') + '</select></div><div id="out"><div class="card muted">Selecione um campeonato.</div></div>';
      const sel = document.getElementById('sel');
      if (state.refs.championships[0]) { sel.value = state.refs.championships[0].id; render(document.getElementById('out'), sel.value); }
      sel.onchange = () => render(document.getElementById('out'), sel.value);
    };
  }
  App.registerView('standings', champPicker('Classificação', (out, id) => { if (!id) return; out.innerHTML = '<p class="muted">Carregando…</p>'; renderStandings(out, id); }));
  App.registerView('stats', champPicker('Estatísticas', (out, id) => { if (!id) return; out.innerHTML = '<p class="muted">Carregando…</p>'; renderChampStats(out, id); }));

  /* ==================== TRANSFERÊNCIAS ==================== */
  App.registerView('transfers', async function (content) {
    content.innerHTML = pageHead('Transferências', (can('transferencias', 'include') ? '<button class="btn" id="newBtn">+ Nova Transferência</button>' : '')) +
      '<div class="toolbar"><select id="f_status"><option value="">Status</option>' + ['pendente', 'aprovada', 'reprovada'].map((s) => '<option value="' + s + '">' + s + '</option>').join('') + '</select><span class="spacer"></span><span class="chip" id="cnt"></span></div>' +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Data</th><th>Atleta</th><th>De → Para</th><th class="num">Valor</th><th class="num">Taxa</th><th class="num">Total</th><th>Status</th><th class="num">Ações</th></tr></thead><tbody id="rows"></tbody></table></div></div>';
    async function load() {
      const r = await api('/transfers?' + qs({ status: document.getElementById('f_status').value }));
      document.getElementById('cnt').textContent = r.total + ' transferência(s)';
      document.getElementById('rows').innerHTML = r.data.length ? r.data.map((t) => '<tr><td>' + fmtDate(t.transfer_date) + '</td><td>' + esc(t.athlete_name || '') + '</td><td class="small">' + esc(t.from_club || '—') + ' → <b>' + esc(t.to_club || '—') + '</b></td><td class="num">' + fmtMoney(t.value) + '</td><td class="num">' + fmtMoney(t.admin_fee) + '</td><td class="num"><b>' + fmtMoney(t.total) + '</b></td><td>' + badge(t.status) + '</td>' +
        '<td class="num"><div class="row" style="justify-content:center;flex-wrap:wrap">' + (can('transferencias', 'approve') && t.status !== 'aprovada' ? '<button class="btn sm" data-appr="' + t.id + '">Aprovar</button>' : '') + '<button class="btn ghost sm" data-bol="' + t.id + '">Boleto</button><button class="btn ghost sm" data-send="' + t.id + '">Enviar</button>' + (can('transferencias', 'edit') ? '<button class="btn ghost sm" data-edit="' + t.id + '">✎</button>' : '') + (can('transferencias', 'delete') ? '<button class="btn ghost sm" data-del="' + t.id + '">🗑</button>' : '') + '</div></td></tr>').join('') : '<tr><td colspan="8" class="muted center">Nenhuma transferência</td></tr>';
      const q = (s) => document.querySelectorAll(s);
      q('[data-appr]').forEach((b) => b.onclick = async () => { if (await confirm('Aprovar transferência? O atleta será movido ao novo clube e o histórico/financeiro atualizados.')) { try { await api('/transfers/' + b.dataset.appr + '/approve', { method: 'POST' }); toast('Transferência aprovada', 'ok'); App.reloadRefs(); load(); } catch (e) { toast(e.message, 'err'); } } });
      q('[data-bol]').forEach((b) => b.onclick = async () => { try { const r = await api('/transfers/' + b.dataset.bol + '/boleto', { method: 'POST' }); toast('Boleto gerado — cód. ' + r.boleto.barcode.slice(0, 12) + '…', 'ok'); } catch (e) { toast(e.message, 'err'); } });
      q('[data-send]').forEach((b) => b.onclick = async () => { try { const r = await api('/transfers/' + b.dataset.send + '/send', { method: 'POST' }); toast(r.message, 'ok'); } catch (e) { toast(e.message, 'err'); } });
      q('[data-edit]').forEach((b) => b.onclick = () => openForm(r.data.find((x) => String(x.id) === b.dataset.edit)));
      q('[data-del]').forEach((b) => b.onclick = async () => { if (await confirm('Excluir?')) { await api('/transfers/' + b.dataset.del, { method: 'DELETE' }); load(); } });
    }
    const T_FIELDS = [
      { key: 'athlete_id', label: 'Atleta', type: 'select', required: true, options: App.opt.athletes },
      { key: 'championship_id', label: 'Campeonato', type: 'select', options: App.opt.championships },
      { key: 'from_club_id', label: 'Clube de origem', type: 'select', options: App.opt.clubs },
      { key: 'to_club_id', label: 'Clube de destino', type: 'select', required: true, options: App.opt.clubs },
      { key: 'value', label: 'Valor', type: 'money' }, { key: 'admin_fee', label: 'Taxa administrativa', type: 'money' },
      { key: 'transfer_date', label: 'Data', type: 'date' }, { key: 'responsible', label: 'Responsável' },
      { key: 'status', label: 'Status', type: 'select', options: ['pendente', 'aprovada', 'reprovada'].map((s) => ({ value: s, label: s })) },
      { key: 'reason', label: 'Motivo', type: 'textarea', col: 2 }
    ];
    async function openForm(row) { const r = await formModal({ title: (row ? 'Editar' : 'Nova') + ' Transferência', fields: T_FIELDS, values: row || { status: 'pendente', transfer_date: new Date().toISOString().slice(0, 10) }, wide: true }); if (!r) return; try { row ? await api('/transfers/' + row.id, { method: 'PUT', body: r.values }) : await api('/transfers', { method: 'POST', body: r.values }); toast('Salvo', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } }
    if (document.getElementById('newBtn')) document.getElementById('newBtn').onclick = () => openForm(null);
    document.getElementById('f_status').onchange = load; load();
  });

  /* ==================== FINANCEIRO ==================== */
  App.registerView('finance', async function (content) {
    const sum = await api('/finance/summary');
    content.innerHTML = pageHead('Financeiro', '<a class="btn ghost" href="/api/finance/export?format=csv" target="_blank">⬇ CSV</a><a class="btn ghost" href="/api/finance/export?format=txt" target="_blank">⬇ TXT</a>' + (can('financeiro', 'include') ? '<button class="btn" id="newBtn">+ Lançamento</button>' : '')) +
      '<div class="stats"><div class="stat"><div class="k">Receitas</div><div class="v" style="color:var(--ok)">' + fmtMoney(sum.revenue) + '</div></div><div class="stat"><div class="k">Despesas</div><div class="v" style="color:var(--danger)">' + fmtMoney(sum.expense) + '</div></div><div class="stat"><div class="k">Saldo</div><div class="v">' + fmtMoney(sum.balance) + '</div></div></div>' +
      '<div class="tabs" style="margin-top:1rem"><button class="active" data-tab="lanc">Lançamentos</button><button data-tab="anex">Anexos</button><button data-tab="pend">Pendências</button></div><div id="fpane"></div>';
    const pane = document.getElementById('fpane');
    const show = async (key) => {
      content.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
      pane.innerHTML = '<p class="muted">Carregando…</p>';
      if (key === 'lanc') {
        const r = await api('/transactions?limit=500');
        pane.innerHTML = '<div class="toolbar"><select id="f_type"><option value="">Tipo</option><option value="receita">Receita</option><option value="despesa">Despesa</option></select><select id="f_status"><option value="">Status</option><option value="pendente">Pendente</option><option value="pago">Pago</option></select></div><div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th><th>Status</th><th class="num">Ações</th></tr></thead><tbody>' + (r.data.length ? r.data.map((t) => '<tr><td>' + fmtDate(t.date) + '</td><td>' + badge(t.type) + '</td><td>' + esc(t.category || '') + '</td><td>' + esc(t.description || '') + '</td><td class="num">' + fmtMoney(t.amount) + '</td><td>' + badge(t.status) + '</td><td class="num">' + (can('financeiro', 'delete') ? '<button class="btn ghost sm" data-del="' + t.id + '">🗑</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="7" class="muted center">Sem lançamentos</td></tr>') + '</tbody></table></div></div>';
        pane.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirm('Excluir lançamento?')) { await api('/transactions/' + b.dataset.del, { method: 'DELETE' }); show('lanc'); } });
      } else if (key === 'anex') {
        pane.innerHTML = '<div class="card"><h3>Anexar documento</h3>' + (can('financeiro', 'include') ? '<form id="docForm" class="grid2"><div class="field"><label>Tipo</label><select name="type"><option>NF-e</option><option>Cupom fiscal</option><option>Recibo</option><option>Contrato</option><option>Comprovante de pagamento</option></select></div><div class="field"><label>Validade</label><input type="date" name="valid_until"></div><div class="field" style="grid-column:span 2"><label>Arquivo</label><input type="file" name="file"></div><div class="field" style="grid-column:span 2"><button class="btn" type="submit">Enviar</button></div></form>' : '<p class="muted">Sem permissão.</p>') + '</div>';
        const f = document.getElementById('docForm');
        if (f) f.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(f); try { await api('/finance/documents', { method: 'POST', body: fd }); toast('Documento anexado', 'ok'); f.reset(); } catch (er) { toast(er.message, 'err'); } };
      } else {
        pane.innerHTML = '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Vencimento</th><th>Descrição</th><th class="num">Valor</th><th>Status</th><th class="num">Ações</th></tr></thead><tbody>' + (sum.pending.length ? sum.pending.map((t) => '<tr><td>' + fmtDate(t.due_date) + '</td><td>' + esc(t.description) + '</td><td class="num">' + fmtMoney(t.amount) + '</td><td>' + badge(t.status) + '</td><td class="num">' + (can('financeiro', 'include') ? '<button class="btn sm" data-pay="' + t.id + '">Gerar pagamento</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="5" class="muted center">Nada pendente</td></tr>') + '</tbody></table></div></div>';
        pane.querySelectorAll('[data-pay]').forEach((b) => b.onclick = async () => { try { const p = await api('/finance/payments', { method: 'POST', body: { transaction_id: parseInt(b.dataset.pay), method: 'PIX' } }); toast('Pagamento gerado (PIX ' + (p.pix_code || '').slice(0, 10) + '…)', 'ok'); } catch (e) { toast(e.message, 'err'); } });
      }
    };
    content.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => show(b.dataset.tab));
    if (document.getElementById('newBtn')) document.getElementById('newBtn').onclick = async () => {
      const r = await formModal({ title: 'Novo lançamento', wide: true, fields: [
        { key: 'type', label: 'Tipo', type: 'select', required: true, options: [{ value: 'receita', label: 'Receita' }, { value: 'despesa', label: 'Despesa' }] },
        { key: 'category', label: 'Categoria' }, { key: 'description', label: 'Descrição', col: 2 },
        { key: 'amount', label: 'Valor', type: 'money', required: true }, { key: 'date', label: 'Data', type: 'date' }, { key: 'due_date', label: 'Vencimento', type: 'date' },
        { key: 'status', label: 'Status', type: 'select', options: [['pendente', 'Pendente'], ['pago', 'Pago']].map(([v, l]) => ({ value: v, label: l })) },
        { key: 'payment_method', label: 'Forma', type: 'select', options: ['PIX', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão'].map((x) => ({ value: x, label: x })) },
        { key: 'cost_center', label: 'Centro de custo' }
      ], values: { type: 'receita', status: 'pendente', date: new Date().toISOString().slice(0, 10) } });
      if (!r) return; try { await api('/transactions', { method: 'POST', body: r.values }); toast('Lançamento criado', 'ok'); App.route(); } catch (e) { toast(e.message, 'err'); }
    };
    show('lanc');
  });

  /* ==================== PUBLICAÇÕES (genéricas) ==================== */
  App.registerView('news', genericCRUD({
    key: 'news', title: 'Notícias', endpoint: '/news', module: 'publicacoes', entity: 'news', wide: true,
    columns: [{ label: 'Imagem', render: (r) => r.image ? '<img src="' + esc(r.image) + '" class="logo-sm">' : '—' }, { label: 'Título', render: (r) => '<b>' + esc(r.title) + '</b><div class="small muted">' + esc(r.category || '') + '</div>' }, { label: 'Autor', key: 'author' }, { label: 'Data', render: (r) => fmtDate(r.publish_date) }, { label: 'Status', render: (r) => badge(r.status) }],
    fields: [
      { key: 'title', label: 'Título', required: true, col: 2 }, { key: 'subtitle', label: 'Subtítulo', col: 2 },
      { key: 'category', label: 'Categoria' }, { key: 'author', label: 'Autor' },
      { key: 'championship_id', label: 'Campeonato', type: 'select', options: App.opt.championships },
      { key: 'publish_date', label: 'Data de publicação', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'rascunho', label: 'Rascunho' }, { value: 'publicada', label: 'Publicada' }] },
      { key: 'image', label: 'Imagem', type: 'image' }, { key: 'video', label: 'Vídeo (URL)' },
      { key: 'content', label: 'Conteúdo', type: 'textarea', col: 2 }
    ]
  }));

  App.registerView('photos', genericCRUD({
    key: 'photos', title: 'Fotos', endpoint: '/photos', module: 'publicacoes', entity: 'photos',
    columns: [{ label: 'Foto', render: (r) => r.url ? '<img src="' + esc(r.url) + '" class="logo-sm">' : '—' }, { label: 'Álbum', key: 'album' }, { label: 'Legenda', key: 'caption' }, { label: 'Compartilhada', render: (r) => r.shared ? '<span class="badge ok">Sim</span>' : '<span class="badge gray">Não</span>' }],
    fields: [
      { key: 'album', label: 'Álbum' }, { key: 'caption', label: 'Legenda' },
      { key: 'match_id', label: 'ID da Partida', type: 'number' }, { key: 'championship_id', label: 'Campeonato', type: 'select', options: App.opt.championships },
      { key: 'club_id', label: 'Clube', type: 'select', options: App.opt.clubs },
      { key: 'shared', label: 'Compartilhar no portal/redes', type: 'checkbox' }, { key: 'url', label: 'Foto', type: 'image' }
    ]
  }));

  App.registerView('videos', genericCRUD({
    key: 'videos', title: 'Vídeos', endpoint: '/videos', module: 'publicacoes', entity: 'videos',
    columns: [{ label: 'Thumb', render: (r) => r.thumbnail ? '<img src="' + esc(r.thumbnail) + '" class="logo-sm">' : '🎬' }, { label: 'Título', render: (r) => '<b>' + esc(r.title) + '</b>' }, { label: 'Plataforma', key: 'platform' }, { label: 'Tipo', key: 'type' }, { label: 'Link', render: (r) => r.url ? '<a href="' + esc(r.url) + '" target="_blank">Abrir</a>' : '—' }],
    fields: [
      { key: 'title', label: 'Título', required: true, col: 2 }, { key: 'url', label: 'URL', required: true, col: 2 },
      { key: 'platform', label: 'Plataforma', type: 'select', options: ['YouTube', 'Facebook', 'Instagram', 'Outro'].map((x) => ({ value: x, label: x })) },
      { key: 'type', label: 'Tipo' }, { key: 'championship_id', label: 'Campeonato', type: 'select', options: App.opt.championships },
      { key: 'match_id', label: 'ID da Partida', type: 'number' }, { key: 'thumbnail', label: 'Thumbnail', type: 'image' }
    ]
  }));

  App.registerView('streams', genericCRUD({
    key: 'streams', title: 'Transmissões', endpoint: '/streams', module: 'publicacoes', entity: 'streams',
    columns: [{ label: 'Título', render: (r) => '<b>' + esc(r.title) + '</b>' }, { label: 'Plataforma', key: 'platform' }, { label: 'Status', render: (r) => badge(r.status) }, { label: 'Agendada', render: (r) => fmtDateTime(r.scheduled_at) }, { label: 'Link', render: (r) => r.url ? '<a href="' + esc(r.url) + '" target="_blank">Abrir</a>' : '—' }],
    fields: [
      { key: 'title', label: 'Título', required: true, col: 2 }, { key: 'url', label: 'URL', required: true, col: 2 },
      { key: 'platform', label: 'Plataforma', type: 'select', options: ['YouTube', 'Facebook Live', 'Instagram'].map((x) => ({ value: x, label: x })) },
      { key: 'status', label: 'Status', type: 'select', options: [['agendada', 'Agendada'], ['ao_vivo', 'Ao vivo'], ['encerrada', 'Encerrada']].map(([v, l]) => ({ value: v, label: l })) },
      { key: 'scheduled_at', label: 'Agendada para', type: 'datetime' }, { key: 'match_id', label: 'ID da Partida', type: 'number' }
    ]
  }));

  /* ==================== ENQUETES ==================== */
  App.registerView('polls', async function (content) {
    content.innerHTML = pageHead('Enquetes', (can('enquetes', 'include') ? '<button class="btn" id="newBtn">+ Nova Enquete</button>' : '')) + '<div id="list" class="stats" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))"></div>';
    async function load() {
      const r = await api('/polls');
      const list = document.getElementById('list');
      list.innerHTML = r.data.length ? r.data.map((p) => '<div class="card"><div class="row"><b>' + esc(p.title) + '</b><div class="spacer"></div>' + badge(p.status) + '</div>' +
        '<div class="small muted" style="margin:.3rem 0">' + esc(p.type || '') + ' · ' + p.total_votes + ' voto(s)' + (p.winner ? ' · Líder: ' + esc(p.winner.label) : '') + '</div>' +
        p.results.map((o) => '<div class="small">' + esc(o.label) + ' — <b>' + o.votes + '</b> (' + o.percent + '%)<div class="poll-bar"><i style="width:' + o.percent + '%"></i></div></div>').join('') +
        '<div class="row" style="margin-top:.6rem">' + (can('enquetes', 'publish') ? (p.status === 'aberta' ? '<button class="btn ghost sm" data-close="' + p.id + '">Encerrar</button>' : '<button class="btn ghost sm" data-reopen="' + p.id + '">Reabrir</button>') + '<button class="btn ghost sm" data-pub="' + p.id + '">Publicar resultado</button>' : '') + (can('enquetes', 'edit') ? '<button class="btn ghost sm" data-edit="' + p.id + '">✎</button>' : '') + (can('enquetes', 'delete') ? '<button class="btn ghost sm" data-del="' + p.id + '">🗑</button>' : '') + '</div></div>').join('') : '<div class="card muted">Nenhuma enquete</div>';
      const q = (s) => list.querySelectorAll(s);
      q('[data-close]').forEach((b) => b.onclick = async () => { await api('/polls/' + b.dataset.close + '/close', { method: 'POST' }); load(); });
      q('[data-reopen]').forEach((b) => b.onclick = async () => { await api('/polls/' + b.dataset.reopen + '/reopen', { method: 'POST' }); load(); });
      q('[data-pub]').forEach((b) => b.onclick = async () => { await api('/polls/' + b.dataset.pub + '/publish', { method: 'POST' }); toast('Resultado publicado', 'ok'); load(); });
      q('[data-edit]').forEach((b) => b.onclick = () => openForm(r.data.find((x) => String(x.id) === b.dataset.edit)));
      q('[data-del]').forEach((b) => b.onclick = async () => { if (await confirm('Excluir enquete?')) { await api('/polls/' + b.dataset.del, { method: 'DELETE' }); load(); } });
    }
    async function openForm(row) {
      const r = await formModal({ title: (row ? 'Editar' : 'Nova') + ' Enquete', fields: [
        { key: 'title', label: 'Pergunta', required: true, col: 2 },
        { key: 'type', label: 'Tipo', type: 'select', options: [{ value: 'escolha_unica', label: 'Escolha única' }] },
        { key: 'championship_id', label: 'Campeonato', type: 'select', options: App.opt.championships },
        { key: 'options', label: 'Opções (separadas por vírgula)', col: 2, help: 'Ex: Time A, Time B, Time C', default: row ? (row.options || []).join(', ') : '' },
        { key: 'start_date', label: 'Início', type: 'date' }, { key: 'end_date', label: 'Fim', type: 'date' },
        { key: 'status', label: 'Status', type: 'select', options: [['aberta', 'Aberta'], ['encerrada', 'Encerrada'], ['publicada', 'Publicada']].map(([v, l]) => ({ value: v, label: l })) }
      ], values: row || { type: 'escolha_unica', status: 'aberta' } });
      if (!r) return;
      r.values.options = (r.values.options || '').split(',').map((s) => s.trim()).filter(Boolean);
      try { row ? await api('/polls/' + row.id, { method: 'PUT', body: r.values }) : await api('/polls', { method: 'POST', body: r.values }); toast('Salvo', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
    }
    if (document.getElementById('newBtn')) document.getElementById('newBtn').onclick = () => openForm(null);
    load();
  });

  /* ==================== USUÁRIOS ==================== */
  App.registerView('users', async function (content) {
    content.innerHTML = pageHead('Usuários', (can('usuarios', 'include') ? '<button class="btn" id="newBtn">+ Novo Usuário</button>' : '')) +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Organização</th><th>Último acesso</th><th>Status</th><th class="num">Ações</th></tr></thead><tbody id="rows"></tbody></table></div></div>';
    async function load() {
      const r = await api('/users');
      document.getElementById('rows').innerHTML = r.data.length ? r.data.map((u) => '<tr><td><b>' + esc(u.name) + '</b>' + (u.is_super ? ' <span class="badge brand">Super</span>' : '') + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.role_name || '—') + '</td><td>' + esc(u.org_name || '—') + '</td><td class="small muted">' + (u.last_login || '—') + '</td><td>' + badge(u.status) + '</td><td class="num"><div class="row" style="justify-content:center;flex-wrap:nowrap">' + (can('usuarios', 'edit') ? '<button class="btn ghost sm" data-edit="' + u.id + '">✎</button>' : '') + (can('usuarios', 'delete') ? '<button class="btn ghost sm" data-del="' + u.id + '">🗑</button>' : '') + '</div></td></tr>').join('') : '<tr><td colspan="7" class="muted center">Sem usuários</td></tr>';
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openForm(r.data.find((x) => String(x.id) === b.dataset.edit)));
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirm('Excluir usuário?')) { try { await api('/users/' + b.dataset.del, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'err'); } } });
    }
    async function openForm(row) {
      const fields = [
        { key: 'name', label: 'Nome', required: true }, { key: 'email', label: 'E-mail', type: 'email', required: true },
        { key: 'password', label: row ? 'Nova senha (opcional)' : 'Senha', type: 'password', required: !row },
        { key: 'role_id', label: 'Perfil de acesso', type: 'select', options: App.opt.roles },
        { key: 'phone', label: 'Telefone' }, { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] }
      ];
      if (state.user.is_super) fields.push({ key: 'org_id', label: 'Organização', type: 'select', options: App.opt.orgs });
      const r = await formModal({ title: (row ? 'Editar' : 'Novo') + ' Usuário', fields, values: row || { status: 'ativo' } });
      if (!r) return; if (!r.values.password) delete r.values.password;
      try { row ? await api('/users/' + row.id, { method: 'PUT', body: r.values }) : await api('/users', { method: 'POST', body: r.values }); toast('Salvo', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
    }
    if (document.getElementById('newBtn')) document.getElementById('newBtn').onclick = () => openForm(null);
    load();
  });

  /* ==================== PERFIS & PERMISSÕES ==================== */
  App.registerView('roles', async function (content) {
    const mods = await api('/modules');
    content.innerHTML = pageHead('Perfis & Permissões', (can('usuarios', 'include') ? '<button class="btn" id="newBtn">+ Novo Perfil</button>' : '')) +
      '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Perfil</th><th>Descrição</th><th class="num">Usuários</th><th>Tipo</th><th class="num">Ações</th></tr></thead><tbody id="rows"></tbody></table></div></div>';
    async function load() {
      const r = await api('/roles');
      document.getElementById('rows').innerHTML = r.data.map((x) => '<tr><td><b>' + esc(x.name) + '</b></td><td class="small muted">' + esc(x.description || '') + '</td><td class="num">' + x.user_count + '</td><td>' + (x.is_system ? '<span class="badge gray">Sistema</span>' : '<span class="badge brand">Personalizado</span>') + '</td><td class="num"><div class="row" style="justify-content:center;flex-wrap:nowrap">' + (can('usuarios', 'edit') ? '<button class="btn ghost sm" data-perm="' + x.id + '">Permissões</button>' : '') + (can('usuarios', 'delete') && !x.is_system ? '<button class="btn ghost sm" data-del="' + x.id + '">🗑</button>' : '') + '</div></td></tr>').join('');
      document.querySelectorAll('[data-perm]').forEach((b) => b.onclick = () => permEditor(r.data.find((x) => String(x.id) === b.dataset.perm), mods));
      document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirm('Excluir perfil?')) { try { await api('/roles/' + b.dataset.del, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, 'err'); } } });
    }
    if (document.getElementById('newBtn')) document.getElementById('newBtn').onclick = async () => {
      const r = await formModal({ title: 'Novo Perfil', fields: [{ key: 'name', label: 'Nome', required: true }, { key: 'description', label: 'Descrição', col: 2 }] });
      if (!r) return; try { await api('/roles', { method: 'POST', body: { name: r.values.name, description: r.values.description, permissions: {} } }); toast('Perfil criado', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
    };
    load();
  });

  function permEditor(role, mods) {
    const perms = role.permissions || {};
    const actions = mods.actions;
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    ov.innerHTML = '<div class="modal wide"><div class="modal-head"><h3>Permissões — ' + esc(role.name) + '</h3><button class="x-btn" data-x>&times;</button></div>' +
      '<div class="modal-body"><p class="small muted">Marque as ações permitidas por módulo.</p><div class="table-wrap"><table class="perm-table"><thead><tr><th>Módulo</th>' + actions.map((a) => '<th>' + esc(a) + '</th>').join('') + '</tr></thead><tbody>' +
      mods.modules.map((m) => '<tr><td>' + esc(m.label) + '</td>' + actions.map((a) => '<td><input type="checkbox" data-mod="' + m.key + '" data-act="' + a + '"' + ((perms[m.key] && perms[m.key][a]) ? ' checked' : '') + '></td>').join('') + '</tr>').join('') + '</tbody></table></div></div>' +
      '<div class="modal-foot"><button class="btn ghost" data-x>Cancelar</button><button class="btn" id="sgo">Salvar permissões</button></div></div>';
    document.body.appendChild(ov); ov.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => ov.remove());
    ov.querySelector('#sgo').onclick = async () => {
      const out = {};
      ov.querySelectorAll('input[type=checkbox]').forEach((c) => { if (c.checked) { out[c.dataset.mod] = out[c.dataset.mod] || {}; out[c.dataset.mod][c.dataset.act] = true; } });
      try { await api('/roles/' + role.id, { method: 'PUT', body: { permissions: out } }); toast('Permissões salvas', 'ok'); ov.remove(); App.route(); } catch (e) { toast(e.message, 'err'); }
    };
  }

  /* ==================== AUDITORIA ==================== */
  App.registerView('audit', async function (content) {
    content.innerHTML = pageHead('Auditoria') + '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>ID</th><th>IP</th></tr></thead><tbody id="rows"><tr><td colspan="6" class="muted center">Carregando…</td></tr></tbody></table></div></div>';
    const r = await api('/audit');
    document.getElementById('rows').innerHTML = r.length ? r.map((l) => '<tr><td class="small">' + (l.created_at || '') + '</td><td>' + esc(l.user_name || '') + '</td><td>' + esc(l.action) + '</td><td>' + esc(l.entity) + '</td><td>' + esc(l.entity_id || '') + '</td><td class="small muted">' + esc(l.ip || '') + '</td></tr>').join('') : '<tr><td colspan="6" class="muted center">Sem registros</td></tr>';
  });

  /* ==================== RELATÓRIOS ==================== */
  App.registerView('reports', async function (content) {
    content.innerHTML = pageHead('Relat\u00f3rios') +
      '<div class="card"><h3>Gerar relat\u00f3rio</h3><div class="grid3">' +
      '<div class="field"><label>Tipo</label><select id="rtype"><option value="standings">Classifica\u00e7\u00e3o</option><option value="scorers">Artilharia</option><option value="athletes">Atletas</option><option value="clubs">Clubes</option></select></div>' +
      '<div class="field"><label>Campeonato (classifica\u00e7\u00e3o/artilharia)</label><select id="rchamp"><option value="">\u2014</option>' + (state.refs.championships || []).map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Formato de download</label><select id="rformat"><option value="csv">CSV</option><option value="txt">TXT</option></select></div></div>' +
      '<div class="row"><button class="btn" id="rprev">\ud83d\udc41 Gerar pr\u00e9via</button><button class="btn ghost" id="rgo">\u2b07 Baixar relat\u00f3rio</button></div></div>' +
      '<div class="card" style="margin-top:1rem"><h3>Pr\u00e9via</h3><div id="rprevout"><p class="muted">Selecione um tipo e clique em \u201cGerar pr\u00e9via\u201d para visualizar os dados.</p></div></div>' +
      '<div class="card" style="margin-top:1rem"><h3>Exporta\u00e7\u00f5es r\u00e1pidas</h3><div class="row" id="rquick"></div></div>';

    document.getElementById('rquick').innerHTML =
      '<a class="btn ghost" href="' + App.authedUrl('/finance/export', { format: 'csv' }) + '" target="_blank">Financeiro CSV</a>' +
      '<a class="btn ghost" href="' + App.authedUrl('/finance/export', { format: 'txt' }) + '" target="_blank">Financeiro TXT</a>';

    const out = document.getElementById('rprevout');
    function params() {
      return { type: document.getElementById('rtype').value, championship_id: document.getElementById('rchamp').value, format: 'csv' };
    }
    function validate() {
      const t = document.getElementById('rtype').value; const c = document.getElementById('rchamp').value;
      if ((t === 'standings' || t === 'scorers') && !c) { toast('Selecione o campeonato', 'err'); return false; }
      return true;
    }
    document.getElementById('rprev').onclick = async () => {
      if (!validate()) return;
      out.innerHTML = '<p class="muted">Gerando\u2026</p>';
      try { const csv = await api('/finance/report?' + qs(params())); out.innerHTML = renderCSV(csv); }
      catch (e) { out.innerHTML = '<p class="muted">Erro: ' + esc(e.message) + '</p>'; }
    };
    document.getElementById('rgo').onclick = () => {
      if (!validate()) return;
      const p = params(); p.format = document.getElementById('rformat').value;
      window.open(App.authedUrl('/finance/report', p), '_blank');
    };
  });

})();
