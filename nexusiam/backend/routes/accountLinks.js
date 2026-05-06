const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

// ── Get account links, optionally filtered by user_id ────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { user_id, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(parseInt(page), 1) - 1) * parseInt(limit);
    const params = [req.tenantId];
    let where = 'al.tenant_id = $1';

    if (user_id) {
      params.push(user_id);
      where += ` AND al.user_id = $${params.length}`;
    }

    const { rows } = await db.query(
      `SELECT al.*,
              c.name AS connector_name,
              a.name AS application_name,
              COALESCE(NULLIF(al.display_name,''), NULLIF(al.account_name,''), al.native_identity) AS resolved_account_name,
              al.source_record
         FROM account_links al
         LEFT JOIN connectors c ON c.id = al.connector_id
         LEFT JOIN applications a ON COALESCE(a.metadata->>'connector_id', a.provisioning_config->>'connector_id') = al.connector_id::text
                                 AND a.tenant_id = al.tenant_id
        WHERE ${where}
        ORDER BY a.name NULLS LAST, COALESCE(NULLIF(al.display_name,''), NULLIF(al.account_name,''), al.native_identity)
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), offset]
    );

    res.json({ data: rows });
  } catch (err) {
    console.error('[ACCOUNT-LINKS] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch account links' });
  }
});

module.exports = router;
