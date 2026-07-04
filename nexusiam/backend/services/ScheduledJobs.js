/**
 * NexusIAM Scheduled Jobs
 * Runs background tasks via node-cron:
 *  - Approval reminder emails (pending > 2 days)
 *  - Request expiry (pending > 7 days → auto-expire)
 *  - Certification reminders (7 days, 3 days, 1 day before due)
 *  - Access expiry warnings (7 days before temporary access ends)
 *  - Password expiry warnings (7 days before password expires)
 *  - Connector sync scheduling (per connector cron expression)
 *
 * PHASE 4A: N+1 queries eliminated — approvers and connectors
 * are now fetched once per tenant, not once per record.
 */

const cron = require('node-cron');
const db = require('../config/database');
const EmailService = require('./email/EmailService');
const ProvisioningEngine = require('./provisioning/ProvisioningEngine');
const logger = require('../config/logger');

function startScheduledJobs() {
  logger.info('[SCHEDULER] Starting scheduled jobs');

  // ── Every hour: pending access request reminders & expiry ────────────────
  cron.schedule('0 * * * *', async () => {
    logger.info('[SCHEDULER] Running: access request checks');
    try {

      // ── 1. Reminder emails (pending > 2 days) ──
      const { rows: pendingRequests } = await db.query(`
        SELECT ar.*,
               u.first_name, u.last_name, u.email
        FROM access_requests ar
        JOIN users u ON u.id = ar.requester_id
        WHERE ar.status = 'pending'
          AND ar.requested_at < NOW() - INTERVAL '2 days'
          AND (ar.last_reminder_sent IS NULL OR ar.last_reminder_sent < NOW() - INTERVAL '1 day')
        ORDER BY ar.tenant_id
      `);

      if (pendingRequests.length > 0) {
        // Batch: fetch approvers per unique tenant (not per request)
        const tenantIds = [...new Set(pendingRequests.map(r => r.tenant_id))];
        const { rows: allApprovers } = await db.query(`
          SELECT DISTINCT u.*, ur.tenant_id AS approver_tenant_id
          FROM users u
          JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'
          JOIN roles r ON r.id = ur.role_id
          WHERE r.name IN ('Super Admin','IAM Admin','Access Manager')
            AND ur.tenant_id = ANY($1::uuid[])
            AND u.status = 'active'
        `, [tenantIds]);

        // Group approvers by tenant for O(1) lookup
        const approversByTenant = {};
        for (const a of allApprovers) {
          if (!approversByTenant[a.approver_tenant_id]) approversByTenant[a.approver_tenant_id] = [];
          approversByTenant[a.approver_tenant_id].push(a);
        }

        // Collect IDs for bulk update
        const remindedIds = [];
        for (const request of pendingRequests) {
          const daysPending = Math.floor((Date.now() - new Date(request.requested_at).getTime()) / 86400000);
          const requester = { first_name: request.first_name, last_name: request.last_name, email: request.email };
          const approvers = approversByTenant[request.tenant_id] || [];
          for (const approver of approvers) {
            await EmailService.sendApprovalReminder({ request, requester, approver, daysPending }).catch(() => {});
          }
          remindedIds.push(request.id);
          logger.info(`[SCHEDULER] Sent reminder for ${request.ticket_number} (${daysPending}d pending)`);
        }

        // Bulk update instead of one UPDATE per record
        if (remindedIds.length > 0) {
          await db.query(
            `UPDATE access_requests SET last_reminder_sent = NOW() WHERE id = ANY($1::uuid[])`,
            [remindedIds]
          );
        }
      }

      // ── 2. Auto-expire requests pending > 7 days ──
      const { rows: expired } = await db.query(`
        SELECT ar.*, u.first_name, u.last_name, u.email
        FROM access_requests ar
        JOIN users u ON u.id = ar.requester_id
        WHERE ar.status = 'pending'
          AND ar.requested_at < NOW() - INTERVAL '7 days'
        ORDER BY ar.tenant_id
      `);

      if (expired.length > 0) {
        // Bulk expire in one query
        const expiredIds = expired.map(r => r.id);
        await db.query(
          `UPDATE access_requests SET status = 'expired', resolved_at = NOW() WHERE id = ANY($1::uuid[])`,
          [expiredIds]
        );

        // Batch approvers per tenant for expiry emails
        const expiredTenantIds = [...new Set(expired.map(r => r.tenant_id))];
        const { rows: expApprovers } = await db.query(`
          SELECT DISTINCT u.*, ur.tenant_id AS approver_tenant_id
          FROM users u
          JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'
          JOIN roles r ON r.id = ur.role_id
          WHERE r.name IN ('Super Admin','IAM Admin','Access Manager')
            AND ur.tenant_id = ANY($1::uuid[])
        `, [expiredTenantIds]);

        const expApproversByTenant = {};
        for (const a of expApprovers) {
          if (!expApproversByTenant[a.approver_tenant_id]) expApproversByTenant[a.approver_tenant_id] = [];
          expApproversByTenant[a.approver_tenant_id].push(a);
        }

        for (const request of expired) {
          const requester = { first_name: request.first_name, last_name: request.last_name, email: request.email };
          const approvers = expApproversByTenant[request.tenant_id] || [];
          await EmailService.sendRequestExpired({ request, requester, approvers }).catch(() => {});
          logger.info(`[SCHEDULER] Expired request ${request.ticket_number}`);
        }
      }

      // ── 3. Expire temporary role assignments (past expires_at) ──
      const { rows: expiredRoles } = await db.query(`
        SELECT ur.*, u.email, u.first_name, u.last_name, r.name AS role_name
        FROM user_roles ur
        JOIN users u ON u.id = ur.user_id
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.status = 'active'
          AND ur.expires_at IS NOT NULL
          AND ur.expires_at < NOW()
        ORDER BY ur.tenant_id
      `);

      if (expiredRoles.length > 0) {
        // Bulk expire roles in one query
        const expiredRoleIds = expiredRoles.map(r => r.id);
        await db.query(
          `UPDATE user_roles SET status = 'expired', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
          [expiredRoleIds]
        );

        // Batch: fetch connected connectors per unique tenant (not per role)
        const roleTenantIds = [...new Set(expiredRoles.map(r => r.tenant_id))];
        const { rows: allConnectors } = await db.query(
          `SELECT * FROM connectors WHERE tenant_id = ANY($1::uuid[]) AND status = 'connected'`,
          [roleTenantIds]
        );
        const connectorsByTenant = {};
        for (const c of allConnectors) {
          if (!connectorsByTenant[c.tenant_id]) connectorsByTenant[c.tenant_id] = [];
          connectorsByTenant[c.tenant_id].push(c);
        }

        for (const ur of expiredRoles) {
          await EmailService.sendAccessDeprovisioned({
            user: { email: ur.email, first_name: ur.first_name, last_name: ur.last_name },
            role: ur.role_name,
            reason: 'Temporary access period expired',
            revokedBy: 'NexusIAM Scheduler',
          }).catch(() => {});

          const connectors = connectorsByTenant[ur.tenant_id] || [];
          for (const connector of connectors) {
            ProvisioningEngine.executeSync(connector.id, 'push', { userId: ur.user_id }).catch(() => {});
          }
          logger.info(`[SCHEDULER] Expired role ${ur.role_name} for ${ur.first_name} ${ur.last_name}`);
        }
      }

    } catch (err) {
      logger.error('[SCHEDULER] Access request check failed', { error: err.message });
    }
  });

  // ── Daily at 8am: access expiry warnings (7 days before) ─────────────────
  cron.schedule('0 8 * * *', async () => {
    logger.info('[SCHEDULER] Running: access expiry warnings');
    try {
      const { rows } = await db.query(`
        SELECT ur.*, u.email, u.first_name, u.last_name, r.name AS role_name
        FROM user_roles ur
        JOIN users u ON u.id = ur.user_id
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.status = 'active'
          AND ur.expires_at IS NOT NULL
          AND ur.expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
          AND (ur.expiry_warning_sent IS NULL OR ur.expiry_warning_sent < NOW() - INTERVAL '6 days')
      `);

      const warnedIds = [];
      for (const ur of rows) {
        const daysRemaining = Math.max(1, Math.ceil((new Date(ur.expires_at) - Date.now()) / 86400000));
        await EmailService.sendAccessExpiryWarning({
          user: { email: ur.email, first_name: ur.first_name, last_name: ur.last_name },
          role: ur.role_name,
          expiryDate: ur.expires_at,
          daysRemaining,
        }).catch(() => {});
        warnedIds.push(ur.id);
        logger.info(`[SCHEDULER] Sent expiry warning for ${ur.role_name} to ${ur.email}`);
      }

      // Bulk update
      if (warnedIds.length > 0) {
        await db.query(
          `UPDATE user_roles SET expiry_warning_sent = NOW() WHERE id = ANY($1::uuid[])`,
          [warnedIds]
        );
      }
    } catch (err) {
      logger.error('[SCHEDULER] Access expiry warning failed', { error: err.message });
    }
  });

  // ── Daily at 9am: password expiry warnings ────────────────────────────────
  cron.schedule('0 9 * * *', async () => {
    logger.info('[SCHEDULER] Running: password expiry warnings');
    try {
      const { rows } = await db.query(`
        SELECT * FROM users
        WHERE status = 'active'
          AND password_expires_at IS NOT NULL
          AND password_expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
          AND (pwd_warning_sent IS NULL OR pwd_warning_sent < NOW() - INTERVAL '6 days')
      `);

      const warnedIds = [];
      for (const user of rows) {
        const daysRemaining = Math.max(1, Math.ceil((new Date(user.password_expires_at) - Date.now()) / 86400000));
        await EmailService.sendPasswordExpiryWarning({ user, daysRemaining, expiryDate: user.password_expires_at }).catch(() => {});
        warnedIds.push(user.id);
        logger.info(`[SCHEDULER] Sent password warning to ${user.email} (${daysRemaining} days)`);
      }

      // Bulk update
      if (warnedIds.length > 0) {
        await db.query(
          `UPDATE users SET pwd_warning_sent = NOW() WHERE id = ANY($1::uuid[])`,
          [warnedIds]
        );
      }
    } catch (err) {
      logger.error('[SCHEDULER] Password expiry check failed', { error: err.message });
    }
  });

  // ── Daily at 7am: certification reminders ────────────────────────────────
  cron.schedule('0 7 * * *', async () => {
    logger.info('[SCHEDULER] Running: certification reminders');
    try {
      const { rows: campaigns } = await db.query(`
        SELECT * FROM certifications
        WHERE status = 'active'
          AND due_date IS NOT NULL
          AND due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      `);

      // Collect overdue IDs for bulk close
      const overdueIds = [];

      for (const campaign of campaigns) {
        const daysRemaining = Math.max(0, Math.ceil((new Date(campaign.due_date) - Date.now()) / 86400000));

        if (daysRemaining === 0) {
          overdueIds.push(campaign.id);
          logger.info(`[SCHEDULER] Auto-closing overdue certification: ${campaign.name}`);
          continue;
        }

        if (![7, 3, 1].includes(daysRemaining)) continue;

        // Get reviewers with pending items for this campaign
        const { rows: reviewers } = await db.query(`
          SELECT u.*, COUNT(ci.id) AS pending_count
          FROM certification_items ci
          JOIN users u ON u.id = ci.reviewer_id
          WHERE ci.certification_id = $1 AND ci.decision = 'pending'
          GROUP BY u.id
          HAVING COUNT(ci.id) > 0
        `, [campaign.id]);

        for (const reviewer of reviewers) {
          await EmailService.sendCertificationReminder({
            campaign,
            reviewer,
            pendingCount: parseInt(reviewer.pending_count),
            daysRemaining,
            dueDate: campaign.due_date,
          }).catch(() => {});
          logger.info(`[SCHEDULER] Cert reminder: ${campaign.name} → ${reviewer.email} (${daysRemaining}d)`);
        }
      }

      // Bulk close overdue certifications
      if (overdueIds.length > 0) {
        await db.query(
          `UPDATE certifications SET status = 'completed', completed_at = NOW() WHERE id = ANY($1::uuid[])`,
          [overdueIds]
        );
      }

    } catch (err) {
      logger.error('[SCHEDULER] Cert reminder failed', { error: err.message });
    }
  });

  // ── Every 15 min: connector syncs based on their cron schedule ─────────────
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { rows: connectors } = await db.query(`
        SELECT * FROM connectors
        WHERE status = 'connected'
          AND sync_schedule IS NOT NULL
          AND sync_schedule != ''
      `);

      for (const connector of connectors) {
        try {
          if (isCronDue(connector.sync_schedule, connector.last_sync)) {
            logger.info(`[SCHEDULER] Running scheduled sync for ${connector.name}`);
            await ProvisioningEngine.executeSync(connector.id, connector.provisioning_direction || 'pull');
          }
        } catch (err) {
          logger.warn(`[SCHEDULER] Scheduled sync failed for ${connector.name}`, { error: err.message });
        }
      }
    } catch (err) {
      logger.error('[SCHEDULER] Connector sync job failed', { error: err.message });
    }
  });

  logger.info('[SCHEDULER] All jobs registered');
}

/**
 * Simple cron-due check — checks if last_sync is older than the interval implied by the schedule
 */
function isCronDue(schedule, lastSync) {
  if (!lastSync) return true;
  const msSinceSync = Date.now() - new Date(lastSync).getTime();
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour] = parts;

  if (min === '*' && hour === '*') return msSinceSync > 60 * 1000;
  if (min !== '*' && hour === '*') return msSinceSync > 60 * 60 * 1000;
  if (hour.startsWith('*/')) {
    const interval = parseInt(hour.slice(2)) * 60 * 60 * 1000;
    return msSinceSync > interval;
  }
  return msSinceSync > 23 * 60 * 60 * 1000;
}

module.exports = { startScheduledJobs };