const express = require('express');
const { db, get, run, now } = require('../db');
const { verifyPassword, userByEmail, membershipsFor, audit, requireAuth } = require('../auth');
const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = email ? userByEmail(email) : null;
  if (!u || !verifyPassword(password || '', u.password_hash)) {
    audit({ actorUserId: u?.id || null, action: 'login_failed', detail: email || '', ip: req.ip });
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  req.session.userId = u.id;
  req.session.activeOrgId = null; req.session.impersonateOrgId = null;
  run(`UPDATE users SET last_login_at=? WHERE id=?`, [now(), u.id]);
  audit({ actorUserId: u.id, action: 'login', ip: req.ip });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const u = get(`SELECT id,email,name,is_super_admin FROM users WHERE id=?`, [req.session.userId]);
  if (!u) return res.json({ user: null });
  const memberships = membershipsFor(u.id);
  const impersonating = req.session.impersonateOrgId
    ? get(`SELECT id,name FROM organizations WHERE id=?`, [req.session.impersonateOrgId]) : null;
  res.json({ user: u, memberships, impersonating, activeOrgId: req.session.activeOrgId });
});

module.exports = router;
