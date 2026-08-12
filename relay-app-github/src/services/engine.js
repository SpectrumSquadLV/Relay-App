// ============================================================
// Relay Automation Engine
// Model: TRIGGER -> [ wait | condition | action ]* run as a durable job.
//   emit()      creates a job when a trigger fires, runs it to the first wait
//   tick()      background poller; resumes jobs whose wait has elapsed
//   simulate()  fast-forwards a whole automation on one entity (for demos/tests)
// Multi-tenant: every job carries organization_id; all queries are org-scoped.
// Message *delivery* (Twilio/Resend) is still stubbed — actions record the
// email/text + activity; swap in real senders in doAction().
// ============================================================
const { db, get, all, run, Repo, id, now } = require('../db');
const messaging = require('./messaging');

function log(orgId, automationId, entityId, status, detail) {
  Repo.insert(orgId, 'automation_runs', { automation_id: automationId, entity_type: 'lead', entity_id: entityId, status, detail, created_at: now() });
}
function mergeFields(text, ctx) { return (text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (ctx[k] != null ? ctx[k] : '')); }

function leadCtx(orgId, lead) {
  const org = get(`SELECT name FROM organizations WHERE id=?`, [orgId]);
  const staff = lead?.assigned_user_id ? get(`SELECT name FROM users WHERE id=?`, [lead.assigned_user_id]) : null;
  return {
    parent_first_name: (lead?.contact_name || '').split(' ')[0] || 'there',
    client_first_name: (lead?.client_name || '').split(' ')[0] || 'your child',
    company_name: org?.name || 'our team',
    staff_name: staff?.name || 'our team',
  };
}
function loadAutomation(orgId, autoId) { const a = Repo.one(orgId, 'automations', autoId); return a ? { ...a, steps: JSON.parse(a.steps_json || '[]') } : null; }

function evalCondition(orgId, cond, job) {
  const lead = Repo.one(orgId, 'leads', job.entity_id);
  if (!lead) return false;
  if (cond === 'no_response') return !lead.last_contact_at || Date.parse(lead.last_contact_at) <= Date.parse(job.started_at);
  if (cond === 'no_first_day_in_days') return !lead.converted_client_id; // no client/first day yet
  return true;
}

function doAction(orgId, step, ctx, lead) {
  if (step.action === 'send_email') {
    const tpl = get(`SELECT * FROM message_templates WHERE organization_id=? AND channel='email' AND name=?`, [orgId, step.template]);
    const body = mergeFields(tpl?.body || '', ctx), subject = mergeFields(tpl?.subject || 'A message from ' + ctx.company_name, ctx);
    const m = Repo.insert(orgId, 'messages', { channel: 'email', direction: 'out', entity_type: 'lead', entity_id: lead.id, to_addr: lead.email, subject, body, status: 'queued', created_at: now() });
    messaging.deliver(orgId, m.id, { channel: 'email', to: lead.email, subject, body }).catch(() => {}); // real send (Resend) or simulated
    Repo.insert(orgId, 'usage_records', { metric: 'emails_sent', value: 1, period: now().slice(0, 7) });
    return `Sent email — “${step.template}”`;
  }
  if (step.action === 'send_sms') {
    const tpl = get(`SELECT * FROM message_templates WHERE organization_id=? AND channel='sms' AND name=?`, [orgId, step.template]);
    const body = mergeFields(tpl?.body || '', ctx);
    const m = Repo.insert(orgId, 'messages', { channel: 'sms', direction: 'out', entity_type: 'lead', entity_id: lead.id, to_addr: lead.phone, body, status: 'queued', created_at: now() });
    messaging.deliver(orgId, m.id, { channel: 'sms', to: lead.phone, body }).catch(() => {}); // real send (Twilio) or simulated
    Repo.insert(orgId, 'usage_records', { metric: 'sms_sent', value: 1, period: now().slice(0, 7) });
    return `Sent text — “${step.template}”`;
  }
  if (step.action === 'create_task') {
    Repo.insert(orgId, 'tasks', { title: mergeFields(step.title, ctx), entity_type: 'lead', entity_id: lead.id, owner_user_id: lead.assigned_user_id, priority: 'normal', category: 'Follow-up', status: 'open', due_at: now(), auto_generated: 1, created_at: now() });
    return `Created task — “${mergeFields(step.title, ctx)}”`;
  }
  if (step.action === 'alert') {
    Repo.insert(orgId, 'tasks', { title: mergeFields(step.title, ctx), entity_type: 'lead', entity_id: lead.id, owner_user_id: lead.assigned_user_id, priority: 'high', category: 'Alert', status: 'open', due_at: now(), auto_generated: 1, created_at: now() });
    return `Raised alert — “${mergeFields(step.title, ctx)}”`;
  }
  return 'No-op step';
}

