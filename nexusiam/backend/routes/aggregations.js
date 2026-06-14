const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const ProvisioningEngine = require('../services/provisioning/ProvisioningEngine');
const logger = require('../config/logger');

router.use(authenticate);

function normalizeSummary(result) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    added: num(source.added),
    updated: num(source.updated),
    removed: num(source.removed),
    errors: num(source.errors),
    skipped: num(source.skipped),
    accounts: num(source.accounts),
    linked: num(source.linked),
    unlinked: num(source.unlinked),
    accountPreviewCount: num(source.accountPreviewCount),
  };
}

router.get('/', async (req, res) => {
  try {
    const jobs = await db.query(
      `SELECT aj.*, c.name AS connector_name, c.type AS connector_type,
              a.name AS application_name, a.id AS application_id
       FROM aggregation_jobs aj
       LEFT JOIN connectors c ON c.id = aj.connector_id
       LEFT JOIN applications a ON a.tenant_id = aj.tenant_id
         AND (a.metadata->>'connector_id' = aj.connector_id::text
           OR a.provisioning_config->>'connector_id' = aj.connector_id::text)
       WHERE aj.tenant_id = $1
       ORDER BY COALESCE(aj.updated_at, aj.created_at) DESC`,
      [req.tenantId]
    );
    res.json(jobs.rows);
  } catch (err) {
    logger.error('Failed to list aggregations', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to list aggregations' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const job = await db.query(
      `SELECT aj.*, c.name AS connector_name, c.type AS connector_type,
              a.name AS application_name, a.id AS application_id
       FROM aggregation_jobs aj
       LEFT JOIN connectors c ON c.id = aj.connector_id
       LEFT JOIN applications a ON a.tenant_id = aj.tenant_id
         AND (a.metadata->>'connector_id' = aj.connector_id::text
           OR a.provisioning_config->>'connector_id' = aj.connector_id::text)
       WHERE aj.tenant_id = $1 AND aj.id = $2`,
      [req.tenantId, req.params.id]
    );

    if (!job.rows.length) {
      return res.status(404).json({ error: 'Aggregation job not found' });
    }

    const j = job.rows[0];
    let recentRuns = [];

    if (j.connector_id) {
      try {
        const runs = await db.query(
          `SELECT id, status, direction, started_at, completed_at, records_processed, result, error_message
           FROM sync_jobs
           WHERE connector_id = $1
           ORDER BY started_at DESC
           LIMIT 10`,
          [j.connector_id]
        );

        recentRuns = runs.rows.map((run) => {
          const summary = normalizeSummary(run.result);
          return {
            id: run.id,
            status: run.status,
            direction: run.direction,
            started_at: run.started_at,
            completed_at: run.completed_at,
            records_processed: Number(run.records_processed || 0),
            success_count: summary.added + summary.updated,
            error_count: summary.errors,
            details: run.result || {},
            error_message: run.error_message,
          };
        });
      } catch (runErr) {
        logger.warn('Failed to load sync history for aggregation details', {
          error: runErr.message,
          aggregationId: req.params.id,
        });
      }
    }

    return res.json({
      ...j,
      summary: normalizeSummary(j.last_result),
      last_result: j.last_result && typeof j.last_result === 'object' ? j.last_result : {},
      recent_runs: recentRuns,
    });
  } catch (err) {
    logger.error('Failed to load aggregation details', {
      error: err.message,
      stack: err.stack,
      aggregationId: req.params.id,
    });
    res.status(500).json({ error: 'Failed to load aggregation details' });
  }
});

