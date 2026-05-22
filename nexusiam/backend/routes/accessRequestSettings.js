const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ars.*,
        COALESCE(u.display_name, u.first_name||' '||u.last_name, u.username) AS fallback_approver_name,
        w.name AS fallback_workgroup_name
       FROM access_request_settings ars
       LEFT JOIN users u ON u.id=ars.fallback_approver_id AND ars.fallback_approver_type='user'
       LEFT JOIN workgroups w ON w.id=ars.fallback_approver_id AND ars.fallback_approver_type='workgroup'
       WHERE ars.tenant_id=$1`,
      [req.tenantId]
    );
    res.json(rows[0] || {
      require_manager_approval: true, require_entitlement_owner_approval: false,
      allow_self_approval: false, max_request_duration_days: 30,
      reminder_days: 2, escalation_days: 5, auto_expire_days: 7,
      notify_requester: true, notify_manager: true, notify_owner: false,
      fallback_approver_id: null, fallback_approver_type: 'user'
    });
  } catch(e) { res.status(500).json({ error: 'Failed to load settings: ' + e.message }); }
});

router.put('/', authenticate, auditLog('access_request_settings.update'), async (req, res) => {
  try {
    const {
      require_manager_approval, require_entitlement_owner_approval, allow_self_approval,
      max_request_duration_days, reminder_days, escalation_days, auto_expire_days,
      notify_requester, notify_manager, notify_owner, fallback_approver_id, fallback_approver_type
    } = req.body;
    await db.query(
      `INSERT INTO access_request_settings (
        tenant_id, require_manager_approval, require_entitlement_owner_approval,
        allow_self_approval, max_request_duration_days, reminder_days, escalation_days,
        auto_expire_days, notify_requester, notify_manager, notify_owner,
        fallback_approver_id, fallback_approver_type, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        require_manager_approval=$2, require_entitlement_owner_approval=$3,
        allow_self_approval=$4, max_request_duration_days=$5, reminder_days=$6,
        escalation_days=$7, auto_expire_days=$8, notify_requester=$9,
        notify_manager=$10, notify_owner=$11, fallback_approver_id=$12,
        fallback_approver_type=$13, updated_at=NOW()`,
      [req.tenantId, require_manager_approval!==false, require_entitlement_owner_approval||false,
       allow_self_approval||false, max_request_duration_days||30, reminder_days||2,
       escalation_days||5, auto_expire_days||7, notify_requester!==false,
       notify_manager!==false, notify_owner||false,
       fallback_approver_id||null, fallback_approver_type||'user']
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Failed to save: ' + e.message }); }
});

module.exports = router;
