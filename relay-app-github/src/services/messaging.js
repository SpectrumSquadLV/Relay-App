// ============================================================
// Messaging delivery — email (Resend) + SMS (Twilio)
// Provider-agnostic and fail-soft:
//   • If credentials aren't configured, messages are marked "simulated"
//     (recorded + shown in the thread, but not actually sent) so demos and
//     dev never break.
//   • Per-org sender (from email / from number) overrides the global default,
//     supporting "each org uses its own number OR a Relay-managed one."
// Swap providers by changing env vars — no other code changes.
// ============================================================
const { get, run } = require('../db');

function orgSender(orgId) {
  const s = get(`SELECT settings_json FROM organization_settings WHERE organization_id=?`, [orgId]);
  const j = s ? JSON.parse(s.settings_json || '{}') : {};
  return j.messaging || {};
}

// ---- Email via Resend ----
async function sendEmail({ to, subject, text, fromEmail }) {
  const key = process.env.RESEND_API_KEY;
  const from = fromEmail || process.env.RESEND_FROM || 'Relay <noreply@relayitcrm.com>';
  if (!key) return { status: 'simulated', provider: 'none' };
  if (!to) return { status: 'failed', provider: 'resend', error: 'no recipient' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject: subject || '(no subject)', text: text || '' }),
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) return { status: 'sent', provider: 'resend' };
    return { status: 'failed', provider: 'resend', error: (await res.text()).slice(0, 200) };
  } catch (e) { return { status: 'failed', provider: 'resend', error: e.message }; }
}

// ---- SMS via Twilio ----
async function sendSMS({ to, body, fromNumber }) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  const from = fromNumber || process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { status: 'simulated', provider: 'none' };
  if (!to) return { status: 'failed', provider: 'twilio', error: 'no recipient' };
  try {
    const form = new URLSearchParams({ From: from, To: to, Body: body || '' });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) return { status: 'sent', provider: 'twilio' };
    return { status: 'failed', provider: 'twilio', error: (await res.text()).slice(0, 200) };
  } catch (e) { return { status: 'failed', provider: 'twilio', error: e.message }; }
}

// Deliver an already-recorded message row and update its status.
async function deliver(orgId, messageId, { channel, to, subject, body }) {
  const sender = orgSender(orgId);
  let r;
  if (channel === 'email') r = await sendEmail({ to, subject, text: body, fromEmail: sender.from_email });
  else if (channel === 'sms') r = await sendSMS({ to, body, fromNumber: sender.from_number });
  else r = { status: 'sent', provider: 'none' };
  try { run(`UPDATE messages SET status=? WHERE id=? AND organization_id=?`, [r.status, messageId, orgId]); } catch {}
  return r;
}

// Whether real delivery is configured (for UI hints).
function providersConfigured() {
  return {
    email: !!process.env.RESEND_API_KEY,
    sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
  };
}

module.exports = { sendEmail, sendSMS, deliver, orgSender, providersConfigured };
