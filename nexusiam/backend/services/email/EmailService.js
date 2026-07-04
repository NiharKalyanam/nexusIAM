/**
 * NexusIAM Email Service
 * Handles all transactional emails with full HTML templates.
 * Uses Nodemailer. In dev, routes to MailHog (localhost:8025).
 */

const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');
const logger     = require('../../config/logger');
const db         = require('../../config/database');

// ─── Transport — loaded dynamically from security_settings ───────────────────
// Cache transport per tenant (1 min TTL)
const _transportCache = new Map();

async function getTransport(tenantId) {
  const cacheKey = tenantId || 'default';
  const cached = _transportCache.get(cacheKey);
  if (cached && cached.ts > Date.now() - 60000) return cached;

  // Load from DB
  let cfg = null;
  try {
    const { rows } = await db.query(
      `SELECT email_transport, email_smtp_host, email_smtp_port, email_smtp_user,
              email_smtp_pass_vault_ref, email_smtp_from, email_smtp_tls, email_file_path
         FROM security_settings WHERE tenant_id=$1`,
      [tenantId || '00000000-0000-0000-0000-000000000001']
    );
    if (rows.length) cfg = rows[0];
  } catch {}

  const transport   = cfg?.email_transport || process.env.EMAIL_TRANSPORT || 'smtp';
  const from        = cfg?.email_smtp_from || process.env.SMTP_FROM || 'NexusIAM <noreply@nexusiam.io>';
  const filePath    = cfg?.email_file_path || '/tmp/nexusiam-emails';

  let transporter;

  if (transport === 'mailhog') {
    // MailHog — always use hardcoded local defaults regardless of any SMTP fields
    transporter = nodemailer.createTransport({
      host: 'mailhog',
      port: 1025,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
  } else if (transport === 'disabled') {
    // No-op transport
    transporter = { sendMail: async (opts) => { logger.info('[EMAIL] Disabled — suppressed', { to: opts.to, subject: opts.subject }); return {}; } };
  } else if (transport === 'file') {
    // Write to disk as HTML files
    transporter = {
      sendMail: async (opts) => {
        try {
          if (!fs.existsSync(filePath)) fs.mkdirSync(filePath, { recursive: true });
          const ts   = new Date().toISOString().replace(/[:.]/g, '-');
          const dest = path.join(filePath, `email-${ts}-${Math.random().toString(36).slice(2,6)}.html`);
          const body = `<!-- To: ${opts.to} | Subject: ${opts.subject} -->
${opts.html || opts.text}`;
          fs.writeFileSync(dest, body);
          logger.info('[EMAIL] Written to file', { dest, to: opts.to, subject: opts.subject });
          return { messageId: dest };
        } catch (e) {
          logger.error('[EMAIL] File write failed', { error: e.message });
          return {};
        }
      }
    };
  } else {
    // SMTP — resolve password from vault if configured, otherwise fall back to env
    let smtpPass = process.env.SMTP_PASS || '';
    if (cfg?.email_smtp_pass_vault_ref) {
      try {
        const { rows: vRows } = await db.query(
          `SELECT encrypted_value, iv FROM credential_vault WHERE name=$1`,
          [cfg.email_smtp_pass_vault_ref]
        );
        if (vRows.length) {
          const { decryptSecret } = require('../../routes/security');
          smtpPass = decryptSecret(vRows[0].encrypted_value, vRows[0].iv);
        }
      } catch {}
    }

    const host = cfg?.email_smtp_host || process.env.SMTP_HOST || 'mailhog';
    const port = cfg?.email_smtp_port || parseInt(process.env.SMTP_PORT) || 1025;
    const user = cfg?.email_smtp_user || process.env.SMTP_USER;
    const tls  = cfg?.email_smtp_tls !== false;

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass: smtpPass } : undefined,
      tls: { rejectUnauthorized: false },
      ...(tls && port !== 465 ? { requireTLS: false } : {}),
    });
  }

  const result = { transporter, from, transport };
  _transportCache.set(cacheKey, { ...result, ts: Date.now() });
  return result;
}

// Legacy static transport for backward compat (uses env vars / default tenant)
const FROM = process.env.SMTP_FROM || 'NexusIAM <noreply@nexusiam.io>';
const BASE_URL = process.env.APP_URL || 'http://localhost:3000';

// ─── Base HTML Template ───────────────────────────────────────────────────────
function baseTemplate({ title, preheader, body, ctaLabel, ctaUrl, footerNote }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader || ''}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#06b6d4,#8b5cf6);padding:32px 40px;border-radius:12px 12px 0 0;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
            ⬡ NexusIAM
          </div>
          <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">Identity & Access Management</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="background:#1e293b;padding:40px;border-left:1px solid #334155;border-right:1px solid #334155;">
          <h2 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#f1f5f9;">${title}</h2>
          ${body}
          ${ctaLabel && ctaUrl ? `
          <div style="text-align:center;margin:32px 0 8px;">
            <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#8b5cf6);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;">${ctaLabel}</a>
          </div>` : ''}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#0f172a;padding:24px 40px;border-radius:0 0 12px 12px;border:1px solid #1e293b;border-top:none;">
          <div style="font-size:12px;color:#475569;text-align:center;line-height:1.6;">
            ${footerNote || 'This is an automated message from NexusIAM. Please do not reply to this email.'}
            <br/>If you did not expect this email, please contact your IT administrator.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Reusable HTML Snippets ───────────────────────────────────────────────────
function infoRow(label, value) {
  return `<tr>
    <td style="padding:8px 12px;font-size:13px;color:#94a3b8;white-space:nowrap;width:160px;">${label}</td>
    <td style="padding:8px 12px;font-size:13px;color:#f1f5f9;font-weight:500;">${value || '—'}</td>
  </tr>`;
}
function infoTable(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:8px;border:1px solid #334155;margin:20px 0;overflow:hidden;">
    ${rows}
  </table>`;
}
function alertBox(color, icon, text) {
  return `<div style="background:${color}15;border-left:4px solid ${color};border-radius:4px;padding:14px 16px;margin:20px 0;font-size:13px;color:#e2e8f0;line-height:1.6;">
    ${icon} ${text}
  </div>`;
}
function p(text) {
  return `<p style="margin:0 0 16px;font-size:14px;color:#cbd5e1;line-height:1.7;">${text}</p>`;
}
function badge(text, color) {
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${color}20;color:${color};border:1px solid ${color}40;">${text}</span>`;
}

