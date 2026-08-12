const express = require('express');
const { db, get, all, run, Repo, id, now } = require('../db');
const { requireAuth, requireSuper, audit } = require('../auth');
const { provisionOrg, getMasterTemplate, setMasterTemplate } = require('../master');
const { resetDemo } = require('../seed');
const messaging = require('../services/messaging');

const router = express.Router();
router.use(requireAuth, requireSuper);

// ---- helpers: org stats + health ----
function orgStats(o) {
  const users = get(`SELECT COUNT(*) c FROM organization_users WHERE organization_id=?`, [o.id]).c;
  const leads = get(`SELECT COUNT(*) c FROM leads WHERE organization_id=?`, [o.id]).c;
  const clients = get(`SELECT COUNT(*) c FROM clients WHERE organization_id=? AND stage!='discharged'`, [o.id]).c;
  const emails = get(`SELECT COUNT(*) c FROM messages WHERE organization_id=? AND channel='email'`, [o.id]).c;
  const texts = get(`SELECT COUNT(*) c FROM messages WHERE organization_id=? AND channel='sms'`, [o.id]).c;
  const plan = o.plan_id ? get(`SELECT name FROM plans WHERE id=?`, [o.plan_id]) : null;
  // health
  const flags = [];
  if (o.subscription_status === 'past_due') flags.push('Failed payment');
  const lastAct = o.last_activity_at ? (Date.now() - Date.parse(o.last_activity_at)) / 864e5 : 999;
  if (lastAct > 14) flags.push('No recent login');
  let health = 'green';
  if (flags.length) health = flags.includes('Failed payment') ? 'red' : 'yellow';
  return { ...o, plan_name: plan?.name || '—', users, leads, clients, emails, texts,
    last_activity_days: Math.round(lastAct), health, health_flags: flags };
}

router.get('/organizations', (req, res) => {
  const orgs = all(`SELECT * FROM organizations ORDER BY is_demo DESC, created_at DESC`).map(orgStats);
  res.json({ organizations: orgs });
});

router.get('/organizations/:id', (req, res) => {
  const o = get(`SELECT * FROM organizations WHERE id=?`, [req.params.id]);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const users = all(`SELECT ou.role, ou.status, u.name, u.email, u.last_login_at, u.id
                     FROM organization_users ou JOIN users u ON u.id=ou.user_id WHERE ou.organization_id=?`, [o.id]);
  const flags = all(`SELECT flag, enabled FROM feature_flags WHERE organization_id=?`, [o.id]);
  const usage = all(`SELECT metric, value, period FROM usage_records WHERE organization_id=?`, [o.id]);
  const plans = all(`SELECT * FROM plans ORDER BY sort`);
  const msgSettings = messaging.orgSender(o.id);
  res.json({ organization: orgStats(o), users, feature_flags: flags, usage, plans, messaging: msgSettings, providers: messaging.providersConfigured() });
});

// Per-org sender config (own number/email, or leave blank to use Relay-managed default)
router.post('/organizations/:id/messaging', (req, res) => {
  const row = get(`SELECT settings_json FROM organization_settings WHERE organization_id=?`, [req.params.id]);
  const j = row ? JSON.parse(row.settings_json || '{}') : {};
  j.messaging = { from_email: req.body.from_email || '', from_number: req.body.from_number || '' };
  run(`INSERT INTO organization_settings (organization_id, settings_json) VALUES (?,?) ON CONFLICT(organization_id) DO UPDATE SET settings_json=excluded.settings_json`, [req.params.id, JSON.stringify(j)]);
  audit({ orgId: req.params.id, actorUserId: req.user.id, action: 'messaging_config', detail: `${j.messaging.from_email} / ${j.messaging.from_number}`, ip: req.ip });
  res.json({ ok: true });
});

// Create organization (provision from master template)
router.post('/organizations', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name_required' });
  const result = provisionOrg({
    name: b.name, owner_name: b.owner_name, owner_email: b.owner_email, phone: b.phone,
    plan_id: b.plan_id, industry: b.industry || 'aba', trial: !!b.trial, brand_color: b.brand_color,
    notes: b.notes,
  });
  audit({ orgId: result.org.id, actorUserId: req.user.id, action: 'org_created', detail: b.name, ip: req.ip });
  res.json({ ok: true, organization: orgStats(result.org), owner_temp_password: result.tempPassword });
});

