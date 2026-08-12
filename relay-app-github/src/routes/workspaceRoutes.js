const express = require('express');
const { db, get, all, run, Repo, id, now } = require('../db');
const { requireAuth, resolveOrg, requireRole, audit } = require('../auth');
const { geocode } = require('../services/geocode');
const engine = require('../services/engine');
const messaging = require('../services/messaging');

const router = express.Router();
router.use(requireAuth, resolveOrg);

const HOURS = (iso) => iso ? (Date.now() - Date.parse(iso)) / 36e5 : 1e9;
function staffMap(orgId) {
  const rows = all(`SELECT u.id,u.name FROM organization_users ou JOIN users u ON u.id=ou.user_id WHERE ou.organization_id=?`, [orgId]);
  return Object.fromEntries(rows.map(r => [r.id, r.name]));
}
function stages(orgId) { return Repo.list(orgId, 'pipeline_stages', '', [], 'ORDER BY sort'); }

// org context for the UI
router.get('/me', (req, res) => {
  const flags = Object.fromEntries(Repo.list(req.orgId, 'feature_flags').map(f => [f.flag, !!f.enabled]));
  const staff = all(`SELECT u.id,u.name,u.email,ou.role FROM organization_users ou JOIN users u ON u.id=ou.user_id WHERE ou.organization_id=?`, [req.orgId]);
  res.json({ org: { id: req.org.id, name: req.org.name, brand_color: req.org.brand_color, logo: req.org.logo },
    role: req.role, impersonating: req.impersonating, feature_flags: flags, stages: stages(req.orgId), staff });
});

// Dashboard: "Needs Your Attention" + metrics
router.get('/dashboard', (req, res) => {
  const orgId = req.orgId;
  const st = stages(orgId);
  const byName = Object.fromEntries(st.map(s => [s.name, s.id]));
  const leads = Repo.list(orgId, 'leads', "status='open'");
  const notContacted = leads.filter(l => ['New Inquiry','Contacted'].includes(st.find(s=>s.id===l.stage_id)?.name) && HOURS(l.last_contact_at) > 48);
  const awaitingAuth = leads.filter(l => st.find(s=>s.id===l.stage_id)?.name === 'Authorization');
  const overdueTasks = Repo.list(orgId, 'tasks', "status IN ('open','in_progress') AND due_at < ?", [now()]);
  const dueToday = Repo.list(orgId, 'tasks', "status IN ('open','in_progress')").filter(t => t.due_at && new Date(t.due_at).toDateString() === new Date().toDateString());
  // authorization received but not scheduled (>3d in Authorization stage)
  const revenueAtRisk = awaitingAuth.filter(l => HOURS(l.last_contact_at) > 72);

  const attention = [];
  if (notContacted.length) attention.push({ level:'red', icon:'!', text:`${notContacted.length} lead${notContacted.length>1?'s have':' has'} not been contacted in 48 hours.`, view:'leads' });
  if (revenueAtRisk.length) attention.push({ level:'red', icon:'$', text:`${revenueAtRisk.length} authorization${revenueAtRisk.length>1?'s':''} received but no first day scheduled — revenue at risk.`, view:'leads' });
  if (overdueTasks.length) attention.push({ level:'yellow', icon:'⏰', text:`${overdueTasks.length} task${overdueTasks.length>1?'s are':' is'} overdue.`, view:'tasks' });
  const assessDone = leads.filter(l => st.find(s=>s.id===l.stage_id)?.name === 'Assessment' && HOURS(l.last_contact_at) < 96);
  if (assessDone.length) attention.push({ level:'yellow', icon:'📋', text:`${assessDone.length} assessment${assessDone.length>1?'s':''} completed — confirm follow-up was sent.`, view:'leads' });

  // RBT supervision compliance (if feature enabled)
  const supFlag = get(`SELECT enabled FROM feature_flags WHERE organization_id=? AND flag='rbt_supervision'`, [orgId]);
  if (supFlag?.enabled) {
    const sup = supervisionSummary(orgId, curPeriod());
    const behind = sup.rbts.filter(r => r.status === 'behind');
    const atRisk = sup.rbts.filter(r => r.status === 'at_risk');
    if (behind.length) attention.push({ level:'red', icon:'🎓', text:`${behind.length} RBT${behind.length>1?'s are':' is'} below the 5% supervision requirement this month.`, view:'supervision' });
    else if (atRisk.length) attention.push({ level:'yellow', icon:'🎓', text:`${atRisk.length} RBT${atRisk.length>1?'s are':' is'} at risk of missing this month's supervision hours.`, view:'supervision' });
  }

  const totalLeads = Repo.count(orgId, 'leads');
  const started = Repo.count(orgId, 'leads', 'stage_id=?', [byName['Started Services']]);
  const conversion = totalLeads ? Math.round(started / totalLeads * 100) : 0;
  const clients = Repo.count(orgId, 'clients', "stage!='discharged'");

  res.json({
    attention,
    metrics: {
      new_leads: leads.filter(l => HOURS(l.created_at) < 168).length,
      needs_followup: notContacted.length,
      tasks_due_today: dueToday.length,
      overdue_tasks: overdueTasks.length,
      awaiting_auth: awaitingAuth.length,
      active_clients: clients,
      conversion_rate: conversion,
      revenue_at_risk: revenueAtRisk.length,
    },
    recent: all(`SELECT * FROM activity_logs WHERE organization_id=? ORDER BY created_at DESC LIMIT 12`, [orgId]),
  });
});