// ─── Send Helper ──────────────────────────────────────────────────────────────
async function send({ to, subject, html, text, tenantId }) {
  if (!to) { logger.warn('[EMAIL] No recipient — skipping'); return; }
  const recipients = Array.isArray(to) ? to.join(', ') : to;
  try {
    const { transporter, from } = await getTransport(tenantId);
    const info = await transporter.sendMail({ from, to: recipients, subject, html, text: text || subject });
    logger.info('[EMAIL] Sent', { to: recipients, subject, messageId: info.messageId });
    return info;
  } catch (err) {
    logger.error('[EMAIL] Failed to send', { to: recipients, subject, error: err.message });
    // Don't throw — email failure should not break the main flow
  }
}



async function sendGenericMail({ to, subject, html, text, tenantId, body }) {
  const bodyHtml = html || (body ? baseTemplate({ title: subject, body }) : baseTemplate({ title: subject, body: p(text || subject) }));
  await send({ to, subject, html: bodyHtml, text: text || subject, tenantId });
}


async function sendApplicationDeleted({ app, deletedBy, justification, deletedConnector, acctCount, entCount, to }) {
  const html = baseTemplate({
    title: '🗑️ Application Deleted',
    preheader: 'Application "' + app.name + '" has been permanently deleted',
    body: `
      ${p('The following application has been <strong style="color:#ef4444;">permanently deleted</strong> from NexusIAM along with all associated data.')}
      ${infoTable([
        infoRow('Application Name', '<strong style="color:#ef4444;">' + app.name + '</strong>'),
        infoRow('Application Type', app.type || '—'),
        infoRow('Deleted By', '<strong>' + deletedBy + '</strong>'),
        infoRow('Deleted On', new Date().toLocaleString()),
        infoRow('Business Justification', '<em>' + justification + '</em>'),
      ])}
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:8px;border:1px solid #334155;margin:20px 0;overflow:hidden;">
        <tr><td style="padding:10px 16px;background:#1e293b;border-bottom:1px solid #334155;" colspan="2">
          <span style="font-size:13px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">Data Cascade Deleted</span>
        </td></tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#94a3b8;width:50%;border-right:1px solid #334155;">🔗 Linked Connector</td>
          <td style="padding:10px 16px;font-size:13px;font-weight:600;color:${deletedConnector ? '#ef4444' : '#10b981'};">
            ${deletedConnector ? '✓ Deleted' : 'Preserved (shared with other apps)'}
          </td>
        </tr>
        <tr style="background:#0a0f1a;">
          <td style="padding:10px 16px;font-size:13px;color:#94a3b8;border-right:1px solid #334155;">👤 Aggregated Accounts</td>
          <td style="padding:10px 16px;font-size:13px;font-weight:600;color:${acctCount > 0 ? '#ef4444' : '#64748b'};">
            ${acctCount > 0 ? '✓ ' + acctCount + ' accounts removed' : 'None found'}
          </td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#94a3b8;border-right:1px solid #334155;">🏷️ Entitlements</td>
          <td style="padding:10px 16px;font-size:13px;font-weight:600;color:${entCount > 0 ? '#ef4444' : '#64748b'};">
            ${entCount > 0 ? '✓ ' + entCount + ' entitlements removed' : 'None found'}
          </td>
        </tr>
        <tr style="background:#0a0f1a;">
          <td style="padding:10px 16px;font-size:13px;color:#94a3b8;border-right:1px solid #334155;">🔑 SCIM Tokens / Schema / Mappings</td>
          <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#ef4444;">✓ All removed</td>
        </tr>
      </table>
      ${alertBox('#ef4444', '⚠️', 'This action is <strong>irreversible</strong>. All data has been permanently removed from NexusIAM.')}
    `,
    ctaLabel: 'View Applications',
    ctaUrl: BASE_URL + '/applications',
    footerNote: 'Application deletion audit — ' + new Date().toISOString(),
  });
  await send({ to, subject: '[NexusIAM] 🗑️ Application Deleted — ' + app.name, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCESS REQUEST EMAILS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sent to requester immediately after submitting a request
 */
async function sendRequestSubmitted({ request, requester }) {
  const html = baseTemplate({
    title: 'Access Request Submitted',
    preheader: `Your request ${request.ticket_number} has been submitted and is pending approval`,
    body: `
      ${p(`Hi ${requester.first_name},`)}
      ${p(`Your access request has been successfully submitted and is now <strong style="color:#f59e0b;">pending approval</strong>. You will be notified once a decision is made.`)}
      ${infoTable([
        infoRow('Ticket Number', `<span style="font-family:monospace;color:#06b6d4;">${request.ticket_number}</span>`),
        infoRow('Requested Role', request.role_name || request.resource_name),
        infoRow('Request Type', request.request_type),
        infoRow('Justification', request.justification),
        infoRow('Submitted', new Date(request.created_at).toLocaleString()),
        infoRow('Priority', badge(request.priority || 'medium', request.priority === 'high' ? '#ef4444' : request.priority === 'urgent' ? '#dc2626' : '#f59e0b')),
      ])}
      ${alertBox('#f59e0b', '⏳', 'Your request is in the approval queue. Typical response time is 1-2 business days. You can track the status using the button below.')}
    `,
    ctaLabel: 'Track Request Status',
    ctaUrl: `${BASE_URL}/access-requests`,
    footerNote: `Request ${request.ticket_number} — NexusIAM Access Management`,
  });
  await send({ to: requester.email, subject: `[NexusIAM] Access Request Submitted — ${request.ticket_number}`, html, tenantId: request.tenant_id });
}

/**
 * Sent to each approver when a new request needs their action
 */
async function sendApprovalRequired({ request, requester, targetUser, approver, stepName, dueDate }) {
  const html = baseTemplate({
    title: 'Action Required: Access Request Approval',
    preheader: `${requester.first_name} ${requester.last_name} has requested access — your approval is needed`,
    body: `
      ${p(`Hi ${approver.first_name},`)}
      ${p(`An access request requires your approval as part of the <strong>${stepName || 'Approval'}</strong> workflow step. Please review and take action.`)}
      ${infoTable([
        infoRow('Ticket Number', `<span style="font-family:monospace;color:#06b6d4;">${request.ticket_number}</span>`),
        infoRow('Requested By', `${requester.first_name} ${requester.last_name} &lt;${requester.email}&gt;`),
        infoRow('For User', targetUser ? `${targetUser.first_name} ${targetUser.last_name} &lt;${targetUser.email}&gt;` : requester.first_name + ' ' + requester.last_name),
        infoRow('Access Requested', request.role_name || request.resource_name),
        infoRow('Request Type', request.request_type),
        infoRow('Justification', request.justification),
        infoRow('Priority', badge(request.priority || 'medium', request.priority === 'urgent' ? '#dc2626' : request.priority === 'high' ? '#ef4444' : '#f59e0b')),
        infoRow('Submitted', new Date(request.created_at).toLocaleString()),
        dueDate ? infoRow('Response Due By', `<strong style="color:#ef4444;">${new Date(dueDate).toLocaleString()}</strong>`) : '',
      ])}
      ${alertBox('#06b6d4', '📋', 'Please review the justification carefully. Approving grants the requested access immediately. Rejecting will notify the requester.')}
    `,
    ctaLabel: 'Review & Approve / Reject',
    ctaUrl: `${BASE_URL}/access-requests`,
    footerNote: `You are receiving this because you are an approver for this request. Ticket: ${request.ticket_number}`,
  });
  await send({ to: approver.email, subject: `[NexusIAM] ⚠️ Approval Required — ${request.ticket_number} — ${request.role_name || request.resource_name}`, html, tenantId: request.tenant_id });
}

/**
 * Sent to requester when their request is approved
 */
async function sendRequestApproved({ request, requester, approver, accessDetails }) {
  const html = baseTemplate({
    title: '✅ Access Request Approved',
    preheader: `Great news! Your request ${request.ticket_number} has been approved`,
    body: `
      ${p(`Hi ${requester.first_name},`)}
      ${p(`Your access request has been <strong style="color:#10b981;">approved</strong> by ${approver.first_name} ${approver.last_name}. Access has been provisioned automatically.`)}
      ${infoTable([
        infoRow('Ticket Number', `<span style="font-family:monospace;color:#06b6d4;">${request.ticket_number}</span>`),
        infoRow('Access Granted', `<strong style="color:#10b981;">${request.role_name || request.resource_name}</strong>`),
        infoRow('Approved By', `${approver.first_name} ${approver.last_name}`),
        infoRow('Approved On', new Date().toLocaleString()),
        request.access_expires_at ? infoRow('Access Expires', `<strong style="color:#f59e0b;">${new Date(request.access_expires_at).toLocaleString()}</strong>`) : '',
        approver.comments ? infoRow('Approver Comments', `<em>${approver.comments}</em>`) : '',
      ])}
      ${accessDetails ? alertBox('#10b981', '🔑', `<strong>Provisioning complete.</strong> ${accessDetails}`) : alertBox('#10b981', '🔑', 'Your access has been provisioned. You may need to log out and log back in to the target application for the access to take effect.')}
      ${request.access_expires_at ? alertBox('#f59e0b', '⏰', `This access is <strong>temporary</strong> and will automatically expire on ${new Date(request.access_expires_at).toLocaleString()}. Submit a new request before then if you need continued access.`) : ''}
    `,
    ctaLabel: 'View My Access',
    ctaUrl: `${BASE_URL}/access-requests`,
  });
  await send({ to: requester.email, subject: `[NexusIAM] ✅ Access Approved — ${request.ticket_number} — ${request.role_name || request.resource_name}`, html, tenantId: request.tenant_id });
}

/**
 * Sent to requester when their request is rejected
 */
async function sendRequestRejected({ request, requester, approver, reason }) {
  const html = baseTemplate({
    title: '❌ Access Request Rejected',
    preheader: `Your request ${request.ticket_number} has been rejected`,
    body: `
      ${p(`Hi ${requester.first_name},`)}
      ${p(`Unfortunately, your access request has been <strong style="color:#ef4444;">rejected</strong> by ${approver.first_name} ${approver.last_name}.`)}
      ${infoTable([
        infoRow('Ticket Number', `<span style="font-family:monospace;color:#06b6d4;">${request.ticket_number}</span>`),
        infoRow('Access Requested', request.role_name || request.resource_name),
        infoRow('Rejected By', `${approver.first_name} ${approver.last_name}`),
        infoRow('Rejected On', new Date().toLocaleString()),
        infoRow('Reason', `<strong style="color:#ef4444;">${reason || 'No reason provided'}</strong>`),
      ])}
      ${alertBox('#ef4444', '❌', reason ? `<strong>Reason for rejection:</strong> ${reason}` : 'The approver did not provide a specific reason. Please contact your manager or the IT team for clarification.')}
      ${p('If you believe this decision was made in error, you may resubmit the request with additional justification, or contact your manager to escalate.')}
    `,
    ctaLabel: 'Submit New Request',
    ctaUrl: `${BASE_URL}/access-requests`,
  });
  await send({ to: requester.email, subject: `[NexusIAM] ❌ Access Request Rejected — ${request.ticket_number}`, html, tenantId: request.tenant_id });
}

/**
 * Sent to approver when a request is forwarded/delegated to them
 */
async function sendRequestForwarded({ request, requester, fromApprover, toApprover, reason }) {
  const html = baseTemplate({
    title: '↪ Access Request Forwarded to You',
    preheader: `${fromApprover.first_name} forwarded an approval request to you`,
    body: `
      ${p(`Hi ${toApprover.first_name},`)}
      ${p(`An access request has been <strong style="color:#06b6d4;">forwarded</strong> to you by ${fromApprover.first_name} ${fromApprover.last_name} for your review and decision.`)}
      ${infoTable([
        infoRow('Ticket Number', `<span style="font-family:monospace;color:#06b6d4;">${request.ticket_number}</span>`),
        infoRow('Requested By', `${requester.first_name} ${requester.last_name}`),
        infoRow('Access Requested', request.role_name || request.resource_name),
        infoRow('Forwarded By', `${fromApprover.first_name} ${fromApprover.last_name}`),
        infoRow('Forward Reason', reason || 'Delegated for review'),
        infoRow('Original Submission', new Date(request.created_at).toLocaleString()),
      ])}
      ${alertBox('#06b6d4', '↪', `<strong>${fromApprover.first_name}</strong> delegated this approval to you. Please review and take action at your earliest convenience.`)}
    `,
    ctaLabel: 'Review Request',
    ctaUrl: `${BASE_URL}/access-requests`,
  });
  await send({ to: toApprover.email, subject: `[NexusIAM] ↪ Forwarded Approval — ${request.ticket_number} — Action Required`, html, tenantId: request.tenant_id });
}

/**
 * Reminder sent to approver when request is still pending after X days
 */
async function sendApprovalReminder({ request, requester, approver, daysPending, dueDate }) {
  const html = baseTemplate({
    title: `⏰ Reminder: Approval Pending ${daysPending} Day${daysPending > 1 ? 's' : ''}`,
    preheader: `Access request ${request.ticket_number} is still waiting for your approval`,
    body: `
      ${p(`Hi ${approver.first_name},`)}
      ${p(`This is a reminder that an access request submitted by <strong>${requester.first_name} ${requester.last_name}</strong> is still <strong style="color:#f59e0b;">waiting for your approval</strong> after <strong>${daysPending} day${daysPending > 1 ? 's' : ''}</strong>.`)}
      ${infoTable([
        infoRow('Ticket Number', `<span style="font-family:monospace;color:#06b6d4;">${request.ticket_number}</span>`),
        infoRow('Requested By', `${requester.first_name} ${requester.last_name}`),
        infoRow('Access Requested', request.role_name || request.resource_name),
        infoRow('Submitted', new Date(request.created_at).toLocaleString()),
        infoRow('Days Pending', `<strong style="color:#f59e0b;">${daysPending} days</strong>`),
        dueDate ? infoRow('Expires If No Action', `<strong style="color:#ef4444;">${new Date(dueDate).toLocaleString()}</strong>`) : '',
      ])}
      ${alertBox('#f59e0b', '⏰', 'Please take action on this request. If it expires without a decision, it will be automatically cancelled and the requester will be notified.')}
    `,
    ctaLabel: 'Take Action Now',
    ctaUrl: `${BASE_URL}/access-requests`,
  });
  await send({ to: approver.email, subject: `[NexusIAM] ⏰ Reminder — Pending Approval — ${request.ticket_number} (${daysPending}d)`, html, tenantId: request.tenant_id });
}

/**
 * Sent when a request expires with no decision
 */
async function sendRequestExpired({ request, requester, approvers }) {
  // Email requester
  const requesterHtml = baseTemplate({
    title: '⌛ Access Request Expired',
    preheader: `Your request ${request.ticket_number} expired without a decision`,
    body: `
      ${p(`Hi ${requester.first_name},`)}
      ${p(`Your access request has <strong style="color:#ef4444;">expired</strong> because no action was taken by the approver within the allowed time window.`)}
      ${infoTable([
        infoRow('Ticket Number', `<span style="font-family:monospace;color:#06b6d4;">${request.ticket_number}</span>`),
        infoRow('Access Requested', request.role_name || request.resource_name),
        infoRow('Submitted', new Date(request.created_at).toLocaleString()),
        infoRow('Expired On', new Date().toLocaleString()),
      ])}
      ${alertBox('#64748b', '⌛', 'You may resubmit this request. Please ensure your justification is detailed enough for approvers to act quickly.')}
    `,
    ctaLabel: 'Resubmit Request',
    ctaUrl: `${BASE_URL}/access-requests`,
  });
  await send({ to: requester.email, subject: `[NexusIAM] ⌛ Request Expired — ${request.ticket_number}`, html: requesterHtml });

  // Email approvers who didn't act
  for (const approver of (approvers || [])) {
    const approverHtml = baseTemplate({
      title: '⌛ Access Request Expired — No Action Taken',
      preheader: `Request ${request.ticket_number} expired waiting for your decision`,
      body: `
        ${p(`Hi ${approver.first_name},`)}
        ${p(`The access request below expired because no decision was recorded in time. The requester has been notified.`)}
        ${infoTable([
          infoRow('Ticket Number', `<span style="font-family:monospace;color:#06b6d4;">${request.ticket_number}</span>`),
          infoRow('Requested By', `${requester.first_name} ${requester.last_name}`),
          infoRow('Access Requested', request.role_name || request.resource_name),
          infoRow('Expired', new Date().toLocaleString()),
        ])}
        ${alertBox('#64748b', '⌛', 'No further action is required on this expired request. The requester may resubmit if still needed.')}
      `,
      ctaLabel: 'View Requests',
      ctaUrl: `${BASE_URL}/access-requests`,
    });
    await send({ to: approver.email, subject: `[NexusIAM] ⌛ Expired Request (No Action) — ${request.ticket_number}`, html: approverHtml });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVISIONING / DEPROVISIONING EMAILS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sent to user when access is provisioned to a target application
 */
async function sendAccessProvisioned({ user, role, applications, provisionedBy }) {
  const html = baseTemplate({
    title: '🔑 Access Provisioned',
    preheader: `Your access to ${role} has been set up`,
    body: `
      ${p(`Hi ${user.first_name},`)}
      ${p(`Your access has been successfully <strong style="color:#10b981;">provisioned</strong> in the following system(s):`)}
      ${infoTable([
        infoRow('Role / Access', `<strong style="color:#10b981;">${role}</strong>`),
        infoRow('Applications', (applications || ['NexusIAM']).join(', ')),
        infoRow('Provisioned By', provisionedBy || 'NexusIAM Automation'),
        infoRow('Provisioned On', new Date().toLocaleString()),
      ])}
      ${alertBox('#10b981', '✅', 'Access is now active. You may need to log out and log back in to affected applications. If you experience issues accessing any system, please contact the IT Help Desk.')}
    `,
    ctaLabel: 'View My Access',
    ctaUrl: `${BASE_URL}/profile`,
  });
  await send({ to: user.email, subject: `[NexusIAM] 🔑 Access Provisioned — ${role}`, html, tenantId: user.tenant_id });
}

/**
 * Sent to user when access is deprovisioned/revoked
 */
async function sendAccessDeprovisioned({ user, role, reason, revokedBy, applications }) {
  const html = baseTemplate({
    title: '🔒 Access Revoked',
    preheader: `Your access to ${role} has been removed`,
    body: `
      ${p(`Hi ${user.first_name},`)}
      ${p(`Your access has been <strong style="color:#ef4444;">revoked</strong> from the following system(s). This may have happened due to a certification review decision, policy enforcement, or an administrative action.`)}
      ${infoTable([
        infoRow('Access Revoked', `<strong style="color:#ef4444;">${role}</strong>`),
        infoRow('Applications Affected', (applications || ['NexusIAM']).join(', ')),
        infoRow('Revoked By', revokedBy || 'NexusIAM Policy Engine'),
        infoRow('Revoked On', new Date().toLocaleString()),
        infoRow('Reason', reason || 'Administrative decision'),
      ])}
      ${alertBox('#ef4444', '🔒', 'If you believe this was done in error, please contact your manager or submit a new access request with justification.')}
    `,
    ctaLabel: 'Submit New Access Request',
    ctaUrl: `${BASE_URL}/access-requests`,
  });
  await send({ to: user.email, subject: `[NexusIAM] 🔒 Access Revoked — ${role}`, html, tenantId: user.tenant_id });
}

/**
 * Sent to IT/admin team when a user is fully deprovisioned (account deactivated)
 */
async function sendUserDeprovisioned({ user, deactivatedBy, connectorsSynced, reason }) {
  const html = baseTemplate({
    title: '👤 User Account Deprovisioned',
    preheader: `${user.first_name} ${user.last_name}'s account has been deprovisioned`,
    body: `
      ${p(`This is an automated notification that the following user account has been <strong style="color:#ef4444;">deprovisioned</strong> from NexusIAM and all connected systems.`)}
      ${infoTable([
        infoRow('User', `${user.first_name} ${user.last_name}`),
        infoRow('Email', user.email),
        infoRow('Username', user.username),
        infoRow('Employee ID', user.employee_id || '—'),
        infoRow('Deactivated By', deactivatedBy || 'System'),
        infoRow('Deactivated On', new Date().toLocaleString()),
        infoRow('Reason', reason || 'Administrative action'),
        infoRow('Systems Deprovisioned', (connectorsSynced || []).join(', ') || 'All connected systems'),
      ])}
      ${alertBox('#ef4444', '⚠️', 'All active roles have been revoked. All connector accounts have been disabled/deleted. Ensure physical access and hardware is also reclaimed.')}
    `,
    ctaLabel: 'View User in NexusIAM',
    ctaUrl: `${BASE_URL}/users`,
  });
  // Send to IT/admin team
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.SMTP_FROM || 'admin@nexusiam.io';
  await send({ to: adminEmail, subject: `[NexusIAM] 👤 User Deprovisioned — ${user.first_name} ${user.last_name}`, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CERTIFICATION EMAILS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sent to all reviewers when a certification campaign launches
 */
async function sendCertificationLaunched({ campaign, reviewer, itemCount, dueDate }) {
  const html = baseTemplate({
    title: '📋 Access Certification Required',
    preheader: `You have ${itemCount} access items to review in certification campaign "${campaign.name}"`,
    body: `
      ${p(`Hi ${reviewer.first_name},`)}
      ${p(`An access certification campaign has been launched and you have <strong style="color:#f59e0b;">${itemCount} item${itemCount > 1 ? 's' : ''}</strong> assigned to you for review. Please review each item and certify or revoke access.`)}
      ${infoTable([
        infoRow('Campaign', `<strong>${campaign.name}</strong>`),
        infoRow('Campaign Type', campaign.type?.replace(/_/g, ' ')),
        infoRow('Items Assigned to You', `<strong style="color:#f59e0b;">${itemCount}</strong>`),
        infoRow('Launched On', new Date().toLocaleString()),
        infoRow('Due Date', `<strong style="color:#ef4444;">${new Date(dueDate).toLocaleString()}</strong>`),
        infoRow('Description', campaign.description || 'Periodic access review'),
      ])}
      ${alertBox('#f59e0b', '📋', `You must <strong>Certify</strong> (confirm access is appropriate) or <strong>Revoke</strong> (remove access) for each item assigned to you. Access that is not reviewed by the due date may be automatically revoked.`)}
      ${alertBox('#06b6d4', 'ℹ️', 'If you believe an access assignment is incorrect or should be reviewed by someone else, use the "Reassign" option within the certification interface.')}
    `,
    ctaLabel: `Review ${itemCount} Items Now`,
    ctaUrl: `${BASE_URL}/certifications`,
    footerNote: `Campaign: ${campaign.name} — Due: ${new Date(dueDate).toLocaleDateString()}`,
  });
  await send({ to: reviewer.email, subject: `[NexusIAM] 📋 Action Required — Access Certification: ${campaign.name} (${itemCount} items)`, html });
}

/**
 * Reminder sent when certification due date is approaching
 */
async function sendCertificationReminder({ campaign, reviewer, pendingCount, daysRemaining, dueDate }) {
  const urgency = daysRemaining <= 2 ? 'URGENT' : daysRemaining <= 5 ? 'Reminder' : 'Reminder';
  const urgencyColor = daysRemaining <= 2 ? '#ef4444' : '#f59e0b';
  const html = baseTemplate({
    title: `⏰ ${urgency}: ${pendingCount} Certification Items Still Pending`,
    preheader: `${pendingCount} items still need review — due in ${daysRemaining} day(s)`,
    body: `
      ${p(`Hi ${reviewer.first_name},`)}
      ${p(`You still have <strong style="color:${urgencyColor};">${pendingCount} item${pendingCount > 1 ? 's' : ''}</strong> pending review in the <strong>${campaign.name}</strong> certification campaign. The due date is approaching.`)}
      ${infoTable([
        infoRow('Campaign', campaign.name),
        infoRow('Pending Items', `<strong style="color:${urgencyColor};">${pendingCount} items</strong>`),
        infoRow('Days Remaining', `<strong style="color:${urgencyColor};">${daysRemaining} day${daysRemaining > 1 ? 's' : ''}</strong>`),
        infoRow('Due Date', `<strong style="color:#ef4444;">${new Date(dueDate).toLocaleString()}</strong>`),
      ])}
      ${alertBox(urgencyColor, '⏰', daysRemaining <= 2
        ? `<strong>URGENT:</strong> Certification closes in ${daysRemaining} day(s). Unreviewed items may be automatically revoked.`
        : `Please complete your review before the due date to avoid automatic access revocation decisions.`)}
    `,
    ctaLabel: `Complete Review (${pendingCount} pending)`,
    ctaUrl: `${BASE_URL}/certifications`,
  });
  await send({ to: reviewer.email, subject: `[NexusIAM] ⏰ ${urgency} — ${pendingCount} Cert Items Pending — ${campaign.name} (${daysRemaining}d left)`, html });
}

/**
 * Sent to user when their access is revoked as a result of certification
 */
async function sendAccessRevokedByCertification({ user, role, campaign, reviewer, reason }) {
  const html = baseTemplate({
    title: '🔒 Access Revoked — Certification Decision',
    preheader: `Your access to ${role} was revoked following an access certification review`,
    body: `
      ${p(`Hi ${user.first_name},`)}
      ${p(`Following a periodic access certification review, your access to <strong style="color:#ef4444;">${role}</strong> has been <strong>revoked</strong>.`)}
      ${infoTable([
        infoRow('Access Revoked', `<strong style="color:#ef4444;">${role}</strong>`),
        infoRow('Review Campaign', campaign.name),
        infoRow('Reviewed By', `${reviewer.first_name} ${reviewer.last_name}`),
        infoRow('Decision', badge('Revoke', '#ef4444')),
        infoRow('Effective Date', new Date().toLocaleString()),
        reason ? infoRow('Reason', reason) : '',
      ])}
      ${alertBox('#ef4444', '🔒', 'Access certifications are a standard security control. If you need this access for your job responsibilities, please submit a new access request with a detailed business justification.')}
    `,
    ctaLabel: 'Request Access Again',
    ctaUrl: `${BASE_URL}/access-requests`,
  });
  await send({ to: user.email, subject: `[NexusIAM] 🔒 Access Revoked by Certification — ${role}`, html, tenantId: user.tenant_id });
}

/**
 * Sent when a certification campaign completes
 */
async function sendCertificationComplete({ campaign, owner, stats }) {
  const html = baseTemplate({
    title: '✅ Certification Campaign Complete',
    preheader: `Campaign "${campaign.name}" has been completed`,
    body: `
      ${p(`Hi ${owner.first_name},`)}
      ${p(`The access certification campaign <strong>${campaign.name}</strong> has been completed.`)}
      ${infoTable([
        infoRow('Campaign', campaign.name),
        infoRow('Completed On', new Date().toLocaleString()),
        infoRow('Total Items', stats.total),
        infoRow('Certified (kept)', `<strong style="color:#10b981;">${stats.certified}</strong>`),
        infoRow('Revoked', `<strong style="color:#ef4444;">${stats.revoked}</strong>`),
        infoRow('Not Reviewed', `<strong style="color:#f59e0b;">${stats.pending}</strong>`),
      ])}
      ${alertBox('#10b981', '✅', `${stats.revoked} access assignments were revoked. Deprovisioning has been triggered automatically for all revoked items.`)}
    `,
    ctaLabel: 'View Campaign Report',
    ctaUrl: `${BASE_URL}/certifications`,
  });
  await send({ to: owner.email, subject: `[NexusIAM] ✅ Certification Complete — ${campaign.name}`, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOD / POLICY EMAILS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sent when a SoD violation is detected for a user
 */
async function sendSodViolationDetected({ user, policy, violationType, roles, severity, complianceEmail }) {
  const severityColor = severity === 'critical' ? '#dc2626' : severity === 'high' ? '#ef4444' : '#f59e0b';
  const html = baseTemplate({
    title: `⚠️ SoD Violation Detected — ${severity?.toUpperCase()}`,
    preheader: `A Separation of Duties violation was found for ${user.first_name} ${user.last_name}`,
    body: `
      ${p('A <strong>Separation of Duties (SoD) violation</strong> has been detected by the NexusIAM Policy Engine. Immediate review is recommended.')}
      ${infoTable([
        infoRow('User', `${user.first_name} ${user.last_name} &lt;${user.email}&gt;`),
        infoRow('Policy Violated', `<strong>${policy.name}</strong>`),
        infoRow('Violation Type', `<span style="font-family:monospace;color:#f59e0b;">${violationType}</span>`),
        infoRow('Conflicting Roles', (roles || []).join(' + ')),
        infoRow('Severity', badge(severity, severityColor)),
        infoRow('Detected', new Date().toLocaleString()),
        infoRow('Policy Enforcement', policy.enforcement),
      ])}
      ${alertBox(severityColor, '⚠️', severity === 'critical'
        ? '<strong>CRITICAL:</strong> This violation may represent a significant control weakness. Immediate action is required to remediate.'
        : 'Review this violation and determine whether access should be adjusted to restore compliance.')}
    `,
    ctaLabel: 'View Violations',
    ctaUrl: `${BASE_URL}/policies`,
  });
  const recipients = [user.email];
  if (complianceEmail) recipients.push(complianceEmail);
  await send({ to: recipients, subject: `[NexusIAM] ⚠️ SoD Violation — ${severity?.toUpperCase()} — ${user.first_name} ${user.last_name} — ${policy.name}`, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAB CASE EMAILS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sent to CAB members when a new case is submitted
 */
async function sendCabCaseSubmitted({ cabCase, requester, cabMembers }) {
  for (const member of (cabMembers || [])) {
    const html = baseTemplate({
      title: '📝 New CAB Case Submitted',
      preheader: `CAB case ${cabCase.case_number} requires your review`,
      body: `
        ${p(`Hi ${member.first_name},`)}
        ${p(`A new Change Advisory Board (CAB) case has been submitted and requires review.`)}
        ${infoTable([
          infoRow('Case Number', `<span style="font-family:monospace;color:#06b6d4;">${cabCase.case_number}</span>`),
          infoRow('Title', `<strong>${cabCase.title}</strong>`),
          infoRow('Change Type', cabCase.type?.replace(/_/g, ' ')),
          infoRow('Risk Level', badge(cabCase.risk_level, cabCase.risk_level === 'critical' ? '#dc2626' : cabCase.risk_level === 'high' ? '#ef4444' : '#f59e0b')),
          infoRow('Submitted By', `${requester.first_name} ${requester.last_name}`),
          infoRow('Planned Start', cabCase.planned_start ? new Date(cabCase.planned_start).toLocaleString() : 'TBD'),
          infoRow('Planned End', cabCase.planned_end ? new Date(cabCase.planned_end).toLocaleString() : 'TBD'),
          infoRow('Description', cabCase.description),
        ])}
        ${alertBox('#06b6d4', '📝', 'Please review the implementation plan and rollback plan before approving. High and critical risk changes require unanimous CAB approval.')}
      `,
      ctaLabel: 'Review CAB Case',
      ctaUrl: `${BASE_URL}/cab`,
    });
    await send({ to: member.email, subject: `[NexusIAM] 📝 CAB Review Required — ${cabCase.case_number} — ${cabCase.title}`, html });
  }
}

/**
 * Sent to requester when CAB case is approved or rejected
 */
async function sendCabDecision({ cabCase, requester, decision, decidedBy, reason }) {
  const approved = decision === 'approved';
  const html = baseTemplate({
    title: approved ? '✅ CAB Case Approved' : '❌ CAB Case Rejected',
    preheader: `Your CAB case ${cabCase.case_number} has been ${decision}`,
    body: `
      ${p(`Hi ${requester.first_name},`)}
      ${p(`Your Change Advisory Board case has been <strong style="color:${approved ? '#10b981' : '#ef4444'};">${decision}</strong>.`)}
      ${infoTable([
        infoRow('Case Number', `<span style="font-family:monospace;color:#06b6d4;">${cabCase.case_number}</span>`),
        infoRow('Title', cabCase.title),
        infoRow('Decision', badge(decision, approved ? '#10b981' : '#ef4444')),
        infoRow('Decided By', decidedBy),
        infoRow('Decision Date', new Date().toLocaleString()),
        reason ? infoRow(approved ? 'Comments' : 'Rejection Reason', reason) : '',
      ])}
      ${approved
        ? alertBox('#10b981', '✅', 'You may proceed with the planned implementation. Ensure you follow the implementation plan and have the rollback plan ready.')
        : alertBox('#ef4444', '❌', reason ? `<strong>Reason:</strong> ${reason}` : 'Please review the feedback and resubmit with additional detail or revised plans.')}
    `,
    ctaLabel: 'View CAB Cases',
    ctaUrl: `${BASE_URL}/cab`,
  });
  await send({ to: requester.email, subject: `[NexusIAM] ${approved ? '✅' : '❌'} CAB ${decision.charAt(0).toUpperCase() + decision.slice(1)} — ${cabCase.case_number} — ${cabCase.title}`, html });
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER ACCOUNT EMAILS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Welcome email for new users
 */
async function sendWelcomeEmail({ user, tempPassword, tenantSlug }) {
  const html = baseTemplate({
    title: '👋 Welcome to NexusIAM',
    preheader: 'Your NexusIAM account has been created',
    body: `
      ${p(`Hi ${user.first_name},`)}
      ${p('Your NexusIAM Identity & Access Management account has been created. You can now log in and manage your access requests, view your assigned roles, and update your profile.')}
      ${infoTable([
        infoRow('Platform URL', `<a href="${BASE_URL}" style="color:#06b6d4;">${BASE_URL}</a>`),
        infoRow('Tenant', tenantSlug || 'demo'),
        infoRow('Username', `<span style="font-family:monospace;">${user.username}</span>`),
        infoRow('Email', user.email),
        tempPassword ? infoRow('Temporary Password', `<span style="font-family:monospace;background:#0f172a;padding:2px 8px;border-radius:4px;color:#f59e0b;">${tempPassword}</span>`) : '',
      ])}
      ${tempPassword ? alertBox('#f59e0b', '🔐', '<strong>Security:</strong> You must change your temporary password on first login. Your password must be at least 12 characters and include uppercase, lowercase, numbers, and symbols.') : ''}
      ${alertBox('#06b6d4', '💡', 'Set up Multi-Factor Authentication (MFA) after your first login to secure your account. Go to Profile → Two-Factor Authentication.')}
    `,
    ctaLabel: 'Log In to NexusIAM',
    ctaUrl: BASE_URL,
  });
  await send({ to: user.email, subject: `[NexusIAM] 👋 Welcome — Your Account is Ready`, html, tenantId: user.tenant_id });
}

/**
 * Password expiry warning — sent 7 days before expiry
 */
async function sendPasswordExpiryWarning({ user, daysRemaining, expiryDate }) {
  const html = baseTemplate({
    title: `🔐 Password Expiring in ${daysRemaining} Day${daysRemaining > 1 ? 's' : ''}`,
    preheader: `Your NexusIAM password expires on ${new Date(expiryDate).toLocaleDateString()}`,
    body: `
      ${p(`Hi ${user.first_name},`)}
      ${p(`Your NexusIAM password will expire in <strong style="color:#f59e0b;">${daysRemaining} day${daysRemaining > 1 ? 's' : ''}</strong>. Please update it before it expires to avoid being locked out.`)}
      ${infoTable([
        infoRow('Account', user.username),
        infoRow('Expires On', `<strong style="color:#ef4444;">${new Date(expiryDate).toLocaleString()}</strong>`),
        infoRow('Days Remaining', `<strong style="color:#f59e0b;">${daysRemaining} days</strong>`),
      ])}
      ${alertBox('#f59e0b', '🔐', 'After expiry, your account will be locked and you will need to contact IT to reset it. Change your password now to avoid disruption.')}
    `,
    ctaLabel: 'Change Password Now',
    ctaUrl: `${BASE_URL}/profile`,
  });
  await send({ to: user.email, subject: `[NexusIAM] 🔐 Password Expires in ${daysRemaining} Day${daysRemaining > 1 ? 's' : ''} — Action Required`, html, tenantId: user.tenant_id });
}

/**
 * Sent when account is locked due to failed attempts
 */
async function sendAccountLocked({ user, reason, ipAddress }) {
  const html = baseTemplate({
    title: '🔒 Account Locked',
    preheader: 'Your NexusIAM account has been locked',
    body: `
      ${p(`Hi ${user.first_name},`)}
      ${p('Your NexusIAM account has been <strong style="color:#ef4444;">temporarily locked</strong> due to multiple failed login attempts.')}
      ${infoTable([
        infoRow('Account', user.username),
        infoRow('Locked At', new Date().toLocaleString()),
        infoRow('Reason', reason || 'Too many failed login attempts'),
        ipAddress ? infoRow('Originating IP', `<span style="font-family:monospace;">${ipAddress}</span>`) : '',
      ])}
      ${alertBox('#ef4444', '🔒', 'If this was not you, your credentials may be compromised. Contact your IT administrator immediately.')}
      ${alertBox('#f59e0b', '💡', 'To unlock your account, contact your IT Help Desk or your manager. Alternatively, use the "Forgot Password" option on the login page if available.')}
    `,
    ctaLabel: 'Contact IT Help Desk',
    ctaUrl: `${BASE_URL}/login`,
  });
  await send({ to: user.email, subject: `[NexusIAM] 🔒 Account Locked — ${user.username}`, html, tenantId: user.tenant_id });
}

/**
 * Sent when MFA is newly enrolled
 */
async function sendMfaEnrolled({ user }) {
  const html = baseTemplate({
    title: '✅ MFA Enabled on Your Account',
    preheader: 'Multi-Factor Authentication has been activated',
    body: `
      ${p(`Hi ${user.first_name},`)}
      ${p('Multi-Factor Authentication (MFA) has been successfully enabled on your NexusIAM account. Your account is now more secure.')}
      ${infoTable([
        infoRow('Account', user.username),
        infoRow('MFA Type', 'TOTP (Time-based One-Time Password)'),
        infoRow('Enrolled On', new Date().toLocaleString()),
      ])}
      ${alertBox('#10b981', '✅', 'You will now be required to enter a 6-digit code from your authenticator app at each login. Store your recovery codes in a safe place.')}
      ${alertBox('#ef4444', '⚠️', 'If you did NOT enable MFA yourself, your account may be compromised. Contact IT immediately and change your password.')}
    `,
    ctaLabel: 'View Account Security',
    ctaUrl: `${BASE_URL}/profile`,
  });
  await send({ to: user.email, subject: `[NexusIAM] ✅ MFA Enabled — ${user.username}`, html, tenantId: user.tenant_id });
}

/**
 * Sent when access is about to expire (temporary access)
 */
async function sendAccessExpiryWarning({ user, role, expiryDate, daysRemaining }) {
  const html = baseTemplate({
    title: `⏰ Access Expiring in ${daysRemaining} Day${daysRemaining > 1 ? 's' : ''}`,
    preheader: `Your access to ${role} expires soon`,
    body: `
      ${p(`Hi ${user.first_name},`)}
      ${p(`Your temporary access to <strong style="color:#f59e0b;">${role}</strong> is expiring in <strong>${daysRemaining} day${daysRemaining > 1 ? 's' : ''}</strong>.`)}
      ${infoTable([
        infoRow('Access', role),
        infoRow('Expires On', `<strong style="color:#ef4444;">${new Date(expiryDate).toLocaleString()}</strong>`),
        infoRow('Days Remaining', `<strong style="color:#f59e0b;">${daysRemaining} days</strong>`),
      ])}
      ${alertBox('#f59e0b', '⏰', 'If you still need this access after the expiry date, please submit a new access request now to avoid disruption to your work.')}
    `,
    ctaLabel: 'Extend Access',
    ctaUrl: `${BASE_URL}/access-requests`,
  });
  await send({ to: user.email, subject: `[NexusIAM] ⏰ Access Expiring Soon — ${role} (${daysRemaining} days)`, html, tenantId: user.tenant_id });
}

// ─── Export All ───────────────────────────────────────────────────────────────
// ── Workgroup: Member Added ───────────────────────────────────────────────────
async function sendWorkgroupMemberAdded({ toEmail, toName, workgroupName, groupEmail, notificationSetting }) {
  if (!toEmail) return;
  const sendToMember = ['members_and_email', 'members_only'].includes(notificationSetting);
  const sendToGroup  = ['members_and_email', 'email_only'].includes(notificationSetting);

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);padding:32px 40px">
        <div style="font-size:22px;font-weight:700;color:#fff">NexusIAM</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px">Identity & Access Management</div>
      </div>
      <div style="padding:32px 40px">
        <h2 style="color:#38bdf8;margin:0 0 16px">Workgroup Membership Added</h2>
        <p style="color:#94a3b8;margin:0 0 24px">Hi ${toName || toEmail},</p>
        <p style="color:#cbd5e1">You have been added to the workgroup <strong style="color:#f8fafc">${workgroupName}</strong>.</p>
        <div style="background:#1e2a3a;border-radius:8px;padding:16px;margin:20px 0;border-left:4px solid #3b82f6">
          <div style="color:#94a3b8;font-size:13px">Workgroup</div>
          <div style="color:#f8fafc;font-weight:600;font-size:16px;margin-top:4px">${workgroupName}</div>
        </div>
        <p style="color:#94a3b8;font-size:13px">If you believe this was done in error, please contact your IAM administrator.</p>
      </div>
      <div style="padding:16px 40px;background:#0a0f1a;text-align:center;font-size:12px;color:#475569">
        NexusIAM · Automated notification · Do not reply
      </div>
    </div>`;

  const promises = [];
  if (sendToMember && toEmail) promises.push(sendMail(toEmail, `Added to workgroup: ${workgroupName}`, html));
  if (sendToGroup && groupEmail) promises.push(sendMail(groupEmail, `Member added to ${workgroupName}`, html));
  await Promise.allSettled(promises);
}

// ── Workgroup: Member Removed ─────────────────────────────────────────────────
async function sendWorkgroupMemberRemoved({ toEmail, toName, workgroupName, groupEmail, notificationSetting }) {
  if (!toEmail) return;
  const sendToMember = ['members_and_email', 'members_only'].includes(notificationSetting);
  const sendToGroup  = ['members_and_email', 'email_only'].includes(notificationSetting);

  const html = `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);padding:32px 40px">
        <div style="font-size:22px;font-weight:700;color:#fff">NexusIAM</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px">Identity & Access Management</div>
      </div>
      <div style="padding:32px 40px">
        <h2 style="color:#f97316;margin:0 0 16px">Workgroup Membership Removed</h2>
        <p style="color:#94a3b8;margin:0 0 24px">Hi ${toName || toEmail},</p>
        <p style="color:#cbd5e1">You have been removed from the workgroup <strong style="color:#f8fafc">${workgroupName}</strong>.</p>
        <div style="background:#1e2a3a;border-radius:8px;padding:16px;margin:20px 0;border-left:4px solid #f97316">
          <div style="color:#94a3b8;font-size:13px">Workgroup</div>
          <div style="color:#f8fafc;font-weight:600;font-size:16px;margin-top:4px">${workgroupName}</div>
        </div>
        <p style="color:#94a3b8;font-size:13px">If you believe this was done in error, please contact your IAM administrator.</p>
      </div>
      <div style="padding:16px 40px;background:#0a0f1a;text-align:center;font-size:12px;color:#475569">
        NexusIAM · Automated notification · Do not reply
      </div>
    </div>`;

  const promises = [];
  if (sendToMember && toEmail) promises.push(sendMail(toEmail, `Removed from workgroup: ${workgroupName}`, html));
  if (sendToGroup && groupEmail) promises.push(sendMail(groupEmail, `Member removed from ${workgroupName}`, html));
  await Promise.allSettled(promises);
}

module.exports = { _transportCache,
  // Access Requests
  sendRequestSubmitted,
  sendApprovalRequired,
  sendRequestApproved,
  sendRequestRejected,
  sendRequestForwarded,
  sendApprovalReminder,
  sendRequestExpired,
  // Provisioning
  sendAccessProvisioned,
  sendAccessDeprovisioned,
  sendUserDeprovisioned,
  // Certifications
  sendCertificationLaunched,
  sendCertificationReminder,
  sendAccessRevokedByCertification,
  sendCertificationComplete,
  // SoD / Policy
  sendSodViolationDetected,
  // CAB
  sendCabCaseSubmitted,
  sendCabDecision,
  // User Account
  sendWelcomeEmail,
  sendPasswordExpiryWarning,
  sendAccountLocked,
  sendMfaEnrolled,
  sendAccessExpiryWarning,
  sendGenericMail,
  sendWorkgroupMemberAdded,
  sendWorkgroupMemberRemoved,
};
