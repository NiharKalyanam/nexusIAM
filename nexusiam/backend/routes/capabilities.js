
const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const logger = require('../config/logger');
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const caps = await db.query(`SELECT * FROM platform_capabilities WHERE tenant_id=$1 AND enabled=true ORDER BY category, display_name`, [req.tenantId]);
    const grants = await db.query(`SELECT uc.*, u.first_name || ' ' || u.last_name AS user_name FROM user_capabilities uc LEFT JOIN users u ON u.id=uc.user_id WHERE uc.tenant_id=$1 ORDER BY uc.created_at DESC`, [req.tenantId]);
    res.json({ capabilities: caps.rows, grants: grants.rows });
  } catch (err) {
    logger.warn('Capabilities page fallback', { error: err.message });
    res.json({ capabilities: [], grants: [] });
  }
});

router.get('/users/:userId', async (req, res) => {
  try {
    const rows = await db.query(`
      WITH role_caps AS (
        SELECT jsonb_array_elements_text(COALESCE(r.metadata->'capabilities','[]'::jsonb)) AS capability_key
        FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=$1 AND ur.status='active'
      ), direct_caps AS (
        SELECT capability_key FROM user_capabilities WHERE user_id=$1
      )
      SELECT DISTINCT capability_key FROM (
        SELECT capability_key FROM role_caps
        UNION ALL
        SELECT capability_key FROM direct_caps
      ) x ORDER BY capability_key
    `, [req.params.userId]);
    res.json(rows.rows.map(r => r.capability_key));
  } catch (err) {
    res.json([]);
  }
});

router.post('/assign', auditLog('capabilities.assign'), async (req, res) => {
  const { user_id, capability_key } = req.body;
  if (!user_id || !capability_key) return res.status(400).json({ error: 'user_id and capability_key required' });
  const result = await db.query(`INSERT INTO user_capabilities (tenant_id,user_id,capability_key,grant_type,granted_by) VALUES ($1,$2,$3,'direct',$4) ON CONFLICT (tenant_id,user_id,capability_key) DO NOTHING RETURNING *`, [req.tenantId, user_id, capability_key, req.user.id]);
  res.status(201).json(result.rows[0] || { success: true });
});

router.delete('/assign', auditLog('capabilities.revoke'), async (req, res) => {
  const { user_id, capability_key } = req.body;
  await db.query(`DELETE FROM user_capabilities WHERE tenant_id=$1 AND user_id=$2 AND capability_key=$3`, [req.tenantId, user_id, capability_key]);
  res.json({ success: true });
});

// alias used by CapabilitiesPage bulk revoke
router.delete('/revoke', auditLog('capabilities.revoke'), async (req, res) => {
  const { user_id, capability_key, justification } = req.body;
  if (!user_id || !capability_key) return res.status(400).json({ error: 'user_id and capability_key required' });
  if (!justification?.trim()) return res.status(400).json({ error: 'Business justification required' });
  try {
    await db.query(
      `DELETE FROM user_capabilities WHERE tenant_id=$1 AND user_id=$2 AND capability_key=$3`,
      [req.tenantId, user_id, capability_key]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke capability' });
  }
});

module.exports = router;