// Run a job's steps from its current index until a wait (real time) or the end.
function advanceJob(job, opts = {}) {
  const orgId = job.organization_id;
  const auto = loadAutomation(orgId, job.automation_id);
  if (!auto || !auto.is_on) { Repo.update(orgId, 'automation_jobs', job.id, { status: 'canceled', updated_at: now() }); return; }
  const lead = Repo.one(orgId, 'leads', job.entity_id) || { id: job.entity_id };
  const ctx = leadCtx(orgId, lead);
  let i = job.step_index;
  while (i < auto.steps.length) {
    const step = auto.steps[i];
    if (step.wait_hours != null) {
      if (opts.fastForward) { log(orgId, auto.id, job.entity_id, 'wait', `(simulated) skip ${step.wait_hours}h wait`); i++; continue; }
      const next = new Date(Date.now() + step.wait_hours * 36e5).toISOString();
      Repo.update(orgId, 'automation_jobs', job.id, { step_index: i + 1, next_run_at: next, status: 'waiting', updated_at: now() });
      log(orgId, auto.id, job.entity_id, 'wait', `Waiting ${step.wait_hours}h before next step`);
      return;
    }
    if (step.condition) {
      const ok = evalCondition(orgId, step.condition, job);
      log(orgId, auto.id, job.entity_id, ok ? 'condition_pass' : 'condition_stop', `Condition “${step.condition}”: ${ok ? 'met — continuing' : 'not met — stopped'}`);
      if (!ok) { Repo.update(orgId, 'automation_jobs', job.id, { status: 'done', step_index: i, updated_at: now() }); return; }
      i++; continue;
    }
    if (step.action) {
      const detail = doAction(orgId, step, ctx, lead);
      log(orgId, auto.id, job.entity_id, 'success', detail);
      Repo.insert(orgId, 'activity_logs', { entity_type: 'lead', entity_id: job.entity_id, kind: 'automation', summary: 'Automation: ' + detail, user_id: null, created_at: now() });
      i++; continue;
    }
    i++;
  }
  Repo.update(orgId, 'automation_jobs', job.id, { status: 'done', step_index: i, updated_at: now() });
}

// A trigger fired — start every matching, enabled automation for this org.
function emit(orgId, trigger, entity) {
  let autos = [];
  try { autos = Repo.list(orgId, 'automations', 'trigger=? AND is_on=1', [trigger]); } catch { return; }
  autos.forEach(a => {
    const job = Repo.insert(orgId, 'automation_jobs', { automation_id: a.id, entity_type: 'lead', entity_id: entity.id, status: 'waiting', step_index: 0, next_run_at: now(), started_at: now(), updated_at: now() });
    log(orgId, a.id, entity.id, 'triggered', `Triggered by ${trigger}: ${a.name}`);
    try { advanceJob(job); } catch (e) { log(orgId, a.id, entity.id, 'error', e.message); }
  });
}

// Background poller — resume jobs whose wait elapsed. Safe to call on an interval.
function tick() {
  let due = [];
  try { due = all(`SELECT * FROM automation_jobs WHERE status='waiting' AND next_run_at <= ? LIMIT 100`, [now()]); } catch { return { ran: 0 }; }
  let ran = 0;
  for (const j of due) {
    try { advanceJob(j); ran++; } catch (e) { try { Repo.update(j.organization_id, 'automation_jobs', j.id, { status: 'canceled', updated_at: now() }); } catch {} }
  }
  return { ran };
}

// Fast-forward a whole automation on one entity — for the "Simulate" button + tests.
function simulate(orgId, automationId, entityId) {
  const auto = loadAutomation(orgId, automationId);
  if (!auto) return { error: 'not_found' };
  const job = Repo.insert(orgId, 'automation_jobs', { automation_id: automationId, entity_type: 'lead', entity_id: entityId, status: 'waiting', step_index: 0, next_run_at: now(), started_at: now(), updated_at: now() });
  log(orgId, automationId, entityId, 'triggered', `Simulated run: ${auto.name}`);
  advanceJob(job, { fastForward: true });
  return { ok: true, automation: auto.name };
}

module.exports = { emit, tick, simulate };