router.post('/', auditLog('aggregation.upsert'), async (req, res) => {
  try {
    const { connector_id, job_name, aggregation_type, mode, schedule_cron, options, mark_requestable } = req.body;
    const row = await db.query(
      `INSERT INTO aggregation_jobs (tenant_id,connector_id,job_name,aggregation_type,mode,schedule_cron,options,status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'idle',$8)
       RETURNING *`,
      [req.tenantId, connector_id, job_name, aggregation_type || 'account', mode || 'full', schedule_cron || null, JSON.stringify({ ...(options || {}), mark_requestable: !!mark_requestable }), req.user.id]
    );
    res.status(201).json(row.rows[0]);
  } catch (err) {
    logger.error('Failed to save aggregation job', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to save aggregation job' });
  }
});

router.post('/:id/run', auditLog('aggregation.run'), async (req, res) => {
  try {
    const jobs = await db.query(
      `SELECT aj.*, c.provisioning_direction
       FROM aggregation_jobs aj
       LEFT JOIN connectors c ON c.id = aj.connector_id
       WHERE aj.tenant_id = $1 AND aj.id = $2`,
      [req.tenantId, req.params.id]
    );

    if (!jobs.rows.length) return res.status(404).json({ error: 'Aggregation job not found' });

    const job = jobs.rows[0];

    // Set status to running IMMEDIATELY so UI can show it
    await db.query(
      `UPDATE aggregation_jobs SET status='running', updated_at=NOW() WHERE id=$1`,
      [job.id]
    );

    let result = { queued: true };

    if (job.connector_id) {
      const jobOptions = typeof job.options === 'object' ? job.options : (JSON.parse(job.options || '{}'));
      const sync = await ProvisioningEngine.executeSync(job.connector_id, 'pull', {
        aggregationType: job.aggregation_type,
        aggregationMode: job.mode,
        markRequestable: !!jobOptions.mark_requestable,
      });
      const accountPreview = await ProvisioningEngine.listAccountLinks(job.connector_id, req.tenantId, { page: 1, limit: 10 });
      result = {
        ...(sync.result || sync),
        accountPreviewCount: Array.isArray(accountPreview.data) ? accountPreview.data.length : 0,
      };
    }

    await db.query(
      `UPDATE aggregation_jobs
       SET status = 'completed', last_run_at = NOW(), last_result = $2, updated_at = NOW()
       WHERE id = $1`,
      [job.id, JSON.stringify(result)]
    );

    res.json({ success: true, result });
  } catch (err) {
    await db.query(
      `UPDATE aggregation_jobs
       SET status = 'failed', last_run_at = NOW(), last_result = $2, updated_at = NOW()
       WHERE id = $1`,
      [req.params.id, JSON.stringify({ error: err.message })]
    ).catch(() => {});

    logger.error('Aggregation execution failed', { error: err.message, stack: err.stack, aggregationId: req.params.id });
    res.status(400).json({ error: err.message });
  }
});


// PUT /:id — update aggregation job settings
router.put('/:id', authenticate, auditLog('aggregation.update'), async (req, res) => {
  try {
    const { job_name, aggregation_type, mode, schedule_cron } = req.body;
    const { rows } = await db.query(
      `UPDATE aggregation_jobs
         SET job_name=COALESCE($1,job_name),
             aggregation_type=COALESCE($2,aggregation_type),
             mode=COALESCE($3,mode),
             schedule_cron=COALESCE($4,schedule_cron),
             updated_at=NOW()
       WHERE id=$5 AND tenant_id=$6 RETURNING *`,
      [job_name, aggregation_type, mode, schedule_cron, req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Job not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id/status — lightweight poll endpoint for frontend
router.get('/:id/status', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, status, last_run_at, last_result FROM aggregation_jobs WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/delete-bulk', auditLog('aggregation.delete.bulk'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    const justification = String(req.body?.justification || '').trim();
    if (!ids.length) return res.status(400).json({ error: 'At least one job must be selected' });
    if (!justification) return res.status(400).json({ error: 'Business justification is required' });

    const jobs = await db.query(
      `SELECT id, job_name, connector_id FROM aggregation_jobs WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
      [req.tenantId, ids]
    );
    if (!jobs.rows.length) return res.status(404).json({ error: 'Selected jobs not found' });

    await db.query(`DELETE FROM aggregation_jobs WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [req.tenantId, jobs.rows.map(j => j.id)]);

    const names = jobs.rows.map(j => j.job_name).filter(Boolean);
    await (require('../services/email/EmailService').sendGenericMail)({
      to: req.user.email,
      subject: `[NexusIAM] Aggregation jobs deleted (${names.length})`,
      html: `<p>The following aggregation job(s) were deleted by ${req.user.first_name || req.user.username || req.user.email}.</p><p><strong>Business justification:</strong> ${justification}</p><ul>${names.map(n => `<li>${n}</li>`).join('')}</ul>`,
      text: `Aggregation jobs deleted: ${names.join(', ')}. Business justification: ${justification}`,
    });

    res.json({ success: true, deletedCount: names.length, deleted: jobs.rows.map(j => ({ id: j.id, job_name: j.job_name })), justification });
  } catch (err) {
    logger.error('Failed to delete aggregation jobs', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to delete aggregation jobs' });
  }
});

module.exports = router;