// Leads (kanban grouped by stage)
router.get('/leads', (req, res) => {
  const smap = staffMap(req.orgId);
  const st = stages(req.orgId);
  const leads = Repo.list(req.orgId, 'leads', '', [], 'ORDER BY created_at DESC')
    .map(l => ({ ...l, assigned_name: smap[l.assigned_user_id] || null }));
  res.json({ stages: st, leads });
});
router.get('/leads/:id', (req, res) => {
  const l = Repo.one(req.orgId, 'leads', req.params.id);
  if (!l) return res.status(404).json({ error: 'not_found' });
  const smap = staffMap(req.orgId);
  res.json({
    lead: { ...l, assigned_name: smap[l.assigned_user_id] || null },
    tasks: Repo.list(req.orgId, 'tasks', "entity_id=?", [l.id], 'ORDER BY due_at'),
    messages: Repo.list(req.orgId, 'messages', "entity_id=?", [l.id], 'ORDER BY created_at'),
    timeline: all(`SELECT * FROM activity_logs WHERE organization_id=? AND entity_id=? ORDER BY created_at DESC`, [req.orgId, l.id]),
    stages: stages(req.orgId),
  });
});
router.post('/leads', requireRole('staff'), (req, res) => {
  const b = req.body || {};
  const firstStage = stages(req.orgId)[0];
  const lead = Repo.insert(req.orgId, 'leads', {
    contact_name: b.contact_name || '', client_name: b.client_name || '', phone: b.phone || '', email: b.email || '',
    preferred_contact: b.preferred_contact || 'text', referral_source: b.referral_source || '', insurance: b.insurance || '',
    stage_id: b.stage_id || firstStage?.id, assigned_user_id: b.assigned_user_id || null, status: 'open',
    notes: b.notes || '', inquiry_at: now(), last_contact_at: null, created_at: now(),
  });
  Repo.insert(req.orgId, 'activity_logs', { entity_type:'lead', entity_id: lead.id, kind:'created', summary:'Lead created', user_id: req.user.id, created_at: now() });
  engine.emit(req.orgId, 'lead.created', lead); // fire automations
  res.json({ lead });
});
router.patch('/leads/:id', requireRole('staff'), (req, res) => {
  const l = Repo.one(req.orgId, 'leads', req.params.id);
  if (!l) return res.status(404).json({ error: 'not_found' });
  const patch = {};
  ['contact_name','client_name','phone','email','insurance','referral_source','assigned_user_id','notes','stage_id','status'].forEach(k => { if (k in req.body) patch[k] = req.body[k]; });
  let stageEvent = null;
  if (patch.stage_id && patch.stage_id !== l.stage_id) {
    patch.last_contact_at = now();
    const sname = stages(req.orgId).find(s => s.id === patch.stage_id)?.name;
    Repo.insert(req.orgId, 'activity_logs', { entity_type:'lead', entity_id:l.id, kind:'status', summary:'Moved to '+sname, user_id:req.user.id, created_at:now() });
    if (sname === 'Assessment') stageEvent = 'assessment.completed';
    if (sname === 'Authorization') stageEvent = 'authorization.received';
  }
  const updated = Repo.update(req.orgId, 'leads', l.id, patch);
  if (stageEvent) engine.emit(req.orgId, stageEvent, updated); // fire stage-based automations
  res.json({ lead: updated });
});
router.post('/leads/:id/convert', requireRole('staff'), (req, res) => {
  const l = Repo.one(req.orgId, 'leads', req.params.id);
  if (!l) return res.status(404).json({ error: 'not_found' });
  const client = Repo.insert(req.orgId, 'clients', {
    from_lead_id: l.id, contact_name: l.contact_name, client_name: l.client_name, phone: l.phone, email: l.email,
    insurance: l.insurance, assigned_user_id: l.assigned_user_id, stage:'onboarding', notes: l.notes, created_at: now(),
  });
  Repo.update(req.orgId, 'leads', l.id, { status:'won', converted_client_id: client.id });
  Repo.insert(req.orgId, 'activity_logs', { entity_type:'lead', entity_id:l.id, kind:'converted', summary:'Converted to client', user_id:req.user.id, created_at:now() });
  res.json({ client });
});

