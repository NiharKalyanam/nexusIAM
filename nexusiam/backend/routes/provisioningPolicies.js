const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const RuleEngine = require('../services/rules/RuleEngine');
const { CONNECTORS } = require('../services/connectors/ConnectorRegistry');
const logger = require('../config/logger');

// Default field templates per connector type — mirrors SailPoint provisioning policy defaults
const DEFAULT_POLICY_FIELDS = {
  scim2: {
    Create: [
      { name: 'userName',          label: 'SCIM userName',     source: 'identity',   value: 'username',   required: true  },
      { name: 'name.givenName',    label: 'First Name',        source: 'identity',   value: 'first_name', required: false },
      { name: 'name.familyName',   label: 'Last Name',         source: 'identity',   value: 'last_name',  required: false },
      { name: 'emails[0].value',   label: 'Email',             source: 'identity',   value: 'email',      required: true  },
      { name: 'emails[0].primary', label: 'Email Primary',     source: 'static',     value: true,         required: false },
      { name: 'active',            label: 'Active',            source: 'static',     value: true,         required: false },
      { name: 'title',             label: 'Title',             source: 'identity',   value: 'title',      required: false },
      { name: 'department',        label: 'Department',        source: 'identity',   value: 'department', required: false },
    ],
    Update: [
      { name: 'name.givenName',    label: 'First Name',        source: 'identity',   value: 'first_name', required: false },
      { name: 'name.familyName',   label: 'Last Name',         source: 'identity',   value: 'last_name',  required: false },
      { name: 'emails[0].value',   label: 'Email',             source: 'identity',   value: 'email',      required: false },
      { name: 'title',             label: 'Title',             source: 'identity',   value: 'title',      required: false },
      { name: 'department',        label: 'Department',        source: 'identity',   value: 'department', required: false },
    ],
    Enable:  [{ name: 'active', label: 'Active', source: 'static', value: true,  required: true }],
    Disable: [{ name: 'active', label: 'Active', source: 'static', value: false, required: true }],
    Delete:  [],
  },
  active_directory: {
    Create: [
      { name: 'sAMAccountName', label: 'SAM Account Name',  source: 'identity',   value: 'username',   required: true  },
      { name: 'cn',             label: 'Common Name',       source: 'rule',       rule_script: 'result = identity.first_name + " " + identity.last_name;', required: true },
      { name: 'givenName',      label: 'First Name',        source: 'identity',   value: 'first_name', required: false },
      { name: 'sn',             label: 'Last Name (sn)',    source: 'identity',   value: 'last_name',  required: false },
      { name: 'mail',           label: 'Email',             source: 'identity',   value: 'email',      required: false },
      { name: 'userPrincipalName', label: 'UPN',            source: 'rule',       rule_script: 'result = identity.email || (identity.username + "@" + (connector.config?.domain || "corp.local"));', required: true },
      { name: 'title',          label: 'Title',             source: 'identity',   value: 'title',      required: false },
      { name: 'department',     label: 'Department',        source: 'identity',   value: 'department', required: false },
      { name: 'userAccountControl', label: 'Account Control', source: 'static',  value: '512',        required: false },
    ],
    Update: [
      { name: 'givenName',   label: 'First Name',  source: 'identity', value: 'first_name', required: false },
      { name: 'sn',          label: 'Last Name',   source: 'identity', value: 'last_name',  required: false },
      { name: 'mail',        label: 'Email',       source: 'identity', value: 'email',      required: false },
      { name: 'title',       label: 'Title',       source: 'identity', value: 'title',      required: false },
      { name: 'department',  label: 'Department',  source: 'identity', value: 'department', required: false },
    ],
    Enable:  [{ name: 'userAccountControl', label: 'Account Control', source: 'static', value: '512',  required: true }],
    Disable: [{ name: 'userAccountControl', label: 'Account Control', source: 'static', value: '514',  required: true }],
    Unlock:  [{ name: 'lockoutTime',         label: 'Lockout Time',   source: 'static', value: '0',    required: true }],
    Delete:  [],
  },
  ldap: {
    Create: [
      { name: 'cn',         label: 'Common Name',  source: 'rule',     rule_script: 'result = identity.first_name + " " + identity.last_name;', required: true },
      { name: 'uid',        label: 'UID',          source: 'identity', value: 'username',   required: true  },
      { name: 'mail',       label: 'Email',        source: 'identity', value: 'email',      required: false },
      { name: 'givenName',  label: 'First Name',   source: 'identity', value: 'first_name', required: false },
      { name: 'sn',         label: 'Last Name',    source: 'identity', value: 'last_name',  required: false },
      { name: 'objectClass',label: 'Object Class', source: 'static',   value: 'inetOrgPerson', required: true },
    ],
    Update: [
      { name: 'mail',      label: 'Email',       source: 'identity', value: 'email',      required: false },
      { name: 'givenName', label: 'First Name',  source: 'identity', value: 'first_name', required: false },
      { name: 'sn',        label: 'Last Name',   source: 'identity', value: 'last_name',  required: false },
    ],
    Enable:  [],
    Disable: [],
    Delete:  [],
  },
  okta: {
    Create: [
      { name: 'login',       label: 'Okta Login (email)', source: 'identity', value: 'email',      required: true  },
      { name: 'email',       label: 'Email',              source: 'identity', value: 'email',      required: true  },
      { name: 'firstName',   label: 'First Name',         source: 'identity', value: 'first_name', required: true  },
      { name: 'lastName',    label: 'Last Name',          source: 'identity', value: 'last_name',  required: true  },
      { name: 'title',       label: 'Title',              source: 'identity', value: 'title',      required: false },
      { name: 'department',  label: 'Department',         source: 'identity', value: 'department', required: false },
      { name: 'mobilePhone', label: 'Mobile Phone',       source: 'identity', value: 'phone',      required: false },
    ],
    Update: [
      { name: 'firstName',  label: 'First Name',  source: 'identity', value: 'first_name', required: false },
      { name: 'lastName',   label: 'Last Name',   source: 'identity', value: 'last_name',  required: false },
      { name: 'email',      label: 'Email',       source: 'identity', value: 'email',      required: false },
      { name: 'title',      label: 'Title',       source: 'identity', value: 'title',      required: false },
      { name: 'department', label: 'Department',  source: 'identity', value: 'department', required: false },
    ],
    Enable:  [],
    Disable: [],
    Delete:  [],
  },
  azure_ad: {
    Create: [
      { name: 'userPrincipalName', label: 'UPN',         source: 'identity', value: 'email',      required: true  },
      { name: 'displayName',       label: 'Display Name',source: 'rule',     rule_script: 'result = identity.first_name + " " + identity.last_name;', required: true },
      { name: 'givenName',         label: 'First Name',  source: 'identity', value: 'first_name', required: false },
      { name: 'surname',           label: 'Last Name',   source: 'identity', value: 'last_name',  required: false },
      { name: 'mailNickname',      label: 'Mail Alias',  source: 'rule',     rule_script: 'result = (identity.username || identity.email.split("@")[0]).toLowerCase().replace(/[^a-z0-9]/g,"");', required: true },
      { name: 'jobTitle',          label: 'Job Title',   source: 'identity', value: 'title',      required: false },
      { name: 'department',        label: 'Department',  source: 'identity', value: 'department', required: false },
      { name: 'accountEnabled',    label: 'Enabled',     source: 'static',   value: true,         required: true  },
    ],
    Update: [
      { name: 'displayName', label: 'Display Name', source: 'rule',     rule_script: 'result = identity.first_name + " " + identity.last_name;', required: false },
      { name: 'givenName',   label: 'First Name',   source: 'identity', value: 'first_name', required: false },
      { name: 'surname',     label: 'Last Name',    source: 'identity', value: 'last_name',  required: false },
      { name: 'jobTitle',    label: 'Job Title',    source: 'identity', value: 'title',      required: false },
      { name: 'department',  label: 'Department',   source: 'identity', value: 'department', required: false },
    ],
    Enable:  [{ name: 'accountEnabled', label: 'Enabled', source: 'static', value: true,  required: true }],
    Disable: [{ name: 'accountEnabled', label: 'Enabled', source: 'static', value: false, required: true }],
    Delete:  [],
  },
  salesforce: {
    Create: [
      { name: 'Username',   label: 'Username',    source: 'identity', value: 'email',      required: true  },
      { name: 'Email',      label: 'Email',       source: 'identity', value: 'email',      required: true  },
      { name: 'FirstName',  label: 'First Name',  source: 'identity', value: 'first_name', required: true  },
      { name: 'LastName',   label: 'Last Name',   source: 'identity', value: 'last_name',  required: true  },
      { name: 'Title',      label: 'Title',       source: 'identity', value: 'title',      required: false },
      { name: 'Department', label: 'Department',  source: 'identity', value: 'department', required: false },
      { name: 'IsActive',   label: 'Is Active',   source: 'static',   value: true,         required: true  },
    ],
    Update: [
      { name: 'FirstName',  label: 'First Name',  source: 'identity', value: 'first_name', required: false },
      { name: 'LastName',   label: 'Last Name',   source: 'identity', value: 'last_name',  required: false },
      { name: 'Email',      label: 'Email',       source: 'identity', value: 'email',      required: false },
      { name: 'Title',      label: 'Title',       source: 'identity', value: 'title',      required: false },
    ],
    Enable:  [{ name: 'IsActive', label: 'Is Active', source: 'static', value: true,  required: true }],
    Disable: [{ name: 'IsActive', label: 'Is Active', source: 'static', value: false, required: true }],
    Delete:  [],
  },
  servicenow: {
    Create: [
      { name: 'user_name',   label: 'Username',    source: 'identity', value: 'username',   required: true  },
      { name: 'email',       label: 'Email',       source: 'identity', value: 'email',      required: true  },
      { name: 'first_name',  label: 'First Name',  source: 'identity', value: 'first_name', required: false },
      { name: 'last_name',   label: 'Last Name',   source: 'identity', value: 'last_name',  required: false },
      { name: 'title',       label: 'Title',       source: 'identity', value: 'title',      required: false },
      { name: 'department',  label: 'Department',  source: 'identity', value: 'department', required: false },
      { name: 'active',      label: 'Active',      source: 'static',   value: 'true',       required: true  },
    ],
    Update: [
      { name: 'email',      label: 'Email',       source: 'identity', value: 'email',      required: false },
      { name: 'first_name', label: 'First Name',  source: 'identity', value: 'first_name', required: false },
      { name: 'last_name',  label: 'Last Name',   source: 'identity', value: 'last_name',  required: false },
    ],
    Enable:  [{ name: 'active', label: 'Active', source: 'static', value: 'true',  required: true }],
    Disable: [{ name: 'active', label: 'Active', source: 'static', value: 'false', required: true }],
    Delete:  [],
  },
  github: {
    Create: [
      { name: 'login', label: 'GitHub Login', source: 'identity', value: 'username', required: true },
      { name: 'role',  label: 'Org Role',     source: 'static',   value: 'member',   required: true },
    ],
    Update: [],
    Enable:  [],
    Disable: [],
    Delete:  [],
  },
  google_workspace: {
    Create: [
      { name: 'primaryEmail',        label: 'Primary Email',  source: 'identity', value: 'email',      required: true  },
      { name: 'name.givenName',      label: 'First Name',     source: 'identity', value: 'first_name', required: true  },
      { name: 'name.familyName',     label: 'Last Name',      source: 'identity', value: 'last_name',  required: true  },
      { name: 'orgUnitPath',         label: 'Org Unit Path',  source: 'static',   value: '/',          required: false },
      { name: 'password',            label: 'Temp Password',  source: 'rule',     rule_script: 'result = "Temp@" + Math.random().toString(36).slice(2,10) + "!";', required: true },
      { name: 'changePasswordAtNextLogin', label: 'Force Password Change', source: 'static', value: true, required: false },
    ],
    Update: [
      { name: 'name.givenName',  label: 'First Name', source: 'identity', value: 'first_name', required: false },
      { name: 'name.familyName', label: 'Last Name',  source: 'identity', value: 'last_name',  required: false },
    ],
    Enable:  [{ name: 'suspended', label: 'Suspended', source: 'static', value: false, required: true }],
    Disable: [{ name: 'suspended', label: 'Suspended', source: 'static', value: true,  required: true }],
    Delete:  [],
  },
};

