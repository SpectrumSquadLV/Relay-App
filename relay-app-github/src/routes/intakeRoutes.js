// ============================================================
// Public intake. No session, no login -- a family opens a link on a phone.
//
// The submission is the trigger the rest of Relay hangs off: it creates the
// client, stores the insurance and both sides of the card, opens a benefits
// verification, files the documents, writes the confirmation into the
// outgoing mailbox and logs the automation. That is the demo in one request.
//
// Tenant-scoped by the slug in the URL, so a form can only ever write into the
// practice it was issued for.
// ============================================================
const express = require('express');
const { Repo, get, id, now } = require('../db');

const router = express.Router();

// Base64 payloads are large; a card photo off a modern phone is a few MB.
router.use(express.json({ limit: '25mb' }));

const clean = (v) => (v == null ? null : String(v).trim() || null);

// Practices are addressed by slug so the link is shareable and readable:
// /intake.html?p=relay-demo
function orgBySlug(slug) {
  if (!slug) return null;
  return get(`SELECT id, name, slug FROM organizations WHERE slug = ? OR id = ?`, [String(slug), String(slug)]);
}

// What the form needs to render itself: who the practice is, and what it
// offers. Public on purpose -- it is the practice's own name on their own
// intake link -- and deliberately returns nothing else.
router.get('/intake/:slug/config', (req, res) => {
  const org = orgBySlug(req.params.slug);
  if (!org) return res.status(404).json({ error: 'Practice not found' });
  res.json({
    practice: { name: org.name, slug: org.slug },
    services: [
      { key: 'aba', label: 'ABA Therapy' },
      { key: 'bh', label: 'Behavioral Health' },
      { key: 'ot', label: 'Occupational Therapy' },
      { key: 'st', label: 'Speech Therapy' },
    ],
  });
});