// Clients
router.get('/clients', (req, res) => {
  const smap = staffMap(req.orgId);
  res.json({ clients: Repo.list(req.orgId, 'clients', '', [], 'ORDER BY created_at DESC').map(c => ({ ...c, assigned_name: smap[c.assigned_user_id] || null })) });
});

// Tasks
router.get('/tasks', (req, res) => {
  const smap = staffMap(req.orgId);
  res.json({ tasks: Repo.list(req.orgId, 'tasks', '', [], 'ORDER BY due_at').map(t => ({ ...t, owner_name: smap[t.owner_user_id] || null })) });
});
router.patch('/tasks/:id', requireRole('staff'), (req, res) => {
  const t = Repo.one(req.orgId, 'tasks', req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  res.json({ task: Repo.update(req.orgId, 'tasks', t.id, { status: req.body.status || t.status }) });
});
router.post('/tasks', requireRole('staff'), (req, res) => {
  const b = req.body || {};
  const task = Repo.insert(req.orgId, 'tasks', { title:b.title||'Untitled', entity_type:b.entity_type||'lead', entity_id:b.entity_id||null,
    owner_user_id:b.owner_user_id||req.user.id, priority:b.priority||'normal', category:b.category||'General', status:'open', due_at:b.due_at||now(), notes:b.notes||'', auto_generated:0, created_at:now() });
  res.json({ task });
});

// Inbox / messages
router.get('/inbox', (req, res) => {
  const filter = req.query.filter;
  let where = '', params = [];
  if (filter === 'unread') where = "direction='in' AND read_at IS NULL";
  else if (filter === 'email') where = "channel='email'";
  else if (filter === 'text') where = "channel='sms'";
  const msgs = Repo.list(req.orgId, 'messages', where, params, 'ORDER BY created_at DESC LIMIT 100');
  res.json({ messages: msgs });
});
router.post('/messages', requireRole('staff'), async (req, res) => {
  const b = req.body || {};
  const channel = b.channel || 'sms';
  // figure out recipient from the lead if not passed
  let to = b.to;
  if (!to && b.entity_id) { const l = Repo.one(req.orgId, 'leads', b.entity_id); to = channel === 'email' ? l?.email : l?.phone; }
  const m = Repo.insert(req.orgId, 'messages', { channel, direction:'out', entity_type:b.entity_type||'lead', entity_id:b.entity_id,
    from_addr:'', to_addr:to||'', subject:b.subject||'', body:b.body||'', status:'queued', user_id:req.user.id, created_at:now() });
  const r = await messaging.deliver(req.orgId, m.id, { channel, to, subject:b.subject, body:b.body }); // real Twilio/Resend send, or simulated
  if (b.entity_id) run(`UPDATE leads SET last_contact_at=? WHERE organization_id=? AND id=?`, [now(), req.orgId, b.entity_id]);
  Repo.insert(req.orgId, 'activity_logs', { entity_type:b.entity_type||'lead', entity_id:b.entity_id, kind:channel, summary:`${channel.toUpperCase()} ${r.status}`, user_id:req.user.id, created_at:now() });
  res.json({ message: { ...m, status: r.status }, delivery: r });
});

// Automations
router.get('/automations', (req, res) => {
  res.json({ automations: Repo.list(req.orgId, 'automations', '', [], 'ORDER BY name').map(a => ({ ...a, steps: JSON.parse(a.steps_json || '[]') })),
    runs: Repo.list(req.orgId, 'automation_runs', '', [], 'ORDER BY created_at DESC LIMIT 40') });
});
router.patch('/automations/:id', requireRole('manager'), (req, res) => {
  const a = Repo.one(req.orgId, 'automations', req.params.id);
  if (!a) return res.status(404).json({ error: 'not_found' });
  res.json({ automation: Repo.update(req.orgId, 'automations', a.id, { is_on: req.body.is_on ? 1 : 0 }) });
});

// Simulate an automation on a lead (fast-forwards waits) — for demos + testing.
router.post('/automations/:id/simulate', requireRole('manager'), (req, res) => {
  let entityId = (req.body || {}).entity_id;
  if (!entityId) { const l = get(`SELECT id, contact_name FROM leads WHERE organization_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`, [req.orgId]); entityId = l?.id; }
  if (!entityId) return res.status(400).json({ error: 'no_lead_to_simulate_on' });
  const r = engine.simulate(req.orgId, req.params.id, entityId);
  res.json(r);
});

// Templates + settings
router.get('/templates', (req, res) => res.json({ templates: Repo.list(req.orgId, 'message_templates', '', [], 'ORDER BY channel,name') }));

// Global search
router.get('/search', (req, res) => {
  const q = `%${(req.query.q || '').toLowerCase()}%`;
  if (!req.query.q) return res.json({ results: [] });
  const leads = all(`SELECT id,contact_name,client_name,phone,email FROM leads WHERE organization_id=? AND (lower(contact_name) LIKE ? OR lower(client_name) LIKE ? OR phone LIKE ? OR lower(email) LIKE ?) LIMIT 10`, [req.orgId,q,q,q,q]).map(r => ({ type:'lead', ...r }));
  const clients = all(`SELECT id,contact_name,client_name,phone,email FROM clients WHERE organization_id=? AND (lower(contact_name) LIKE ? OR lower(client_name) LIKE ? OR phone LIKE ? OR lower(email) LIKE ?) LIMIT 10`, [req.orgId,q,q,q,q]).map(r => ({ type:'client', ...r }));
  const tasks = all(`SELECT id,title FROM tasks WHERE organization_id=? AND lower(title) LIKE ? LIMIT 10`, [req.orgId,q]).map(r => ({ type:'task', ...r }));
  res.json({ results: [...leads, ...clients, ...tasks] });
});

// ============================================================
// RBT SUPERVISION (BACB 5% monthly requirement)
// ============================================================
const curPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM
function orgStaffRows(orgId) {
  return all(`SELECT ou.user_id, ou.role, ou.credential, ou.title, ou.home_lat, ou.home_lng, ou.home_zip, ou.home_address, u.name, u.email
              FROM organization_users ou JOIN users u ON u.id=ou.user_id WHERE ou.organization_id=? AND ou.status='active'`, [orgId]);
}
function supervisionSummary(orgId, period) {
  const staff = orgStaffRows(orgId);
  const rbts = staff.filter(s => s.credential === 'RBT');
  const supers = staff.filter(s => ['BCBA', 'BCaBA'].includes(s.credential));
  const rows = rbts.map(r => {
    const hoursRow = get(`SELECT COALESCE(SUM(service_hours),0) h FROM rbt_timecards WHERE organization_id=? AND rbt_user_id=? AND period=?`, [orgId, r.user_id, period]);
    const service = hoursRow.h || 0;
    const sessions = all(`SELECT ss.*, u.name supervisor_name FROM supervision_sessions ss LEFT JOIN users u ON u.id=ss.supervisor_user_id WHERE ss.organization_id=? AND ss.rbt_user_id=? AND ss.period=? ORDER BY ss.date`, [orgId, r.user_id, period]);
    const supervised = sessions.reduce((s, x) => s + (x.duration_hours || 0), 0);
    const contacts = sessions.length;
    const individual = sessions.filter(s => s.type === 'individual').length;
    const required = +(service * 0.05).toFixed(2);
    const pctOfService = service ? +(supervised / service * 100).toFixed(1) : 0;
    let status = 'behind';
    const meetsHours = supervised >= required && service > 0;
    const meetsContacts = contacts >= 2 && individual >= 1;
    if (meetsHours && meetsContacts) status = 'met';
    else if (service > 0 && supervised >= required * 0.6) status = 'at_risk';
    if (service === 0) status = 'no_hours';
    return { rbt_user_id: r.user_id, name: r.name, service_hours: service, required_hours: required,
      supervised_hours: +supervised.toFixed(2), pct_of_service: pctOfService, contacts, individual_contacts: individual,
      status, sessions };
  });
  return { period, rbts: rows, supervisors: supers.map(s => ({ id: s.user_id, name: s.name, credential: s.credential })) };
}

router.get('/supervision', requireRole('staff'), (req, res) => {
  const period = req.query.period || curPeriod();
  res.json(supervisionSummary(req.orgId, period));
});

// upload timecard hours (CSV text: "email,hours" per line) OR single manual entry
router.post('/supervision/timecards', requireRole('manager'), (req, res) => {
  const period = req.body.period || curPeriod();
  const staff = orgStaffRows(req.orgId);
  const byEmail = Object.fromEntries(staff.map(s => [s.email.toLowerCase(), s.user_id]));
  let imported = 0, skipped = [];
  if (req.body.csv) {
    req.body.csv.split(/\r?\n/).forEach(line => {
      const [email, hours] = line.split(',').map(x => (x || '').trim());
      if (!email || !hours) return;
      const uid = byEmail[email.toLowerCase()];
      if (!uid) { skipped.push(email); return; }
      run(`DELETE FROM rbt_timecards WHERE organization_id=? AND rbt_user_id=? AND period=?`, [req.orgId, uid, period]);
      Repo.insert(req.orgId, 'rbt_timecards', { rbt_user_id: uid, period, service_hours: parseFloat(hours) || 0, source: 'upload', created_at: now() });
      imported++;
    });
  } else if (req.body.rbt_user_id) {
    run(`DELETE FROM rbt_timecards WHERE organization_id=? AND rbt_user_id=? AND period=?`, [req.orgId, req.body.rbt_user_id, period]);
    Repo.insert(req.orgId, 'rbt_timecards', { rbt_user_id: req.body.rbt_user_id, period, service_hours: parseFloat(req.body.service_hours) || 0, source: 'manual', created_at: now() });
    imported = 1;
  }
  res.json({ ok: true, imported, skipped, period });
});

// log a supervision session
router.post('/supervision/sessions', requireRole('staff'), (req, res) => {
  const b = req.body || {};
  const period = (b.date || '').slice(0, 7) || curPeriod();
  const s = Repo.insert(req.orgId, 'supervision_sessions', { rbt_user_id: b.rbt_user_id, supervisor_user_id: b.supervisor_user_id || req.user.id,
    date: b.date || now().slice(0, 10), period, duration_hours: parseFloat(b.duration_hours) || 0, type: b.type || 'individual', method: b.method || 'in_person', notes: b.notes || '', created_at: now() });
  Repo.insert(req.orgId, 'activity_logs', { entity_type: 'rbt', entity_id: b.rbt_user_id, kind: 'supervision', summary: `Supervision logged (${s.duration_hours}h, ${s.type})`, user_id: req.user.id, created_at: now() });
  res.json({ session: s });
});

// ============================================================
// STAFF MAPS (proximity: which staff are closest to a client)
// ============================================================
function haversine(a, b, c, d) { // miles
  if ([a, b, c, d].some(v => v == null)) return null;
  const R = 3958.8, toR = x => x * Math.PI / 180;
  const dLat = toR(c - a), dLng = toR(d - b);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLng / 2) ** 2;
  return +(2 * R * Math.asin(Math.sqrt(s))).toFixed(1);
}
router.get('/maps', requireRole('staff'), (req, res) => {
  const staff = orgStaffRows(req.orgId).filter(s => s.home_lat != null)
    .map(s => ({ id: s.user_id, name: s.name, credential: s.credential, lat: s.home_lat, lng: s.home_lng, zip: s.home_zip }));
  const clients = Repo.list(req.orgId, 'clients', 'lat IS NOT NULL')
    .map(c => ({ id: c.id, name: c.client_name, contact: c.contact_name, lat: c.lat, lng: c.lng, zip: c.zip, address: c.address, assigned_user_id: c.assigned_user_id }));
  // counts of records that still need geocoding (have an address but no coords)
  const pendingClients = Repo.count(req.orgId, 'clients', "(address IS NOT NULL OR zip IS NOT NULL) AND lat IS NULL");
  const pendingStaff = get(`SELECT COUNT(*) c FROM organization_users WHERE organization_id=? AND (home_address IS NOT NULL OR home_zip IS NOT NULL) AND home_lat IS NULL`, [req.orgId]).c;
  res.json({ staff, clients, pending: { clients: pendingClients, staff: pendingStaff } });
});

