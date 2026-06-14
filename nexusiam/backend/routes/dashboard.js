const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const logger = require('../config/logger');
const { cacheGet, cacheSet } = require('../config/redis');

// ─────────────────────────────────────────────────────────────────────────────
// Cache TTL constants (seconds)
// ─────────────────────────────────────────────────────────────────────────────
const TTL_STATS          = 5  * 60;  // 5 min  — user/app/role counts
const TTL_CHART_DATA     = 5  * 60;  // 5 min  — requestsByDay, usersByStatus
const TTL_RECENT_ACTIVITY= 1  * 60;  // 1 min  — audit log feed (more live feel)

// Cache key helpers — scoped per tenant so tenants never see each other's data
const KEY_STATS    = (tid) => `dashboard:stats:${tid}`;
const KEY_CHARTS   = (tid) => `dashboard:charts:${tid}`;
const KEY_ACTIVITY = (tid) => `dashboard:activity:${tid}`;

// ─────────────────────────────────────────────────────────────────────────────
// safeQuery — wraps every DB call so one bad query never crashes the dashboard
// ─────────────────────────────────────────────────────────────────────────────
async function safeQuery(sql, params, fallbackRows = []) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    logger.warn('[DASHBOARD] DB query fallback', { error: err.message, sql: sql.slice(0, 80) });
    return { rows: fallbackRows };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const tid = req.tenantId;
  logger.debug('[DASHBOARD] Request received', { tenantId: tid });

  try {
    // ── Try to serve all three sections from Redis cache ──────────────────
    const [cachedStats, cachedCharts, cachedActivity] = await Promise.all([
      cacheGet(KEY_STATS(tid)),
      cacheGet(KEY_CHARTS(tid)),
      cacheGet(KEY_ACTIVITY(tid)),
    ]);

    // ── STATS (users, roles, apps, requests, violations, certs) ──────────
    let stats;
    if (cachedStats) {
      logger.info('[DASHBOARD] Serving stats from Redis cache', { tenantId: tid });
      stats = cachedStats;
    } else {
      logger.info('[DASHBOARD] Stats cache miss — querying DB', { tenantId: tid });
      const [users, roles, apps, requests, violations, certs] = await Promise.all([
        safeQuery(`SELECT COUNT(*)::int total, COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0)::int active FROM users WHERE tenant_id=$1`, [tid], [{ total: 0, active: 0 }]),
        safeQuery(`SELECT COUNT(*)::int count FROM roles WHERE tenant_id=$1`, [tid], [{ count: 0 }]),
        safeQuery(`SELECT COUNT(*)::int count FROM applications WHERE tenant_id=$1`, [tid], [{ count: 0 }]),
        safeQuery(`SELECT COUNT(*)::int total, COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0)::int pending FROM access_requests WHERE tenant_id=$1`, [tid], [{ total: 0, pending: 0 }]),
        safeQuery(`SELECT COUNT(*)::int count FROM policy_violations WHERE tenant_id=$1 AND status='open'`, [tid], [{ count: 0 }]),
        safeQuery(`SELECT COUNT(*)::int count FROM certifications WHERE tenant_id=$1 AND status='active'`, [tid], [{ count: 0 }]),
      ]);

      stats = {
        users:                { total: Number(users.rows?.[0]?.total || 0), active: Number(users.rows?.[0]?.active || 0) },
        roles:                Number(roles.rows?.[0]?.count || 0),
        applications:         Number(apps.rows?.[0]?.count || 0),
        requests:             { total: Number(requests.rows?.[0]?.total || 0), pending: Number(requests.rows?.[0]?.pending || 0) },
        violations:           Number(violations.rows?.[0]?.count || 0),
        activeCertifications: Number(certs.rows?.[0]?.count || 0),
      };

      // Store in cache — if Redis is down this is a no-op and logs a warning
      const stored = await cacheSet(KEY_STATS(tid), stats, TTL_STATS);
      logger.info('[DASHBOARD] Stats loaded from DB', {
        tenantId: tid,
        users: stats.users.total,
        pendingRequests: stats.requests.pending,
        cachedInRedis: stored,
      });
    }

    // ── CHART DATA (requestsByDay, usersByStatus) ─────────────────────────
    let chartData;
    if (cachedCharts) {
      logger.info('[DASHBOARD] Serving chart data from Redis cache', { tenantId: tid });
      chartData = cachedCharts;
    } else {
      logger.info('[DASHBOARD] Chart data cache miss — querying DB', { tenantId: tid });
      const [usersByStatus, requestsByDay] = await Promise.all([
        safeQuery(`SELECT status, COUNT(*)::int count FROM users WHERE tenant_id=$1 GROUP BY status`, [tid], []),
        safeQuery(
          `SELECT TO_CHAR(requested_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int count
             FROM access_requests
            WHERE tenant_id=$1 AND requested_at > NOW() - INTERVAL '30 days'
            GROUP BY requested_at::date
            ORDER BY requested_at::date`,
          [tid], []
        ),
      ]);

      chartData = {
        usersByStatus: usersByStatus.rows,
        requestsByDay: requestsByDay.rows,
      };

      const stored = await cacheSet(KEY_CHARTS(tid), chartData, TTL_CHART_DATA);
      logger.info('[DASHBOARD] Chart data loaded from DB', {
        tenantId: tid,
        userStatusRows: chartData.usersByStatus.length,
        requestDays: chartData.requestsByDay.length,
        cachedInRedis: stored,
      });
    }

    // ── RECENT ACTIVITY (audit log feed — shorter TTL) ────────────────────
    let recentActivity;
    if (cachedActivity) {
      logger.info('[DASHBOARD] Serving recent activity from Redis cache', { tenantId: tid });
      recentActivity = cachedActivity;
    } else {
      logger.info('[DASHBOARD] Activity cache miss — querying DB', { tenantId: tid });
      const activityRes = await safeQuery(
        `SELECT action, resource_type, created_at, status FROM audit_logs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
        [tid], []
      );
      recentActivity = activityRes.rows;

      const stored = await cacheSet(KEY_ACTIVITY(tid), recentActivity, TTL_RECENT_ACTIVITY);
      logger.info('[DASHBOARD] Recent activity loaded from DB', {
        tenantId: tid,
        rows: recentActivity.length,
        cachedInRedis: stored,
      });
    }

    // ── Respond ───────────────────────────────────────────────────────────
    res.json({
      stats,
      recentActivity,
      usersByStatus:  chartData.usersByStatus,
      requestsByDay:  chartData.requestsByDay,
    });

  } catch (err) {
    // Outer catch — should never reach here because safeQuery handles DB errors
    // and cache helpers never throw. Log it and return empty dashboard.
    logger.error('[DASHBOARD] Unexpected error', { tenantId: tid, error: err.message, stack: err.stack });
    res.json({
      stats: { users: { total: 0, active: 0 }, roles: 0, applications: 0, requests: { total: 0, pending: 0 }, violations: 0, activeCertifications: 0 },
      recentActivity: [],
      usersByStatus: [],
      requestsByDay: [],
    });
  }
});

module.exports = router;