router.post('/intake/:slug', (req, res) => {
  const org = orgBySlug(req.params.slug);
  if (!org) return res.status(404).json({ error: 'Practice not found' });
  const b = req.body || {};

  if (!clean(b.first_name) || !clean(b.last_name)) {
    return res.status(400).json({ error: 'Patient first and last name are required.' });
  }
  if (!clean(b.guardian_email) && !clean(b.guardian_phone)) {
    return res.status(400).json({ error: 'We need either an email address or a phone number to reach you.' });
  }

  const fullName = `${clean(b.first_name)} ${clean(b.last_name)}`;
  const orgId = org.id;

  // ---- the client ----
  const client = Repo.insert(orgId, 'clients', {
    client_name: fullName, contact_name: clean(b.guardian_name),
    phone: clean(b.guardian_phone), email: clean(b.guardian_email),
    legal_first_name: clean(b.first_name), middle_name: clean(b.middle_name),
    legal_last_name: clean(b.last_name), preferred_name: clean(b.preferred_name) || clean(b.first_name),
    dob: clean(b.dob), sex: clean(b.sex),
    address: clean(b.address), city: clean(b.city), state: clean(b.state), zip: clean(b.zip),
    language: clean(b.language), preferred_contact: clean(b.preferred_contact),
    service_line: clean(b.service_line) || 'aba',
    diagnosis: clean(b.diagnosis), diagnosis_date: clean(b.diagnosis_date),
    referral_source: clean(b.referral_source), referring_provider: clean(b.referring_provider),
    guardian_name: clean(b.guardian_name), guardian_relationship: clean(b.guardian_relationship),
    emergency_contact: clean(b.emergency_contact),
    insurance: clean(b.carrier),
    photo_url: clean(b.photo) || null,
    phase: 'intake', stage: 'intake',
    notes: clean(b.notes), created_at: now(),
  });
  const clientId = client.id || client;

  const doc = (category, label, filename, path, required) => Repo.insert(orgId, 'client_documents', {
    client_id: clientId, category, label, filename,
    mime_type: filename && filename.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
    file_path: path, is_required: required ? 1 : 0, created_at: now(),
  });

  // ---- insurance + both sides of the card ----
  let insuranceId = null;
  const bothSides = !!(clean(b.card_front) && clean(b.card_back));
  if (clean(b.carrier) || clean(b.member_id) || clean(b.card_front)) {
    const ins = Repo.insert(orgId, 'client_insurance', {
      client_id: clientId, rank: 'primary',
      carrier: clean(b.carrier), member_id: clean(b.member_id), group_number: clean(b.group_number),
      subscriber_name: clean(b.subscriber_name) || clean(b.guardian_name),
      subscriber_dob: clean(b.subscriber_dob), relationship: clean(b.subscriber_relationship),
      card_front_path: clean(b.card_front), card_back_path: clean(b.card_back),
      created_at: now(),
    });
    insuranceId = ins.id || ins;
    if (clean(b.card_front)) doc('insurance', 'Insurance Card — Front', 'card-front.jpg', clean(b.card_front), 1);
    if (clean(b.card_back)) doc('insurance', 'Insurance Card — Back', 'card-back.jpg', clean(b.card_back), 1);
  }

  doc('intake', 'Intake Application', 'intake-application.pdf', 'submitted', 1);
  if (clean(b.referral_doc)) doc('referrals', 'Referral / Prescription', 'referral.pdf', clean(b.referral_doc), 1);
  if (clean(b.diagnostic_doc)) doc('medical', 'Diagnostic Report', 'diagnostic-report.pdf', clean(b.diagnostic_doc), 0);

  // ---- benefits verification ----
  // Opened either way. Missing a card does not mean skipping the check, it
  // means the check starts by asking the family for the card -- which is the
  // difference between a queue that reflects reality and one that quietly
  // drops people.
  Repo.insert(orgId, 'eligibility_checks', {
    client_id: clientId, insurance_id: insuranceId,
    status: bothSides ? 'pending' : 'info_needed',
    requested_at: now(),
    auth_required: 1, referral_required: clean(b.service_line) === 'ot' ? 1 : 0,
    notes: bothSides ? null : 'Waiting on ' + (clean(b.card_front) ? 'the back' : 'both sides') + ' of the insurance card.',
    created_at: now(),
  });

  // ---- the task a human has to act on ----
  Repo.insert(orgId, 'tasks', {
    title: bothSides ? `Verify eligibility & benefits — ${fullName}` : `Request insurance card — ${fullName}`,
    entity_type: 'client', entity_id: clientId,
    status: 'open', priority: bothSides ? 'normal' : 'high',
    due_at: new Date(Date.now() + 2 * 864e5).toISOString(),
    created_at: now(),
  });

  // ---- confirmation into the client's mailbox ----
  const mail = (subject, body) => Repo.insert(orgId, 'messages', {
    channel: 'email', direction: 'out', entity_type: 'client', entity_id: clientId,
    from_addr: 'care@' + (org.slug || 'relay') + '.com', to_addr: clean(b.guardian_email) || '',
    subject, body, status: 'sent', created_at: now(),
  });
  mail(`We received ${fullName}'s intake form`, `Thank you — we have everything we need to begin verifying benefits for ${fullName}.`);
  if (!bothSides) {
    mail('We need a photo of the insurance card',
      `To verify benefits for ${fullName} we still need ${clean(b.card_front) ? 'the back' : 'both sides'} of the insurance card. You can reply to this email with a photo.`);
  }

  // ---- the intake packet ----
  // Sent on submission rather than waiting for a coordinator to remember.
  // Each form becomes a document on the record straight away, marked
  // outstanding, so "what is this family still owing us" is a question the
  // chart answers rather than a folder somebody has to go and check.
  const PACKET = [
    ['Consent for Treatment', 'consents'],
    ['HIPAA / Privacy Acknowledgment', 'consents'],
    ['Financial Responsibility Agreement', 'financial'],
    ['Attendance & Cancellation Policy', 'consents'],
    ['Release of Information', 'consents'],
    ['Photography / Media Consent', 'consents'],
  ];
  for (const [label, category] of PACKET) {
    Repo.insert(orgId, 'client_documents', {
      client_id: clientId, category, label,
      filename: label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf',
      mime_type: 'application/pdf', file_path: null,   // null = sent, not yet returned
      is_required: 1, created_at: now(),
    });
  }
  mail(`Your intake packet for ${fullName}`,
    `Please review and sign the following before your first visit: ${PACKET.map(([l]) => l).join(', ')}. Each one can be signed on your phone.`);
  Repo.insert(orgId, 'tasks', {
    title: `Intake packet outstanding — ${fullName}`,
    entity_type: 'client', entity_id: clientId,
    status: 'open', priority: 'normal',
    due_at: new Date(Date.now() + 5 * 864e5).toISOString(), created_at: now(),
  });

  // ---- the automation log ----
  // Every step, individually, so the demo can point at what Relay did rather
  // than assert it.
  const step = (summary) => Repo.insert(orgId, 'activity_logs', {
    entity_type: 'client', entity_id: clientId, kind: 'automation', summary, created_at: now(),
  });
  step(`Intake form received for ${fullName} (${clean(b.service_line) || 'aba'})`);
  step('Client record created and moved to Intake');
  if (insuranceId) step(`Insurance captured — ${clean(b.carrier) || 'carrier'} ${bothSides ? 'with both sides of the card' : '(card incomplete)'}`);
  step(bothSides ? 'Eligibility & benefits verification queued' : 'Eligibility held — insurance card requested from family');
  step(`Intake packet sent — ${PACKET.length} forms awaiting signature`);
  step('Confirmation email sent to family');

  res.json({
    ok: true, client_id: clientId, name: fullName,
    card_complete: bothSides,
    next: bothSides ? 'Benefits verification has been queued.' : 'We have asked the family for the insurance card.',
  });
});

module.exports = router;
