'use strict';
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requirePermission, audit } = require('../lib/auth');
const { uploadAny } = require('../lib/upload');
const engine = require('../lib/engine');

const router = express.Router();

function orgScope(req) { return req.user.org_id ? 'AND org_id = ' + Number(req.user.org_id) : ''; }

router.get('/summary', requirePermission('financeiro', 'view'), (req, res) => {
  const o = orgScope(req);
  const revenue = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='receita' ${o}`).get().s;
  const expense = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type='despesa' ${o}`).get().s;
  const byCategory = db.prepare(`SELECT type, category, COALESCE(SUM(amount),0) total, COUNT(*) qtd FROM transactions WHERE 1=1 ${o} GROUP BY type, category ORDER BY total DESC`).all();
  const byMonth = db.prepare(`SELECT substr(date,1,7) mes, SUM(CASE WHEN type='receita' THEN amount ELSE 0 END) receita, SUM(CASE WHEN type='despesa' THEN amount ELSE 0 END) despesa FROM transactions WHERE 1=1 ${o} GROUP BY mes ORDER BY mes`).all();
  const pending = db.prepare(`SELECT * FROM transactions WHERE status!='pago' ${o} ORDER BY due_date LIMIT 50`).all();
  res.json({ revenue, expense, balance: revenue - expense, byCategory, byMonth, pending });
});

router.post('/payments', requirePermission('financeiro', 'include'), (req, res) => {
  const { transaction_id, method } = req.body;
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transaction_id);
  if (!t) return res.status(404).json({ error: 'Transação não encontrada' });
  const barcode = '34191' + String(Date.now()).slice(-10) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  const pix = crypto.randomBytes(20).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  const info = db.prepare('INSERT INTO payments (org_id,transaction_id,amount,method,status,boleto_url,pix_code) VALUES (?,?,?,?,?,?,?)')
    .run(t.org_id, t.id, t.amount, method || 'PIX', 'pendente', barcode, pix);
  res.status(201).json(db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/payments/:id/confirm', requirePermission('financeiro', 'approve'), (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Pagamento não encontrado' });
  db.prepare("UPDATE payments SET status='pago', paid_at=datetime('now') WHERE id=?").run(p.id);
  db.prepare("UPDATE transactions SET status='pago' WHERE id=?").run(p.transaction_id);
  audit(req, 'confirmar_pagamento', 'payments', p.id, null, null);
  res.json({ ok: true });
});

router.post('/documents', requirePermission('financeiro', 'include'), uploadAny('finance').single('file'), (req, res) => {
  const { type, transaction_id, description, valid_until } = req.body;
  const url = req.file ? '/uploads/finance/' + req.file.filename : null;
  const info = db.prepare("INSERT INTO documents (org_id,entity_type,entity_id,type,file,valid_until,status) VALUES (?,?,?,?,?,?,?)")
    .run(req.user.org_id, 'finance', transaction_id || null, type || 'Documento', url, valid_until || null, 'aprovado');
  res.status(201).json(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid));
});

// Export CSV / TXT
router.get('/export', requirePermission('financeiro', 'view'), (req, res) => {
  const o = orgScope(req);
  const rows = db.prepare(`SELECT id,type,category,description,amount,date,due_date,status,payment_method,cost_center FROM transactions WHERE 1=1 ${o} ORDER BY date DESC`).all();
  const format = (req.query.format || 'csv').toLowerCase();
  const headers = ['ID','Tipo','Categoria','Descrição','Valor','Data','Vencimento','Status','Forma','Centro de Custo'];
  if (format === 'txt') {
    const txt = rows.map(r => headers.map((h, i) => `${h}: ${[r.id,r.type,r.category,r.description,r.amount,r.date,r.due_date,r.status,r.payment_method,r.cost_center][i] ?? ''}`).join(' | ')).join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="financeiro.txt"');
    return res.send(txt);
  }
  const csv = [headers.join(';'), ...rows.map(r => [r.id, r.type, r.category, r.description, r.amount, r.date, r.due_date, r.status, r.payment_method, r.cost_center].map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="financeiro.csv"');
  res.send('\uFEFF' + csv);
});

// Reports export (generic)
router.get('/report', requirePermission('relatorios', 'view'), (req, res) => {
  const { type, championship_id, format = 'csv' } = req.query;
  let headers = [], rows = [];
  if (type === 'standings') {
    const s = engine.computeStandings(championship_id);
    headers = ['Pos','Clube','P','V','E','D','GP','GC','SG','Pts'];
    rows = s.map(r => [r.position, r.name, r.played, r.wins, r.draws, r.losses, r.goals_for, r.goals_against, r.goal_diff, r.points]);
  } else if (type === 'scorers') {
    const s = engine.computePlayerStats(championship_id).filter(x => x.goals > 0).sort((a, b) => b.goals - a.goals);
    headers = ['Pos','Atleta','Clube','Gols','Assistências','Amarelos','Vermelhos'];
    rows = s.map((r, i) => [i + 1, r.name, r.club_name, r.goals, r.assists, r.yellow, r.red]);
  } else if (type === 'athletes') {
    const o = orgScope(req);
    const a = db.prepare(`SELECT a.name,a.nickname,a.cpf,a.position,a.number,a.status,c.name club FROM athletes a LEFT JOIN clubs c ON c.id=a.club_id WHERE 1=1 ${o.replace('org_id', 'a.org_id')} ORDER BY a.name`).all();
    headers = ['Nome','Apelido','CPF','Posição','Número','Situação','Clube'];
    rows = a.map(r => [r.name, r.nickname, r.cpf, r.position, r.number, r.status, r.club]);
  } else if (type === 'clubs') {
    const o = orgScope(req);
    const c = db.prepare(`SELECT name,short_name,city,state,responsible,phone,email FROM clubs WHERE 1=1 ${o} ORDER BY name`).all();
    headers = ['Nome','Abrev.','Cidade','UF','Responsável','Telefone','E-mail'];
    rows = c.map(r => [r.name, r.short_name, r.city, r.state, r.responsible, r.phone, r.email]);
  } else {
    return res.status(400).json({ error: 'Tipo de relatório inválido' });
  }
  if (format === 'txt') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_${type}.txt"`);
    return res.send([headers.join(' | '), ...rows.map(r => r.join(' | '))].join('\n'));
  }
  const csv = [headers.join(';'), ...rows.map(r => r.map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="relatorio_${type}.csv"`);
  res.send('\uFEFF' + csv);
});

module.exports = router;
