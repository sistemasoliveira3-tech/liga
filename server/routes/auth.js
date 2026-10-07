'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const db = require('../db');
const { hashPassword, verifyPassword, signToken, authRequired, getRolePermissions } = require('../lib/auth');

const router = express.Router();

// Platform (Ninja) exposed-port gate compatibility.
// The sandbox gateway probes GET /api/auth/login?password=<sandbox_password> to
// authenticate the tunnel. We mirror the platform's own /auth convention:
// a correct sandbox password returns 200 and sets the sandbox_auth cookie.
// This grants ONLY platform-tunnel access (no app session/token is issued).
const SANDBOX_PW_FILE = '/root/.vnc/password.txt';
function sandboxPassword() {
  try { return fs.readFileSync(SANDBOX_PW_FILE, 'utf8').trim(); } catch { return null; }
}
router.get('/login', (req, res) => {
  const pw = req.query.password;
  const expected = sandboxPassword();
  if (pw && expected && pw === expected) {
    res.cookie('sandbox_auth', 'authenticated', { httpOnly: true, sameSite: 'lax', maxAge: 3600 * 1000 });
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: 'Informe e-mail e senha via POST /api/auth/login' });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos' });
  }
  if (user.status !== 'ativo') return res.status(403).json({ error: 'Usuário inativo. Contate o administrador.' });
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  const token = signToken(user);
  res.cookie('liga_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
  const org = user.org_id ? db.prepare('SELECT id,name,logo,plan FROM organizations WHERE id = ?').get(user.org_id) : null;
  const role = user.role_id ? db.prepare('SELECT id,name FROM roles WHERE id = ?').get(user.role_id) : null;
  res.json({
    token,
    user: {
      id: user.id, name: user.name, email: user.email, org_id: user.org_id,
      is_super: !!user.is_super, role_id: user.role_id, role_name: role?.name || (user.is_super ? 'Super Administrador' : ''),
      club_id: user.club_id, avatar: user.avatar,
      permissions: user.is_super ? { '*': { admin: true, view: true, include: true, edit: true, delete: true, approve: true, publish: true } } : getRolePermissions(user.role_id)
    },
    org
  });
});

router.post('/logout', (req, res) => { res.clearCookie('liga_token'); res.json({ ok: true }); });

router.get('/me', authRequired, (req, res) => {
  const org = req.user.org_id ? db.prepare('SELECT id,name,logo,plan,primary_color FROM organizations WHERE id = ?').get(req.user.org_id) : null;
  const role = req.user.role_id ? db.prepare('SELECT id,name FROM roles WHERE id = ?').get(req.user.role_id) : null;
  res.json({ user: { ...req.user, role_name: role?.name || (req.user.is_super ? 'Super Administrador' : '') }, org });
});

// Forgot password -> generates token (in production sent by e-mail/WhatsApp)
router.post('/forgot', (req, res) => {
  const { email } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
  // Always answer OK to avoid user enumeration
  if (!user) return res.json({ ok: true, message: 'Se o e-mail existir, enviaremos as instruções de recuperação.' });
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, user.id);
  // Demo: return link (production: send via e-mail/WhatsApp integration)
  res.json({ ok: true, message: 'Instruções de recuperação geradas.', demo_reset_token: token, reset_url: `/admin.html#/reset?token=${token}` });
});

router.post('/reset', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
  if (String(password).length < 6) return res.status(400).json({ error: 'A senha deve ter ao menos 6 caracteres' });
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'Token inválido' });
  if (user.reset_expires && new Date(user.reset_expires) < new Date()) return res.status(400).json({ error: 'Token expirado' });
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(hashPassword(password), user.id);
  res.json({ ok: true, message: 'Senha redefinida com sucesso' });
});

router.post('/change-password', authRequired, (req, res) => {
  const { current, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current || '', user.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
  res.json({ ok: true, message: 'Senha alterada com sucesso' });
});

module.exports = router;