// ---- Geocoding: address -> coordinates ----
// Update a client; if the address/zip changed, auto-geocode to coordinates.
router.patch('/clients/:id', requireRole('staff'), async (req, res) => {
  const c = Repo.one(req.orgId, 'clients', req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const patch = {};
  ['contact_name','client_name','phone','email','insurance','address','zip','weekly_hours','notes','stage'].forEach(k => { if (k in req.body) patch[k] = req.body[k]; });
  let geocoded = false;
  if (('address' in req.body) || ('zip' in req.body)) {
    const g = await geocode(patch.address ?? c.address, patch.zip ?? c.zip);
    if (g) { patch.lat = g.lat; patch.lng = g.lng; geocoded = true; }
  }
  const updated = Repo.update(req.orgId, 'clients', c.id, patch);
  res.json({ client: updated, geocoded, located: updated.lat != null });
});

// Set + geocode a staff member's home location.
router.patch('/staff/:userId/location', requireRole('manager'), async (req, res) => {
  const m = get(`SELECT * FROM organization_users WHERE organization_id=? AND user_id=?`, [req.orgId, req.params.userId]);
  if (!m) return res.status(404).json({ error: 'not_found' });
  const address = req.body.home_address ?? m.home_address, zip = req.body.home_zip ?? m.home_zip;
  const g = await geocode(address, zip);
  run(`UPDATE organization_users SET home_address=?, home_zip=?, credential=COALESCE(?,credential), home_lat=?, home_lng=? WHERE organization_id=? AND user_id=?`,
    [address, zip, req.body.credential || null, g ? g.lat : m.home_lat, g ? g.lng : m.home_lng, req.orgId, req.params.userId]);
  res.json({ ok: true, located: !!g });
});

// Bulk: geocode every client + staff that has an address but no coordinates yet.
router.post('/maps/geocode', requireRole('manager'), async (req, res) => {
  let clientsDone = 0, staffDone = 0, failed = 0;
  const clients = Repo.list(req.orgId, 'clients', "(address IS NOT NULL OR zip IS NOT NULL) AND lat IS NULL");
  for (const c of clients) { const g = await geocode(c.address, c.zip); if (g) { Repo.update(req.orgId, 'clients', c.id, { lat: g.lat, lng: g.lng }); clientsDone++; } else failed++; }
  const staff = all(`SELECT * FROM organization_users WHERE organization_id=? AND (home_address IS NOT NULL OR home_zip IS NOT NULL) AND home_lat IS NULL`, [req.orgId]);
  for (const s of staff) { const g = await geocode(s.home_address, s.home_zip); if (g) { run(`UPDATE organization_users SET home_lat=?, home_lng=? WHERE organization_id=? AND user_id=?`, [g.lat, g.lng, req.orgId, s.user_id]); staffDone++; } else failed++; }
  audit({ orgId: req.orgId, actorUserId: req.user.id, action: 'geocode_bulk', detail: `clients:${clientsDone} staff:${staffDone} failed:${failed}`, ip: req.ip });
  res.json({ ok: true, clients_located: clientsDone, staff_located: staffDone, failed });
});

module.exports = router;