const OPERATIONS = ['Create', 'Update', 'Enable', 'Disable', 'Delete', 'Unlock'];

// ─── GET /provisioning-policies?connector_id=X ──────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { connector_id } = req.query;
    if (!connector_id) return res.status(400).json({ error: 'connector_id required' });

    // Get connector info to determine defaults
    const { rows: connRows } = await db.query(
      'SELECT id, name, type FROM connectors WHERE id=$1 AND tenant_id=$2',
      [connector_id, req.tenantId]
    );
    if (!connRows.length) return res.status(404).json({ error: 'Connector not found' });
    const connector = connRows[0];
    const defaults = DEFAULT_POLICY_FIELDS[connector.type] || {};
    const connDef = CONNECTORS[connector.type];
    const supportedOps = connDef?.capabilities
      ? OPERATIONS.filter(op => {
          const cap = op.toLowerCase();
          if (op === 'Create') return connDef.capabilities.includes('create');
          if (op === 'Update') return connDef.capabilities.includes('update');
          if (op === 'Enable') return connDef.capabilities.includes('enable');
          if (op === 'Disable') return connDef.capabilities.includes('disable');
          if (op === 'Delete') return connDef.capabilities.includes('delete');
          if (op === 'Unlock') return connDef.capabilities.includes('unlock');
          return false;
        })
      : OPERATIONS;

    // Load saved policies
    const { rows: policies } = await db.query(
      'SELECT * FROM provisioning_policies WHERE connector_id=$1 AND tenant_id=$2 ORDER BY operation',
      [connector_id, req.tenantId]
    );
    const policyByOp = {};
    for (const p of policies) policyByOp[p.operation] = p;

    // Build response: one entry per supported operation, merging saved + defaults
    const result = supportedOps.map(op => {
      const saved = policyByOp[op];
      return {
        id: saved?.id || null,
        connector_id,
        operation: op,
        enabled: saved ? saved.enabled : true,
        description: saved?.description || null,
        fields: saved ? saved.fields : (defaults[op] || []),
        is_default: !saved,
      };
    });

    res.json({ connector, policies: result, supported_operations: supportedOps });
  } catch (err) {
    logger.error('Failed to load provisioning policies', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /provisioning-policies (upsert one policy) ─────────────────────────
router.put('/', authenticate, auditLog('provisioning_policy.save'), async (req, res) => {
  try {
    const { connector_id, operation, fields, enabled, description } = req.body;
    if (!connector_id || !operation) return res.status(400).json({ error: 'connector_id and operation required' });
    if (!OPERATIONS.includes(operation)) return res.status(400).json({ error: `Invalid operation. Must be one of: ${OPERATIONS.join(', ')}` });

    const { rows } = await db.query(
      `INSERT INTO provisioning_policies (tenant_id, connector_id, operation, enabled, description, fields)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (connector_id, operation) DO UPDATE
         SET enabled=$4, description=$5, fields=$6::jsonb, updated_at=NOW()
       RETURNING *`,
      [req.tenantId, connector_id, operation, enabled !== false, description || null, JSON.stringify(fields || [])]
    );
    res.json(rows[0]);
  } catch (err) {
    logger.error('Failed to save provisioning policy', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /provisioning-policies/test ────────────────────────────────────────
// Test a policy against a sample identity — returns resolved attribute payload
router.post('/test', authenticate, async (req, res) => {
  try {
    const { connector_id, operation, fields, identity_id } = req.body;
    if (!fields || !Array.isArray(fields)) return res.status(400).json({ error: 'fields array required' });

    // Load identity if provided
    let identity = req.body.identity || {};
    if (identity_id) {
      const { rows } = await db.query('SELECT * FROM users WHERE id=$1 AND tenant_id=$2', [identity_id, req.tenantId]);
      if (rows.length) identity = rows[0];
    }

    // Load connector
    let connector = {};
    if (connector_id) {
      const { rows } = await db.query('SELECT * FROM connectors WHERE id=$1 AND tenant_id=$2', [connector_id, req.tenantId]);
      if (rows.length) connector = rows[0];
    }

    const resolved = RuleEngine.resolveFields(fields, { identity, connector, operation: operation || 'Create' });
    res.json({ resolved, identity_used: { id: identity.id, username: identity.username, email: identity.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── POST /provisioning-policies/reset ───────────────────────────────────────
// Reset a connector+operation policy back to defaults
router.post('/reset', authenticate, async (req, res) => {
  try {
    const { connector_id, operation } = req.body;
    await db.query(
      'DELETE FROM provisioning_policies WHERE connector_id=$1 AND operation=$2 AND tenant_id=$3',
      [connector_id, operation, req.tenantId]
    );
    res.json({ message: 'Reset to defaults' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /provisioning-policies/defaults/:connectorType ──────────────────────
router.get('/defaults/:connectorType', authenticate, (req, res) => {
  const defaults = DEFAULT_POLICY_FIELDS[req.params.connectorType];
  if (!defaults) return res.json({ operations: {}, message: 'No defaults for this connector type' });
  res.json({ operations: defaults });
});

module.exports = router;
