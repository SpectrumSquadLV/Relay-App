// ============================================================
// Auth + roles + tenant-isolation middleware
// ============================================================
const crypto = require('crypto');
const { db, run, get, all, id, now } = require('./db');

// --- password hashing (scrypt, built-in — no native deps) ---
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

// --- role hierarchy for permission checks ---
const ROLE_RANK = { staff: 1, manager: 2, admin: 3, owner: 4 };
function roleAtLeast(role, min) { return (ROLE_RANK[role] || 0) >= (ROLE_RANK[min] || 99); }

function createUser({ email, name, password, isSuper = 0 }) {
  const u = { id: id(), email: email.toLowerCase().trim(), name, password_hash: hashPassword(password), is_super_admin: isSuper, created_at: now() };
  run(`INSERT INTO users (id,email,name,password_hash,is_super_admin,created_at) VALUES (?,?,?,?,?,?)`,
    [u.id, u.email, u.name, u.password_hash, u.is_super_admin, u.created_at]);
  return u;
}
function userByEmail(email) { return get(`SELECT * FROM users WHERE email = ?`, [email.toLowerCase().trim()]); }
function membershipsFor(userId) {
  return all(`SELECT ou.*, o.name org_name, o.slug org_slug, o.is_demo
              FROM organization_users ou JOIN organizations o ON o.id = ou.organization_id
              WHERE ou.user_id = ? AND ou.status='active'`, [userId]);
}

function audit({ orgId = null, actorUserId = null, action, detail = '', ip = '' }) {
  run(`INSERT INTO audit_logs (id,organization_id,actor_user_id,action,detail,ip,created_at) VALUES (?,?,?,?,?,?,?)`,
    [id(), orgId, actorUserId, action, detail, ip, now()]);
}

// --------- middleware ---------
// Requires a logged-in user.
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not_authenticated' });
  req.user = get(`SELECT * FROM users WHERE id = ?`, [req.session.userId]);
  if (!req.user) { req.session.destroy(() => {}); return res.status(401).json({ error: 'not_authenticated' }); }
  next();
}

// Requires the Relay super admin (owner portal).
function requireSuper(req, res, next) {
  if (!req.user?.is_super_admin) return res.status(403).json({ error: 'super_admin_only' });
  next();
}

// Resolves the ACTIVE organization + role for a workspace request.
// Normal users: their own org. Super admin: may impersonate any org
// (session.impersonateOrgId), which is audited when set.
function resolveOrg(req, res, next) {
  let orgId = null, role = null, impersonating = false;

  if (req.user.is_super_admin && req.session.impersonateOrgId) {
    orgId = req.session.impersonateOrgId; role = 'admin'; impersonating = true;
  } else {
    const targetOrg = req.headers['x-org-id'] || req.session.activeOrgId;
    const m = targetOrg
      ? get(`SELECT * FROM organization_users WHERE user_id=? AND organization_id=? AND status='active'`, [req.user.id, targetOrg])
      : get(`SELECT * FROM organization_users WHERE user_id=? AND status='active' LIMIT 1`, [req.user.id]);
    if (m) { orgId = m.organization_id; role = m.role; req.session.activeOrgId = orgId; }
  }

  if (!orgId) return res.status(403).json({ error: 'no_organization' });
  const org = get(`SELECT * FROM organizations WHERE id = ?`, [orgId]);
  if (!org || org.status === 'suspended') return res.status(403).json({ error: 'org_unavailable' });

  req.orgId = orgId; req.role = role; req.impersonating = impersonating; req.org = org;
  // touch last activity (not during impersonation, to keep customer activity honest)
  if (!impersonating) run(`UPDATE organizations SET last_activity_at=? WHERE id=?`, [now(), orgId]);
  next();
}

function requireRole(min) {
  return (req, res, next) => {
    if (req.impersonating) return next(); // super admin support access
    if (!roleAtLeast(req.role, min)) return res.status(403).json({ error: 'insufficient_role', need: min });
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, roleAtLeast, ROLE_RANK,
  createUser, userByEmail, membershipsFor, audit,
  requireAuth, requireSuper, resolveOrg, requireRole,
};
