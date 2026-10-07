'use strict';
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'liga-dev-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
function verifyPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, org_id: user.org_id, is_super: !!user.is_super, role_id: user.role_id },
    JWT_SECRET, { expiresIn: JWT_EXPIRES }
  );
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// Collect candidate tokens from every transport we support. This makes auth
// survive reverse proxies / platform preview tunnels that may strip the
// Authorization header and/or cookies, OR that inject their own (unrelated)
// Authorization header which would otherwise shadow the app's real token.
function extractTokens(req) {
  const tokens = [];
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) tokens.push(h.slice(7).trim());
  if (req.headers['x-auth-token']) tokens.push(String(req.headers['x-auth-token']).trim());
  if (req.query && req.query.token) tokens.push(String(req.query.token).trim());
  if (req.cookies && req.cookies.liga_token) tokens.push(String(req.cookies.liga_token).trim());
  return tokens.filter(Boolean);
}

// Backwards-compatible single-token extractor (first candidate).
function extractToken(req) {
  const list = extractTokens(req);
  return list.length ? list[0] : null;
}

// Resolve the first candidate token that actually verifies against our secret.
// This is the key proxy-robustness fix: an injected/bogus Authorization header
// no longer shadows a valid token supplied via query string or cookie.
function resolvePayload(req) {
  for (const t of extractTokens(req)) {
    const payload = verifyToken(t);
    if (payload) return payload;
  }
  return null;
}

function getRolePermissions(roleId) {
  if (!roleId) return {};
  const r = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(roleId);
  if (!r) return {};
  try { return JSON.parse(r.permissions || '{}'); } catch { return {}; }
}

// Attach user to req from any supported transport
function authRequired(req, res, next) {
  const candidates = extractTokens(req);
  if (!candidates.length) return res.status(401).json({ error: 'N\u00e3o autenticado' });
  const payload = resolvePayload(req);
  if (!payload) return res.status(401).json({ error: 'Sess\u00e3o expirada ou inv\u00e1lida' });
  const user = db.prepare('SELECT id,name,email,org_id,role_id,is_super,status,club_id,avatar FROM users WHERE id = ?').get(payload.id);
  if (!user || user.status !== 'ativo') return res.status(401).json({ error: 'Usu\u00e1rio inativo' });
  user.permissions = user.is_super ? { '*': { admin: true, view: true, include: true, edit: true, delete: true, approve: true, publish: true } } : getRolePermissions(user.role_id);
  req.user = user;
  next();
}

function optionalAuth(req, res, next) {
  try {
    const payload = resolvePayload(req);
    if (payload) {
      const user = db.prepare('SELECT id,name,email,org_id,role_id,is_super,status FROM users WHERE id = ?').get(payload.id);
      if (user && user.status === 'ativo') {
        user.permissions = user.is_super ? { '*': { admin: true } } : getRolePermissions(user.role_id);
        req.user = user;
      }
    }
  } catch (e) { /* ignore */ }
  next();
}

// RBAC: check permission for module + action
function can(user, module, action) {
  if (!user) return false;
  if (user.is_super) return true;
  const perms = user.permissions || {};
  const all = perms['*'];
  if (all && (all.admin || all[action])) return true;
  const m = perms[module];
  if (!m) return false;
  if (m.admin) return true;
  return !!m[action];
}

function requirePermission(module, action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'N\u00e3o autenticado' });
    if (!can(req.user, module, action)) {
      return res.status(403).json({ error: `Sem permiss\u00e3o para ${action} em ${module}` });
    }
    next();
  };
}

function audit(req, action, entity, entityId, oldValue, newValue) {
  try {
    db.prepare(`INSERT INTO audit_logs (org_id,user_id,user_name,action,entity,entity_id,old_value,new_value,ip)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      req.user ? req.user.org_id : null,
      req.user ? req.user.id : null,
      req.user ? req.user.name : 'sistema',
      action, entity, entityId,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0]
    );
  } catch (e) { /* ignore */ }
}

module.exports = {
  hashPassword, verifyPassword, signToken, verifyToken,
  extractToken, extractTokens, resolvePayload,
  authRequired, optionalAuth, requirePermission, can, audit, getRolePermissions
};
