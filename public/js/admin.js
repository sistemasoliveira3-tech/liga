'use strict';
/* ============================================================
   Liga — Painel Administrativo (SPA)
   Core: auth, router, layout, helpers, CRUD genérico, dashboard
   ============================================================ */
(function () {
  // Derive the API base from the current path so the app works when served
  // under a reverse-proxy path prefix (e.g. /proxy/3000/admin).
  const API = (function () {
    const p = location.pathname.replace(/\/(admin\.html|admin|index\.html)?$/, '');
    return (p || '') + '/api';
  })();
  const App = (window.App = {});
  App.API = API; // expose the derived API base so downloads can be authenticated
  const state = (App.state = {
    token: localStorage.getItem('liga_token') || '',
    user: null, org: null, refs: {}, views: {}, refsLoaded: false
  });

  /* ---------------- utils ---------------- */
  const esc = (s) => (s === null || s === undefined ? '' : String(s)).replace(/[&<>"']/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
  const fmtMoney = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d) => { if (!d) return '—'; const s = String(d).slice(0, 10); const p = s.split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; };
  const fmtDateTime = (d) => { if (!d) return '—'; return fmtDate(d) + (String(d).length > 10 ? ' ' + String(d).slice(11, 16) : ''); };
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const optLabel = (arr, id, k) => { const x = (arr || []).find((r) => String(r.id) === String(id)); return x ? x[k || 'name'] : ''; };
  const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const img = (url, cls) => url ? '<img class="' + (cls || 'logo-sm') + '" src="' + esc(url) + '" alt="">' : '<span class="' + (cls || 'logo-sm') + '" style="display:inline-flex;align-items:center;justify-content:center;color:var(--brand);font-weight:700">⚽</span>';
  const avatar = (url, name) => url ? '<img class="avatar" src="' + esc(url) + '" alt="">' : '<span class="avatar" style="display:inline-flex;align-items:center;justify-content:center;color:var(--brand);font-weight:700;font-size:.72rem">' + esc(initials(name)) + '</span>';

  Object.assign(App, { esc, fmtMoney, fmtDate, fmtDateTime, qs, optLabel, img, avatar, initials });

  /* ---------------- api ---------------- */
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (state.token) { headers['Authorization'] = 'Bearer ' + state.token; headers['X-Auth-Token'] = state.token; }
    let body = opts.body;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    // Send the token also as a query param so auth survives reverse proxies that
    // strip the Authorization header / cookies (platform preview tunnels).
    let url = API + path;
    if (state.token) url += (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(state.token);
    const res = await fetch(url, { method: opts.method || 'GET', headers, body });
    const ct = res.headers.get('content-type') || '';
    let data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
    if (res.status === 401 && !opts.noRedirect) { logout(); throw new Error('Sessão expirada'); }
    if (!res.ok) throw new Error((data && data.error) || 'Erro na requisição');
    return data;
  }
  App.api = api;

  // Build an API URL that carries the auth token in the query string. Used for
  // downloads opened in a new tab (window.open) where custom headers and cookies
  // may be stripped by the platform preview tunnel.
  function authedUrl(path, params) {
    const q = Object.assign({}, params || {});
    if (state.token) q.token = state.token;
    return API + path + (Object.keys(q).length ? '?' + qs(q) : '');
  }
  App.authedUrl = authedUrl;

  /* ---------------- toast ---------------- */
  function toast(msg, type) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, 3400);
  }
  App.toast = toast;

  /* ---------------- permissions ---------------- */
  function can(mod, act) {
    const u = state.user; if (!u) return false;
    if (u.is_super) return true;
    const perms = u.permissions || {};
    const all = perms['*'];
    if (all && (all.admin || all[act])) return true;
    const m = perms[mod]; if (!m) return false;
    if (m.admin) return true;
    return !!m[act];
  }
  App.can = can;

  /* ---------------- modal ---------------- */
  function closeModal() { const o = document.querySelector('.modal-overlay'); if (o) o.remove(); }
  App.closeModal = closeModal;

  function confirmDialog(message, title) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = '<div class="modal" style="max-width:420px"><div class="modal-head"><h3>' + esc(title || 'Confirmar') + '</h3><button class="x-btn" data-x>&times;</button></div>' +
        '<div class="modal-body"><p>' + esc(message) + '</p></div>' +
        '<div class="modal-foot"><button class="btn ghost" data-x>Cancelar</button><button class="btn danger" id="cfm-ok">Confirmar</button></div></div>';
      document.body.appendChild(overlay);
      overlay.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => { overlay.remove(); resolve(false); });
      overlay.querySelector('#cfm-ok').onclick = () => { overlay.remove(); resolve(true); };
    });
  }
  App.confirm = confirmDialog;

  /* ---------------- form modal ---------------- */
  function resolveOptions(f) {
    let opts = typeof f.options === 'function' ? f.options() : (f.options || []);
    if (f.ref && state.refs[f.ref]) opts = state.refs[f.ref].map((r) => ({ value: r.id, label: r[f.refLabel || 'name'] }));
    if (f.type === 'state') opts = (state.refs.states || []).map((s) => ({ value: s.uf, label: s.name + ' (' + s.uf + ')' }));
    return opts;
  }
  function fieldHTML(f, v) {
    const val = (v[f.key] !== undefined && v[f.key] !== null) ? v[f.key] : (f.default !== undefined ? f.default : '');
    const span = f.col === 2 ? 'grid-column:span 2;' : '';
    const wrap = (inner) => '<div class="field" style="' + span + '">' + (f.label ? '<label>' + esc(f.label) + (f.required ? ' *' : '') + '</label>' : '') + inner + (f.help ? '<div class="small muted">' + esc(f.help) + '</div>' : '') + '</div>';
    if (f.type === 'textarea') return wrap('<textarea name="' + f.key + '"' + (f.required ? ' required' : '') + ' placeholder="' + esc(f.placeholder || '') + '">' + esc(val) + '</textarea>');
    if (f.type === 'select' || f.type === 'state') {
      const opts = resolveOptions(f);
      return wrap('<select name="' + f.key + '"' + (f.required ? ' required' : '') + '>' + (f.placeholder !== false ? '<option value="">— Selecione —</option>' : '') + opts.map((o) => '<option value="' + esc(o.value) + '"' + (String(o.value) === String(val) ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') + '</select>');
    }
    if (f.type === 'city') return wrap('<select name="' + f.key + '" data-city="' + (f.depends || 'state') + '"><option value="">— Selecione o estado —</option></select>');
    if (f.type === 'checkbox') return '<div class="field" style="' + span + '"><label style="display:flex;align-items:center;gap:.5rem;color:var(--ink)"><input type="checkbox" name="' + f.key + '" style="width:auto"' + (val ? ' checked' : '') + '> ' + esc(f.label) + '</label></div>';
    if (f.type === 'image') return wrap('<div class="row" style="align-items:center"><input type="file" name="' + f.key + '" accept="image/*" style="flex:1">' + (val ? '<img src="' + esc(val) + '" class="logo-sm">' : '') + '</div>');
    if (f.type === 'file') return wrap('<input type="file" name="' + f.key + '"' + (f.accept ? ' accept="' + f.accept + '"' : '') + '>');
    const t = f.type === 'money' || f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : (f.type === 'time' ? 'time' : (f.type === 'datetime' ? 'datetime-local' : (f.type === 'email' ? 'email' : (f.type === 'tel' ? 'tel' : (f.type === 'password' ? 'password' : 'text'))))));
    const step = f.type === 'money' ? ' step="0.01"' : '';
    return wrap('<input type="' + t + '" name="' + f.key + '" value="' + esc(val) + '"' + step + (f.required ? ' required' : '') + ' placeholder="' + esc(f.placeholder || '') + '">');
  }

  function formModal(opts) {
    return new Promise((resolve) => {
      const fields = opts.fields || [];
      const values = opts.values || {};
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = '<div class="modal ' + (opts.wide ? 'wide' : '') + '">' +
        '<div class="modal-head"><h3>' + esc(opts.title) + '</h3><button class="x-btn" data-x>&times;</button></div>' +
        '<form class="modal-body" id="mform"><div class="grid2">' + fields.map((f) => fieldHTML(f, values)).join('') + '</div></form>' +
        '<div class="modal-foot"><button class="btn ghost" data-x>Cancelar</button><button class="btn" id="msubmit">' + esc(opts.submitText || 'Salvar') + '</button></div></div>';
      document.body.appendChild(overlay);
      overlay.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => { overlay.remove(); resolve(null); });

      // state -> city dynamic
      const stateSel = overlay.querySelector('select[name="state"]');
      const citySel = overlay.querySelector('select[data-city]');
      async function loadCities(uf, sel) {
        if (!uf) { citySel.innerHTML = '<option value="">— Selecione o estado —</option>'; return; }
        citySel.innerHTML = '<option value="">Carregando…</option>';
        try { const cities = await api('/geo/cities?uf=' + encodeURIComponent(uf), { noRedirect: true }); citySel.innerHTML = '<option value="">— Selecione —</option>' + cities.map((c) => '<option value="' + esc(c.name) + '"' + (String(c.name) === String(sel) ? ' selected' : '') + '>' + esc(c.name) + '</option>').join(''); }
        catch (e) { citySel.innerHTML = '<option value="">' + esc(values.city || '') + '</option>'; }
      }
      if (stateSel && citySel) { stateSel.onchange = () => loadCities(stateSel.value, ''); if (values.state) loadCities(values.state, values.city); }

      overlay.querySelector('#msubmit').onclick = (ev) => {
        ev.preventDefault();
        doSubmit();
      };
      overlay.querySelector('#mform').onsubmit = (ev) => {
        ev.preventDefault();
        doSubmit();
      };
      function doSubmit() {
        const form = overlay.querySelector('#mform');
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const out = {}; const files = {};
        fields.forEach((f) => {
          if (f.type === 'image' || f.type === 'file') { const fl = form.querySelector('[name="' + f.key + '"]'); if (fl && fl.files && fl.files[0]) files[f.key] = fl.files[0]; return; }
          if (f.type === 'checkbox') { out[f.key] = form.querySelector('[name="' + f.key + '"]').checked ? 1 : 0; return; }
          let v = fd.get(f.key);
          if (v === '') v = null;
          out[f.key] = v;
        });
        overlay.remove();
        resolve({ values: out, files });
      }
    });
  }
  App.formModal = formModal;

  /* ---------------- refs ---------------- */
  async function loadRefs() {
    // Prefer a single bootstrap call (1 round-trip through the proxy instead of ~9).
    try {
      const b = await api('/bootstrap', { noRedirect: true });
      state.refs = {
        orgs: b.orgs || [], clubs: b.clubs || [], modalities: b.modalities || [],
        championships: b.championships || [], venues: b.venues || [], referees: b.referees || [],
        athletes: b.athletes || [], roles: b.roles || [], states: b.states || []
      };
      state.refsLoaded = true;
      return;
    } catch (e) { /* fall back to individual requests */ }
    const safe = (p) => api(p, { noRedirect: true }).catch(() => ({ data: [] }));
    const [orgs, clubs, mods, champs, venues, refs, athletes, roles, states] = await Promise.all([
      safe('/organizations'), safe('/clubs?limit=1000'), safe('/modalities?limit=1000'),
      safe('/championships?limit=1000'), safe('/venues?limit=1000'), safe('/referees?limit=1000'),
      safe('/athletes?limit=2000'), safe('/roles'), safe('/geo/states')
    ]);
    state.refs = {
      orgs: orgs.data || [], clubs: clubs.data || [], modalities: mods.data || [],
      championships: champs.data || [], venues: venues.data || [], referees: refs.data || [],
      athletes: athletes.data || [], roles: roles.data || [], states: Array.isArray(states) ? states : (states.data || [])
    };
    state.refsLoaded = true;
  }
  App.loadRefs = loadRefs;
  App.reloadRefs = () => { state.refsLoaded = false; return loadRefs(); };

  /* ---------------- views registry / router ---------------- */
  App.views = state.views;
  App.registerView = (key, fn) => { state.views[key] = fn; };
  App.go = (h) => { location.hash = h; };

  function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [key, ...rest] = hash.split('/');
    return { key: key || 'dashboard', param: rest.join('/'), query: Object.fromEntries(new URLSearchParams((hash.split('?')[1] || ''))) };
  }
  App.currentRoute = currentRoute;

  async function route() {
    if (!state.token) { renderLogin(); return; }
    if (!state.user) { try { await bootSession(); } catch (e) { return renderLogin(); } }
    if (!state.refsLoaded) { try { await loadRefs(); } catch (e) {} }
    const r = currentRoute();
    // redirect to an accessible view if the current one is not permitted
    const reqMod = VIEW_MODULE[r.key];
    if (reqMod && !can(reqMod, 'view') && r.key !== 'reset') {
      const fv = firstAccessibleView();
      if (fv && fv !== r.key) { location.hash = '#/' + fv; return; }
    }
    renderShell(r.key);
    const content = document.getElementById('admin-content');
    content.innerHTML = '<div class="card"><p class="muted">Carregando…</p></div>';
    const fn = state.views[r.key] || state.views.dashboard;
    try { await fn(content, r.param, r.query); }
    catch (e) { content.innerHTML = '<div class="card"><h3>Erro</h3><p class="muted">' + esc(e.message) + '</p></div>'; }
  }
  App.route = route;

  /* ---------------- auth ---------------- */
  async function bootSession() {
    const me = await api('/auth/me');
    state.user = me.user; state.org = me.org;
  }
  async function doLogin(email, password) {
    const r = await api('/auth/login', { method: 'POST', body: { email, password }, noRedirect: true });
    state.token = r.token; localStorage.setItem('liga_token', r.token);
    state.user = r.user; state.org = r.org; state.refsLoaded = false;
    await loadRefs();
    location.hash = '#/' + firstAccessibleView();
    route();
  }
  async function logout() {
    try { await api('/auth/logout', { method: 'POST', noRedirect: true }); } catch (e) {}
    state.token = ''; state.user = null; state.org = null; localStorage.removeItem('liga_token');
    renderLogin();
  }
  App.logout = logout;

  function renderLogin() {
    const root = document.getElementById('root');
    root.innerHTML = '<div class="login-wrap"><div class="login-card">' +
      '<div class="login-logo">⚽</div>' +
      '<h2 class="center" style="margin-bottom:.2rem">Liga</h2>' +
      '<p class="center muted small" style="margin-bottom:1.2rem">Plataforma de Gestão Esportiva</p>' +
      '<div class="tabs" style="justify-content:center"><button class="active" data-tab="login">Entrar</button><button data-tab="forgot">Recuperar senha</button></div>' +
      '<form id="loginForm">' +
        '<div class="field"><label>E-mail</label><input type="email" name="email" required placeholder="seu@email.com" value="admin@liga.com"></div>' +
        '<div class="field"><label>Senha</label><input type="password" name="password" required placeholder="••••••" value="admin123"></div>' +
        '<button class="btn block" type="submit">Entrar</button>' +
      '</form>' +
      '<form id="forgotForm" class="hidden">' +
        '<div class="field"><label>E-mail cadastrado</label><input type="email" name="email" required placeholder="seu@email.com"></div>' +
        '<button class="btn block" type="submit">Enviar instruções</button>' +
        '<div id="forgotMsg" class="small muted" style="margin-top:.6rem"></div>' +
      '</form>' +
      '<p class="center small muted" style="margin-top:1rem"><a href="/">← Voltar ao portal do torcedor</a></p>' +
      '<div class="small muted center" style="margin-top:1rem;border-top:1px solid var(--line);padding-top:.8rem">Demo: <b>admin@liga.com</b> / <b>admin123</b></div>' +
      '</div></div>';
    const tabs = root.querySelectorAll('.tabs button');
    tabs.forEach((t) => t.onclick = () => {
      tabs.forEach((x) => x.classList.remove('active')); t.classList.add('active');
      root.querySelector('#loginForm').classList.toggle('hidden', t.dataset.tab !== 'login');
      root.querySelector('#forgotForm').classList.toggle('hidden', t.dataset.tab !== 'forgot');
    });
    const loginForm = root.querySelector('#loginForm');
    const submitLogin = async () => {
      const fd = new FormData(loginForm);
      try { await doLogin(fd.get('email'), fd.get('password')); toast('Bem-vindo!', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    };
    loginForm.onsubmit = async (e) => { e.preventDefault(); await submitLogin(); };
    const loginBtn = loginForm.querySelector('button[type="submit"]');
    if (loginBtn) loginBtn.onclick = async (e) => { e.preventDefault(); await submitLogin(); };
    root.querySelector('#forgotForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const r = await api('/auth/forgot', { method: 'POST', body: { email: fd.get('email') }, noRedirect: true });
        root.querySelector('#forgotMsg').innerHTML = esc(r.message) + (r.demo_reset_token ? '<br><br><b>Demo — link de redefinição:</b><br><a href="' + esc(r.reset_url) + '">' + esc(r.reset_url) + '</a>' : '');
      } catch (err) { toast(err.message, 'err'); }
    };
  }
  App.renderLogin = renderLogin;

  function renderReset(token) {
    const root = document.getElementById('root');
    root.innerHTML = '<div class="login-wrap"><div class="login-card">' +
      '<div class="login-logo">🔑</div><h2 class="center">Redefinir senha</h2>' +
      '<form id="resetForm"><div class="field"><label>Nova senha</label><input type="password" name="password" required minlength="6"></div>' +
      '<button class="btn block" type="submit">Salvar nova senha</button></form>' +
      '<p class="center small muted" style="margin-top:1rem"><a href="#/dashboard">Ir para o login</a></p></div></div>';
    root.querySelector('#resetForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { await api('/auth/reset', { method: 'POST', body: { token, password: fd.get('password') }, noRedirect: true }); toast('Senha redefinida! Faça login.', 'ok'); location.hash = ''; renderLogin(); }
      catch (err) { toast(err.message, 'err'); }
    };
  }
  App.renderReset = renderReset;

  /* ---------------- shell ---------------- */
  const NAV = [
    { group: 'Visão Geral', items: [['dashboard', 'Dashboard', '📊', 'relatorios']] },
    { group: 'Cadastros', items: [
      ['organizations', 'Organizações / Liga', '🏛️', 'organizacoes'],
      ['modalities', 'Modalidades', '🏅', 'modalidades'],
      ['clubs', 'Clubes', '🛡️', 'clubes'],
      ['athletes', 'Atletas', '🧍', 'atletas'],
      ['referees', 'Arbitragem', '🧑‍⚖️', 'arbitragem'],
      ['venues', 'Locais / Estádios', '🏟️', 'disputas']
    ] },
    { group: 'Competição', items: [
      ['championships', 'Campeonatos', '🏆', 'campeonatos'],
      ['matches', 'Partidas', '⚽', 'partidas'],
      ['sumula', 'Súmula Digital', '📝', 'sumula'],
      ['standings', 'Classificação', '📋', 'campeonatos'],
      ['stats', 'Estatísticas', '📈', 'campeonatos']
    ] },
    { group: 'Financeiro & Gestão', items: [
      ['transfers', 'Transferências', '🔁', 'transferencias'],
      ['finance', 'Financeiro', '💰', 'financeiro'],
      ['sponsors', 'Patrocinadores', '🤝', 'financeiro'],
      ['tickets', 'Ingressos', '🎟️', 'financeiro']
    ] },
    { group: 'Publicações', items: [
      ['news', 'Notícias', '📰', 'publicacoes'],
      ['photos', 'Fotos', '🖼️', 'publicacoes'],
      ['videos', 'Vídeos', '🎬', 'publicacoes'],
      ['streams', 'Transmissões', '📡', 'publicacoes'],
      ['polls', 'Enquetes', '🗳️', 'enquetes']
    ] },
    { group: 'Administração', items: [
      ['users', 'Usuários', '👥', 'usuarios'],
      ['roles', 'Perfis & Permissões', '🔐', 'usuarios'],
      ['audit', 'Auditoria', '🧾', 'relatorios'],
      ['reports', 'Relatórios', '📄', 'relatorios']
    ] }
  ];

  // map view key -> required module (from NAV)
  const VIEW_MODULE = {};
  NAV.forEach((g) => g.items.forEach(([k, , , mod]) => { VIEW_MODULE[k] = mod; }));
  function firstAccessibleView() {
    for (const g of NAV) for (const [key, , , mod] of g.items) if (can(mod, 'view')) return key;
    return 'dashboard';
  }
  App.firstAccessibleView = firstAccessibleView;

  function renderShell(activeKey) {
    const root = document.getElementById('root');
    if (!document.getElementById('admin-shell')) {
      const navHTML = NAV.map((g) => {
        const items = g.items.filter(([, , , mod]) => can(mod, 'view'));
        if (!items.length) return '';
        return '<div class="grp">' + esc(g.group) + '</div>' + items.map(([k, label, ic]) => '<a href="#/' + k + '" data-nav="' + k + '"><span class="ic">' + ic + '</span>' + esc(label) + '</a>').join('');
      }).join('');
      const u = state.user || {};
      root.innerHTML = '<div class="admin-shell" id="admin-shell">' +
        '<div class="overlay-side" id="sideOverlay"></div>' +
        '<aside class="sidebar" id="sidebar"><div class="brand"><img src="' + esc((state.org && state.org.logo) || '') + '" onerror="this.style.display=\'none\'"><span>' + esc((state.org && state.org.name) || 'Liga') + '</span></div>' +
        '<nav>' + navHTML + '</nav>' +
        '<div style="padding:.8rem;border-top:1px solid rgba(255,255,255,.12);font-size:.78rem;color:#9fc4b6"><a href="/" style="color:#f4a300">↗ Portal do torcedor</a></div></aside>' +
        '<div class="admin-main"><header class="admin-top"><button class="btn ghost sm menu-toggle" id="menuToggle">☰</button>' +
        '<div><div style="font-weight:700">Painel Administrativo</div><div class="small muted" id="topSub"></div></div>' +
        '<div class="who"><span class="badge brand">' + esc(u.role_name || (u.is_super ? 'Super Admin' : '')) + '</span>' + avatar(u.avatar, u.name) + '<div><div style="font-weight:600">' + esc(u.name || '') + '</div><div class="small muted">' + esc(u.email || '') + '</div></div>' +
        '<button class="btn ghost sm" id="pwBtn" title="Alterar senha">🔑</button><button class="btn ghost sm" id="logoutBtn">Sair</button></div></header>' +
        '<main class="admin-content" id="admin-content"></main></div></div>';
      document.getElementById('logoutBtn').onclick = logout;
      document.getElementById('pwBtn').onclick = changePassword;
      const sb = document.getElementById('sidebar'), ov = document.getElementById('sideOverlay');
      document.getElementById('menuToggle').onclick = () => { sb.classList.add('open'); ov.style.display = 'block'; };
      ov.onclick = () => { sb.classList.remove('open'); ov.style.display = 'none'; };
    }
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === activeKey));
    const sub = document.getElementById('topSub');
    if (sub) sub.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }
  App.renderShell = renderShell;

  async function changePassword() {
    const r = await formModal({
      title: 'Alterar senha', submitText: 'Salvar',
      fields: [{ key: 'current', label: 'Senha atual', type: 'password', required: true }, { key: 'password', label: 'Nova senha', type: 'password', required: true, help: 'Mínimo 6 caracteres' }]
    });
    if (!r) return;
    try { await api('/auth/change-password', { method: 'POST', body: r.values }); toast('Senha alterada!', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- generic CRUD ---------------- */
  function pageHead(title, actionsHTML) {
    return '<div class="page-head"><h1>' + esc(title) + '</h1><div class="row">' + (actionsHTML || '') + '</div></div>';
  }
  App.pageHead = pageHead;

  function genericCRUD(cfg) {
    return async function (content, param) {
      const listId = 'list_' + cfg.key;
      content.innerHTML = pageHead(cfg.title, (can(cfg.module, 'include') ? '<button class="btn" id="newBtn">+ Novo</button>' : '')) +
        '<div class="toolbar">' + (cfg.search !== false ? '<input id="q" placeholder="Buscar…" style="min-width:220px">' : '') +
        (cfg.filters || []).map((f) => '<select id="f_' + f.key + '"><option value="">' + esc(f.label) + '</option>' + f.options.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>').join('') + '</select>').join('') +
        '<span class="spacer"></span><span class="chip" id="cnt"></span></div>' +
        '<div class="card pad0"><div class="table-wrap"><table class="data"><thead><tr>' + cfg.columns.map((c) => '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>').join('') + '<th class="num">Ações</th></tr></thead><tbody id="' + listId + '"><tr><td colspan="' + (cfg.columns.length + 1) + '" class="muted center">Carregando…</td></tr></tbody></table></div></div>';

      const tbody = document.getElementById(listId);
      async function load() {
        const q = document.getElementById('q');
        const params = { q: q ? q.value : '', limit: 500 };
        (cfg.filters || []).forEach((f) => { const el = document.getElementById('f_' + f.key); if (el && el.value) params[f.key] = el.value; });
        try {
          const r = await api(cfg.endpoint + '?' + qs(params));
          const rows = r.data || r;
          document.getElementById('cnt').textContent = (r.total || rows.length) + ' registro(s)';
          if (!rows.length) { tbody.innerHTML = '<tr><td colspan="' + (cfg.columns.length + 1) + '" class="muted center">Nenhum registro</td></tr>'; return; }
          tbody.innerHTML = rows.map((row) => '<tr>' + cfg.columns.map((c) => '<td' + (c.num ? ' class="num"' : '') + '>' + (c.render ? c.render(row) : esc(row[c.key])) + '</td>').join('') +
            '<td class="num"><div class="row" style="justify-content:center;flex-wrap:nowrap">' +
            (cfg.detail ? '<button class="btn ghost sm" data-view="' + row.id + '">Ver</button>' : '') +
            (can(cfg.module, 'edit') ? '<button class="btn ghost sm" data-edit="' + row.id + '">✎</button>' : '') +
            (can(cfg.module, 'delete') ? '<button class="btn ghost sm" data-del="' + row.id + '">🗑</button>' : '') +
            '</div></td></tr>').join('');
          tbody.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => cfg.detail(b.dataset.view));
          tbody.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openForm(rows.find((x) => String(x.id) === b.dataset.edit)));
          tbody.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirmDialog('Excluir este registro?')) { try { await api(cfg.endpoint + '/' + b.dataset.del, { method: 'DELETE' }); toast('Excluído', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } } });
        } catch (e) { tbody.innerHTML = '<tr><td colspan="' + (cfg.columns.length + 1) + '" class="muted center">' + esc(e.message) + '</td></tr>'; }
      }
      async function openForm(row) {
        const r = await formModal({ title: (row ? 'Editar ' : 'Novo ') + cfg.title, fields: cfg.fields, values: row || cfg.defaults || {}, wide: cfg.wide });
        if (!r) return;
        try {
          const saved = row ? await api(cfg.endpoint + '/' + row.id, { method: 'PUT', body: r.values }) : await api(cfg.endpoint, { method: 'POST', body: r.values });
          const id = saved.id || (row && row.id);
          for (const [field, file] of Object.entries(r.files)) {
            const fd = new FormData(); fd.append('file', file); fd.append('entity', cfg.entity || cfg.key); fd.append('entity_id', id); fd.append('field', field);
            const up = await api('/upload/image', { method: 'POST', body: fd });
            if (up && up.url) { try { const patch = {}; patch[field] = up.url; await api(cfg.endpoint + '/' + id, { method: 'PUT', body: patch }); } catch (e) {} }
          }
          toast('Salvo com sucesso', 'ok'); App.reloadRefs(); load();
        } catch (e) { toast(e.message, 'err'); }
      }
      if (document.getElementById('newBtn')) document.getElementById('newBtn').onclick = () => openForm(null);
      if (document.getElementById('q')) document.getElementById('q').oninput = debounce(load, 350);
      (cfg.filters || []).forEach((f) => { const el = document.getElementById('f_' + f.key); if (el) el.onchange = load; });
      load();
    };
  }
  App.genericCRUD = genericCRUD;

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  App.debounce = debounce;

  /* ---------------- dashboard ---------------- */
  App.registerView('dashboard', async function (content) {
    const d = await api('/dashboard');
    const s = d.stats;
    const stat = (k, v, i) => '<div class="stat"><span class="i">' + i + '</span><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
    const maxGoals = Math.max(1, ...d.goalsByMonth.map((x) => x.gols || 0));
    const chart = d.goalsByMonth.length ? '<div class="row" style="align-items:flex-end;gap:1rem;height:180px;padding-top:1rem">' +
      d.goalsByMonth.map((m) => '<div style="flex:1;text-align:center"><div style="background:linear-gradient(var(--brand),var(--brand-700));height:' + Math.round((m.gols / maxGoals) * 140) + 'px;border-radius:6px 6px 0 0;min-height:4px" title="' + m.gols + ' gols"></div><div class="small muted" style="margin-top:.3rem">' + esc((m.mes || '').slice(5)) + '</div><div class="small" style="font-weight:700">' + m.gols + '</div></div>').join('') + '</div>' : '<p class="muted">Sem dados.</p>';
    const fin = d.financeByMonth.length ? d.financeByMonth.map((m) => '<tr><td>' + esc(m.mes) + '</td><td class="num" style="color:var(--ok)">' + fmtMoney(m.receita) + '</td><td class="num" style="color:var(--danger)">' + fmtMoney(m.despesa) + '</td><td class="num"><b>' + fmtMoney(m.receita - m.despesa) + '</b></td></tr>').join('') : '<tr><td colspan="4" class="muted center">Sem dados</td></tr>';

    content.innerHTML = pageHead('Dashboard') +
      '<div class="stats">' + stat('Campeonatos ativos', s.championships_active, '🏆') + stat('Clubes', s.clubs, '🛡️') + stat('Atletas', s.athletes, '🧍') + stat('Partidas', s.matches, '⚽') + stat('Gols', s.goals, '🥅') + stat('Cartões', s.cards, '🟨') + stat('Usuários', s.users, '👥') + stat('Saldo', fmtMoney(s.balance), '💰') + '</div>' +
      '<div class="grid2" style="margin-top:1.2rem">' +
        '<div class="card"><h3>Gols por mês</h3>' + chart + '</div>' +
        '<div class="card"><h3>Receita x Despesa</h3><table class="data"><thead><tr><th>Mês</th><th class="num">Receita</th><th class="num">Despesa</th><th class="num">Saldo</th></tr></thead><tbody>' + fin + '</tbody></table></div>' +
      '</div>' +
      '<div class="grid2" style="margin-top:1.2rem">' +
        '<div class="card"><h3>Partidas recentes</h3><table class="data"><tbody>' + (d.recentMatches.length ? d.recentMatches.map((m) => '<tr><td>' + fmtDate(m.match_date) + '</td><td>' + esc(m.home_name || '') + ' <b>' + (m.home_score ?? '-') + ' x ' + (m.away_score ?? '-') + '</b> ' + esc(m.away_name || '') + '</td><td class="small muted">' + esc(m.champ_name || '') + '</td></tr>').join('') : '<tr><td class="muted">Sem partidas</td></tr>') + '</tbody></table></div>' +
        '<div class="card"><h3>Artilharia</h3><table class="data"><thead><tr><th>Atleta</th><th>Clube</th><th class="num">Gols</th></tr></thead><tbody>' + (d.topScorers.length ? d.topScorers.map((t) => '<tr><td>' + esc(t.nickname || t.name) + '</td><td class="small muted">' + esc(t.club || '') + '</td><td class="num"><b>' + t.gols + '</b></td></tr>').join('') : '<tr><td colspan="3" class="muted center">Sem gols</td></tr>') + '</tbody></table></div>' +
      '</div>';
  });

  /* ---------------- simple CRUD registrations ---------------- */
  const orgOptions = () => (state.refs.orgs || []).map((o) => ({ value: o.id, label: o.name }));
  const champOptions = () => (state.refs.championships || []).map((c) => ({ value: c.id, label: c.name + (c.season ? ' ' + c.season : '') }));
  const clubOptions = () => (state.refs.clubs || []).map((c) => ({ value: c.id, label: c.name }));
  const modOptions = () => (state.refs.modalities || []).map((m) => ({ value: m.id, label: m.name }));
  const matchOptions = () => (state.refs.matches || []).map((m) => ({ value: m.id, label: m.home_name + ' x ' + m.away_name }));
  App.opt = {
    orgs: orgOptions, clubs: clubOptions, modalities: modOptions,
    championships: champOptions, matches: matchOptions,
    venues: () => (state.refs.venues || []).map((v) => ({ value: v.id, label: v.name })),
    referees: () => (state.refs.referees || []).map((x) => ({ value: x.id, label: x.name })),
    athletes: () => (state.refs.athletes || []).map((a) => ({ value: a.id, label: a.name + (a.club_name ? ' (' + a.club_name + ')' : '') })),
    roles: () => (state.refs.roles || []).map((x) => ({ value: x.id, label: x.name }))
  };

  App.registerView('organizations', genericCRUD({
    key: 'organizations', title: 'Organizações / Liga', endpoint: '/organizations', module: 'organizacoes', entity: 'organizations',
    columns: [
      { label: 'Logo', render: (r) => img(r.logo, 'logo-sm') },
      { label: 'Nome', render: (r) => '<b>' + esc(r.name) + '</b><div class="small muted">' + esc(r.type || '') + '</div>' },
      { label: 'Cidade/UF', render: (r) => esc((r.city || '') + (r.state ? '/' + r.state : '')) },
      { label: 'Responsável', key: 'responsible' },
      { label: 'Telefone', key: 'phone' },
      { label: 'Plano', render: (r) => '<span class="badge brand">' + esc(r.plan || 'basico') + '</span>' },
      { label: 'Status', render: (r) => '<span class="badge ' + (r.status === 'ativo' ? 'ok' : 'gray') + '">' + esc(r.status || '') + '</span>' }
    ],
    fields: [
      { key: 'name', label: 'Nome', required: true }, { key: 'type', label: 'Tipo', type: 'select', options: ['Liga', 'Federação', 'Associação', 'Clube', 'Outro'].map((x) => ({ value: x, label: x })) },
      { key: 'cnpj', label: 'CNPJ' }, { key: 'responsible', label: 'Responsável' },
      { key: 'state', label: 'Estado (UF)', type: 'state' }, { key: 'city', label: 'Cidade', type: 'city' },
      { key: 'address', label: 'Endereço', col: 2 }, { key: 'district', label: 'Bairro' }, { key: 'zip', label: 'CEP' },
      { key: 'phone', label: 'Telefone' }, { key: 'email', label: 'E-mail', type: 'email' },
      { key: 'website', label: 'Site' }, { key: 'social', label: 'Redes sociais' },
      { key: 'plan', label: 'Plano', type: 'select', options: ['basico', 'pro', 'profissional'].map((x) => ({ value: x, label: x })) },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] },
      { key: 'primary_color', label: 'Cor principal', type: 'text' }, { key: 'logo', label: 'Logo', type: 'image' }
    ]
  }));

  App.registerView('modalities', genericCRUD({
    key: 'modalities', title: 'Modalidades', endpoint: '/modalities', module: 'modalidades', entity: 'modalities',
    columns: [{ label: 'Ícone', render: (r) => '<span style="font-size:1.3rem">' + esc(r.icon || '🏅') + '</span>' }, { label: 'Nome', render: (r) => '<b>' + esc(r.name) + '</b>' }, { label: 'Tipo', key: 'sport_type' }, { label: 'Status', render: (r) => '<span class="badge ' + (r.status === 'ativo' ? 'ok' : 'gray') + '">' + esc(r.status || '') + '</span>' }],
    fields: [{ key: 'name', label: 'Nome', required: true }, { key: 'icon', label: 'Ícone (emoji)' }, { key: 'sport_type', label: 'Tipo de esporte' }, { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] }]
  }));

  App.registerView('clubs', genericCRUD({
    key: 'clubs', title: 'Clubes', endpoint: '/clubs', module: 'clubes', entity: 'clubs',
    filters: [{ key: 'status', label: 'Status', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] }],
    columns: [
      { label: 'Escudo', render: (r) => img(r.logo, 'logo-sm') },
      { label: 'Clube', render: (r) => '<b>' + esc(r.name) + '</b><div class="small muted">' + esc(r.short_name || '') + '</div>' },
      { label: 'Cidade/UF', render: (r) => esc((r.city || '') + (r.state ? '/' + r.state : '')) },
      { label: 'Liga', render: (r) => esc(optLabel(state.refs.orgs, r.league_id)) },
      { label: 'Responsável', key: 'responsible' }, { label: 'Telefone', key: 'phone' },
      { label: 'Status', render: (r) => '<span class="badge ' + (r.status === 'ativo' ? 'ok' : 'gray') + '">' + esc(r.status || '') + '</span>' }
    ],
    fields: [
      { key: 'name', label: 'Nome', required: true }, { key: 'short_name', label: 'Abreviatura' },
      { key: 'league_id', label: 'Liga', type: 'select', options: App.opt.orgs }, { key: 'founded', label: 'Fundação', type: 'date' },
      { key: 'state', label: 'Estado (UF)', type: 'state' }, { key: 'city', label: 'Cidade', type: 'city' },
      { key: 'address', label: 'Endereço', col: 2 }, { key: 'district', label: 'Bairro' }, { key: 'zip', label: 'CEP' },
      { key: 'responsible', label: 'Responsável' }, { key: 'phone', label: 'Telefone' },
      { key: 'email', label: 'E-mail', type: 'email' }, { key: 'website', label: 'Site' }, { key: 'social', label: 'Redes sociais' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] },
      { key: 'logo', label: 'Escudo', type: 'image' }
    ]
  }));

  App.registerView('referees', genericCRUD({
    key: 'referees', title: 'Arbitragem', endpoint: '/referees', module: 'arbitragem', entity: 'referees',
    filters: [{ key: 'role', label: 'Função', options: ['Árbitro', 'Árbitro Assistente', 'Quarto Árbitro', 'Delegado'].map((x) => ({ value: x, label: x })) }],
    columns: [
      { label: 'Foto', render: (r) => avatar(r.photo, r.name) },
      { label: 'Nome', render: (r) => '<b>' + esc(r.name) + '</b>' },
      { label: 'Função', key: 'role' }, { label: 'Cidade/UF', render: (r) => esc((r.city || '') + (r.state ? '/' + r.state : '')) },
      { label: 'Nível', key: 'level' }, { label: 'Telefone', key: 'phone' },
      { label: 'Status', render: (r) => '<span class="badge ' + (r.status === 'ativo' ? 'ok' : 'gray') + '">' + esc(r.status || '') + '</span>' }
    ],
    fields: [
      { key: 'name', label: 'Nome', required: true }, { key: 'role', label: 'Função', type: 'select', options: ['Árbitro', 'Árbitro Assistente', 'Quarto Árbitro', 'Delegado'].map((x) => ({ value: x, label: x })) },
      { key: 'document', label: 'Documento/RG' }, { key: 'cpf', label: 'CPF' }, { key: 'level', label: 'Nível' },
      { key: 'state', label: 'Estado (UF)', type: 'state' }, { key: 'city', label: 'Cidade', type: 'city' },
      { key: 'phone', label: 'Telefone' }, { key: 'email', label: 'E-mail', type: 'email' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] },
      { key: 'photo', label: 'Foto', type: 'image' }
    ]
  }));

  App.registerView('venues', genericCRUD({
    key: 'venues', title: 'Locais / Estádios', endpoint: '/venues', module: 'disputas', entity: 'venues',
    columns: [{ label: 'Nome', render: (r) => '<b>' + esc(r.name) + '</b>' }, { label: 'Cidade/UF', render: (r) => esc((r.city || '') + (r.state ? '/' + r.state : '')) }, { label: 'Capacidade', key: 'capacity', num: true }, { label: 'Piso', key: 'field_type' }, { label: 'Contato', key: 'contact' }, { label: 'Status', render: (r) => '<span class="badge ' + (r.status === 'ativo' ? 'ok' : 'gray') + '">' + esc(r.status || '') + '</span>' }],
    fields: [
      { key: 'name', label: 'Nome', required: true }, { key: 'capacity', label: 'Capacidade', type: 'number' },
      { key: 'field_type', label: 'Tipo de piso' }, { key: 'contact', label: 'Contato' },
      { key: 'state', label: 'Estado (UF)', type: 'state' }, { key: 'city', label: 'Cidade', type: 'city' },
      { key: 'address', label: 'Endereço', col: 2 }, { key: 'availability', label: 'Disponibilidade' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] }
    ]
  }));

  App.registerView('sponsors', genericCRUD({
    key: 'sponsors', title: 'Patrocinadores', endpoint: '/sponsors', module: 'financeiro', entity: 'sponsors',
    columns: [{ label: 'Logo', render: (r) => img(r.logo, 'logo-sm') }, { label: 'Empresa', render: (r) => '<b>' + esc(r.company) + '</b>' }, { label: 'Campeonato', render: (r) => esc(optLabel(state.refs.championships, r.championship_id)) }, { label: 'Valor', render: (r) => fmtMoney(r.contract_value), num: true }, { label: 'Vigência', render: (r) => fmtDate(r.start_date) + ' — ' + fmtDate(r.end_date) }, { label: 'Status', render: (r) => '<span class="badge ' + (r.status === 'ativo' ? 'ok' : 'gray') + '">' + esc(r.status || '') + '</span>' }],
    fields: [
      { key: 'company', label: 'Empresa', required: true }, { key: 'championship_id', label: 'Campeonato', type: 'select', options: App.opt.championships },
      { key: 'contract_value', label: 'Valor do contrato', type: 'money' }, { key: 'placements', label: 'Placas/Exibições' },
      { key: 'start_date', label: 'Início', type: 'date' }, { key: 'end_date', label: 'Fim', type: 'date' },
      { key: 'website', label: 'Site' }, { key: 'social', label: 'Redes sociais' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] },
      { key: 'logo', label: 'Logo', type: 'image' }
    ]
  }));

  App.registerView('tickets', genericCRUD({
    key: 'tickets', title: 'Ingressos', endpoint: '/tickets', module: 'financeiro', entity: 'tickets',
    columns: [{ label: 'Partida', render: (r) => esc(optLabel(state.refs.matches || [], r.match_id, 'label')) }, { label: 'Lote', key: 'lot' }, { label: 'Preço', render: (r) => fmtMoney(r.price), num: true }, { label: 'Qtd', key: 'quantity', num: true }, { label: 'Vendidos', key: 'sold', num: true }, { label: 'Status', render: (r) => '<span class="badge ' + (r.status === 'ativo' ? 'ok' : 'gray') + '">' + esc(r.status || '') + '</span>' }],
    fields: [
      { key: 'match_id', label: 'ID da Partida', type: 'number', help: 'Informe o ID da partida' }, { key: 'lot', label: 'Lote', required: true },
      { key: 'price', label: 'Preço', type: 'money' }, { key: 'quantity', label: 'Quantidade', type: 'number' }, { key: 'sold', label: 'Vendidos', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'encerrado', label: 'Encerrado' }] }
    ]
  }));

  /* ---------------- boot ---------------- */
  async function boot() {
    const r = currentRoute();
    if (r.key === 'reset' && r.query.token) { renderReset(r.query.token); return; }
    if (state.token) { try { await bootSession(); } catch (e) { state.token = ''; localStorage.removeItem('liga_token'); } }
    if (!state.user) { renderLogin(); return; }
    try { await loadRefs(); } catch (e) {}
    route();
  }
  App.boot = boot;
  window.addEventListener('hashchange', () => { if (state.user) route(); });
  window.addEventListener('DOMContentLoaded', boot);
})();