// Subscription / status controls
router.post('/organizations/:id/status', (req, res) => {
  const { status } = req.body || {}; // active|suspended|active
  run(`UPDATE organizations SET status=? WHERE id=?`, [status, req.params.id]);
  audit({ orgId: req.params.id, actorUserId: req.user.id, action: 'org_status_change', detail: status, ip: req.ip });
  res.json({ ok: true });
});
router.post('/organizations/:id/plan', (req, res) => {
  const p = get(`SELECT * FROM plans WHERE id=?`, [req.body.plan_id]);
  if (!p) return res.status(400).json({ error: 'bad_plan' });
  run(`UPDATE organizations SET plan_id=?, mrr=? WHERE id=?`, [p.id, p.monthly_price, req.params.id]);
  audit({ orgId: req.params.id, actorUserId: req.user.id, action: 'org_plan_change', detail: p.name, ip: req.ip });
  res.json({ ok: true });
});
router.post('/organizations/:id/notes', (req, res) => {
  run(`UPDATE organizations SET notes=? WHERE id=?`, [req.body.notes || '', req.params.id]);
  res.json({ ok: true });
});

// Feature flags per org
router.post('/organizations/:id/flags', (req, res) => {
  const { flag, enabled } = req.body || {};
  run(`INSERT INTO feature_flags (id,organization_id,flag,enabled) VALUES (?,?,?,?)
       ON CONFLICT(organization_id,flag) DO UPDATE SET enabled=excluded.enabled`,
    [id(), req.params.id, flag, enabled ? 1 : 0]);
  audit({ orgId: req.params.id, actorUserId: req.user.id, action: 'flag_change', detail: `${flag}=${enabled}`, ip: req.ip });
  res.json({ ok: true });
});

// Impersonate / View Workspace
router.post('/impersonate/:id', (req, res) => {
  const o = get(`SELECT id,name FROM organizations WHERE id=?`, [req.params.id]);
  if (!o) return res.status(404).json({ error: 'not_found' });
  req.session.impersonateOrgId = o.id;
  audit({ orgId: o.id, actorUserId: req.user.id, action: 'impersonation_start', detail: o.name, ip: req.ip });
  res.json({ ok: true, organization: o });
});
router.post('/impersonate-stop', (req, res) => {
  if (req.session.impersonateOrgId)
    audit({ orgId: req.session.impersonateOrgId, actorUserId: req.user.id, action: 'impersonation_stop', ip: req.ip });
  req.session.impersonateOrgId = null;
  res.json({ ok: true });
});

// Reset Demo
router.post('/reset-demo', (req, res) => {
  const r = resetDemo();
  audit({ orgId: r.org_id, actorUserId: req.user.id, action: 'demo_reset', ip: req.ip });
  res.json(r);
});

// SaaS analytics
router.get('/analytics', (req, res) => {
  const orgs = all(`SELECT * FROM organizations`);
  const total = orgs.length;
  const paid = orgs.filter(o => o.subscription_status === 'active').length;
  const trials = orgs.filter(o => o.subscription_status === 'trialing').length;
  const mrr = orgs.reduce((s, o) => s + (o.mrr || 0), 0);
  const monthStart = new Date(); monthStart.setDate(1);
  const newThisMonth = orgs.filter(o => o.created_at && Date.parse(o.created_at) >= monthStart.getTime()).length;
  const users = get(`SELECT COUNT(*) c FROM users WHERE is_super_admin=0`).c;
  const leads = get(`SELECT COUNT(*) c FROM leads`).c;
  const emails = get(`SELECT COUNT(*) c FROM messages WHERE channel='email'`).c;
  const texts = get(`SELECT COUNT(*) c FROM messages WHERE channel='sms'`).c;
  const autos = get(`SELECT COUNT(*) c FROM automation_runs`).c;
  res.json({ total_orgs: total, active: paid, trials, paid, mrr, arr: mrr * 12,
    new_this_month: newThisMonth, total_users: users, total_leads: leads,
    total_emails: emails, total_texts: texts, automation_runs: autos });
});

// Customer success — accounts needing attention
router.get('/customer-success', (req, res) => {
  const orgs = all(`SELECT * FROM organizations WHERE is_demo=0`).map(orgStats);
  const buckets = {
    inactive: orgs.filter(o => o.last_activity_days > 14),
    trial_ending: orgs.filter(o => o.subscription_status === 'trialing'),
    failed_payment: orgs.filter(o => o.subscription_status === 'past_due'),
    low_usage: orgs.filter(o => o.leads < 3),
  };
  res.json(buckets);
});

// Master Template editor
router.get('/master-template', (req, res) => res.json({ template: getMasterTemplate() }));
router.post('/master-template', (req, res) => {
  const cfg = req.body?.template;
  if (!cfg) return res.status(400).json({ error: 'template_required' });
  // scope: new|selected|all — for now applies to NEW orgs only (safe default)
  setMasterTemplate(cfg);
  audit({ actorUserId: req.user.id, action: 'master_template_update', detail: `scope=${req.body.scope || 'new'}`, ip: req.ip });
  res.json({ ok: true, scope: req.body.scope || 'new', note: 'Applied to NEW organizations. Existing orgs keep their customizations.' });
});

// Audit log (global)
router.get('/audit', (req, res) => {
  res.json({ audit: all(`SELECT a.*, u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 200`) });
});

module.exports = router;
