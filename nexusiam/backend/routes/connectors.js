const express = require('express');
const r = express.Router();
const db = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');
const { CONNECTORS, CATEGORIES } = require('../services/connectors/ConnectorRegistry');
const SchemaEngine = require('../services/schema/SchemaEngine');
const ProvisioningEngine = require('../services/provisioning/ProvisioningEngine');
const JarConnectorBridge = require('../services/connectors/JarConnectorBridge');
const logger = require('../config/logger');
const EmailService = require('../services/email/EmailService');

function normalizeJdbcType(type) {
  if (type === 'jdbc_postgres') return 'jdbc_postgresql';
  if (type === 'jdbc_sqlserver') return 'jdbc_mssql';
  return type;
}

function isJdbcType(type) {
  return ['jdbc_mysql', 'jdbc_postgresql', 'jdbc_mssql', 'jdbc_postgres', 'jdbc_sqlserver'].includes(type);
}

function maskSensitiveConfig(config = {}) {
  const masked = { ...(config || {}) };
  [
    'password', 'api_token', 'client_secret', 'bind_password', 'bearer_token',
    'api_key', 'service_account_key', 'jwt_private_key', 'secret_access_key'
  ].forEach((k) => {
    if (masked[k]) masked[k] = '••••••••';
  });
  return masked;
}

function normalizeJdbcConfig(config = {}) {
  const normalized = {
    database_host:
      config.database_host ||
      config.host ||
      config.hostname ||
      config.server ||
      config.db_host ||
      'localhost',

    port:
      config.port ||
      (String(config.type || '').includes('postgres') ? 5432 : String(config.type || '').includes('mssql') ? 1433 : 3306),

    database_name:
      config.database_name ||
      config.database ||
      config.db_name ||
      config.db ||
      '',

    username:
      config.username ||
      config.user ||
      '',

    password:
      config.password || '',

    user_table_name:
      config.user_table_name ||
      config.user_table ||
      config.table_name ||
      config.table ||
      '',

    uid_column:
      config.uid_column ||
      config.uid ||
      'id',

    fetch_all_users_sql:
      config.fetch_all_users_sql ||
      config.query_all_users ||
      config.query_fetch_all_users ||
      '',

    fetch_single_user_sql:
      config.fetch_single_user_sql ||
      config.query_get_user ||
      '',

    create_user_sql:
      config.create_user_sql ||
      config.query_create_user ||
      '',

    update_user_sql:
      config.update_user_sql ||
      config.query_update_user ||
      '',

    disable_user_sql:
      config.disable_user_sql ||
      config.query_disable_user ||
      '',

    delete_user_sql:
      config.delete_user_sql ||
      config.query_delete_user ||
      '',
  };

  return {
    ...config,
    ...normalized,
    host: normalized.database_host,
    database: normalized.database_name,
    user_table: normalized.user_table_name,
    query_all_users: normalized.fetch_all_users_sql,
    query_fetch_all_users: normalized.fetch_all_users_sql,
    query_get_user: normalized.fetch_single_user_sql,
    query_create_user: normalized.create_user_sql,
    query_update_user: normalized.update_user_sql,
    query_disable_user: normalized.disable_user_sql,
    query_delete_user: normalized.delete_user_sql,
  };
}

function normalizeConnectorConfig(typeOrConfig = {}, maybeConfig = undefined) {
  const type = typeof typeOrConfig === 'string' ? normalizeJdbcType(typeOrConfig) : '';
  const config = typeof typeOrConfig === 'string' ? (maybeConfig || {}) : (typeOrConfig || {});

  const jdbcLikeKeys = [
    'database_host', 'host', 'hostname', 'server', 'db_host',
    'database_name', 'database', 'db_name', 'db',
    'username', 'user', 'password',
    'user_table_name', 'user_table', 'table_name', 'table',
    'uid_column', 'uid',
    'fetch_all_users_sql', 'query_all_users', 'query_fetch_all_users',
    'fetch_single_user_sql', 'query_get_user',
    'create_user_sql', 'query_create_user',
    'update_user_sql', 'query_update_user',
    'disable_user_sql', 'query_disable_user',
    'delete_user_sql', 'query_delete_user'
  ];

  const hasJdbcKeys = Object.keys(config).some((k) => jdbcLikeKeys.includes(k));
  if (isJdbcType(type) || hasJdbcKeys) {
    return normalizeJdbcConfig(config);
  }

  return { ...(config || {}) };
}

async function testJdbcConfigDirect(type, rawConfig = {}) {
  const canonicalType = normalizeJdbcType(type);
  const normalized = normalizeJdbcConfig(rawConfig || {});

  const engineConfig = ProvisioningEngine._normalizeConnectorConfig(canonicalType, {
    ...normalized,
    user_table: normalized.user_table_name || normalized.user_table,
    database: normalized.database_name || normalized.database,
    host: normalized.database_host || normalized.host,
  });

  // For test connection, only validate connection fields.
  // DO NOT require fetch_all_users_sql here.
  if (!engineConfig.host) {
    throw new Error('Database host is required');
  }
  if (!engineConfig.port) {
    throw new Error('Port is required');
  }
  if (!engineConfig.database) {
    throw new Error('Database name is required');
  }
  if (!engineConfig.username) {
    throw new Error('Username is required');
  }

  return ProvisioningEngine._testJdbcConnection(canonicalType, engineConfig);
}

// GET /connectors/catalog
r.get('/jar-status', authenticate, async (req, res) => {
  try {
    const status = await JarConnectorBridge.getJarStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.get('/catalog', authenticate, (req, res) => {
  const catalog = {};
  for (const [key, def] of Object.entries(CONNECTORS)) {
    const cat = def.category || 'Custom';
    if (!catalog[cat]) catalog[cat] = [];
    catalog[cat].push({
      type: key,
      displayName: def.displayName,
      description: def.description,
      icon: def.icon,
      capabilities: def.capabilities,
      provisioningDirection: def.provisioningDirection,
      authType: def.authType,
      protocol: def.protocol,
      configSchema: def.configSchema,
    });
  }
  res.json({ categories: CATEGORIES.filter((c) => catalog[c]), catalog });
});

r.get('/catalog/:type', authenticate, (req, res) => {
  const def = CONNECTORS[req.params.type];
  if (!def) return res.status(404).json({ error: 'Unknown connector type' });
  res.json({ type: req.params.type, ...def });
});

r.get('/transformers/list', authenticate, (req, res) => {
  res.json([
    { type: 'direct', label: 'Direct Copy', description: 'Copy value as-is', configFields: [] },
    { type: 'static', label: 'Static Value', description: 'Always set a fixed value', configFields: [{ key: 'value', label: 'Value', type: 'text' }] },
    { type: 'concat', label: 'Concatenate Fields', description: 'Join multiple attributes', configFields: [{ key: 'attributes', label: 'Attributes', type: 'text_array' }, { key: 'delimiter', label: 'Delimiter', type: 'text', default: ' ' }] },
    { type: 'split', label: 'Split String', description: 'Split and take one part', configFields: [{ key: 'delimiter', label: 'Delimiter', type: 'text', default: ',' }, { key: 'index', label: 'Part Index', type: 'number', default: 0 }] },
    { type: 'uppercase', label: 'To Uppercase', description: 'UPPERCASE value', configFields: [] },
    { type: 'lowercase', label: 'To Lowercase', description: 'lowercase value', configFields: [] },
    { type: 'trim', label: 'Trim Whitespace', description: 'Remove spaces', configFields: [] },
    { type: 'replace', label: 'Find & Replace', description: 'Replace text', configFields: [{ key: 'find', label: 'Find', type: 'text' }, { key: 'replace', label: 'Replace With', type: 'text' }, { key: 'regex', label: 'Use Regex', type: 'boolean' }] },
    { type: 'regex_extract', label: 'Regex Extract', description: 'Extract via regex', configFields: [{ key: 'pattern', label: 'Pattern', type: 'text' }, { key: 'group', label: 'Group', type: 'number', default: 1 }] },
    { type: 'email_to_username', label: 'Email → Username', description: 'Part before @', configFields: [] },
    { type: 'username_to_email', label: 'Username → Email', description: 'Append domain', configFields: [{ key: 'domain', label: 'Domain', type: 'text' }] },
    { type: 'format_date', label: 'Format Date', description: 'Convert date format', configFields: [{ key: 'output_format', label: 'Format', type: 'select', options: ['ISO', 'date', 'epoch'] }] },
    { type: 'boolean_map', label: 'Boolean Map', description: 'Text → true/false', configFields: [{ key: 'true_values', label: 'True Values', type: 'text', default: 'active,enabled,Y,1' }, { key: 'false_values', label: 'False Values', type: 'text', default: 'inactive,disabled,N,0' }] },
    { type: 'value_map', label: 'Value Lookup Map', description: 'Map value to value', configFields: [{ key: 'mapping', label: 'Map (JSON)', type: 'json' }, { key: 'default', label: 'Default', type: 'text' }] },
    { type: 'conditional', label: 'Conditional', description: 'If/else value', configFields: [{ key: 'condition_attr', label: 'Condition Field', type: 'text' }, { key: 'condition_value', label: 'Condition Value', type: 'text' }, { key: 'true_value', label: 'If True', type: 'text' }, { key: 'false_value', label: 'If False', type: 'text' }] },
    { type: 'join_array', label: 'Join Array', description: 'Array → string', configFields: [{ key: 'delimiter', label: 'Delimiter', type: 'text', default: ',' }] },
    { type: 'split_to_array', label: 'Split to Array', description: 'String → array', configFields: [{ key: 'delimiter', label: 'Delimiter', type: 'text', default: ',' }] },
    { type: 'ad_account_control', label: 'AD accountControl (Write)', description: 'active → 512/514', configFields: [] },
    { type: 'ad_account_control_read', label: 'AD accountControl (Read)', description: '512/514 → boolean', configFields: [] },
    { type: 'generate_dn', label: 'Generate LDAP DN', description: 'Build DN string', configFields: [{ key: 'ou', label: 'OU', type: 'text' }, { key: 'dc', label: 'DC', type: 'text' }] },
    { type: 'expression', label: 'Custom Expression (JS)', description: 'value, record available', configFields: [{ key: 'expression', label: 'Expression', type: 'textarea' }] },
  ]);
});

r.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM sync_jobs sj WHERE sj.connector_id = c.id) as sync_count,
        (SELECT started_at FROM sync_jobs sj WHERE sj.connector_id = c.id ORDER BY started_at DESC LIMIT 1) as last_sync_at,
        (SELECT status FROM sync_jobs sj WHERE sj.connector_id = c.id ORDER BY started_at DESC LIMIT 1) as last_sync_status,
        (SELECT a.id FROM applications a WHERE a.tenant_id = c.tenant_id AND COALESCE(a.metadata->>'connector_id', a.provisioning_config->>'connector_id') = c.id::text ORDER BY a.created_at DESC LIMIT 1) as linked_application_id,
        (SELECT a.name FROM applications a WHERE a.tenant_id = c.tenant_id AND COALESCE(a.metadata->>'connector_id', a.provisioning_config->>'connector_id') = c.id::text ORDER BY a.created_at DESC LIMIT 1) as linked_application_name
       FROM connectors c WHERE c.tenant_id=$1 ORDER BY c.name`,
      [req.tenantId]
    );
    res.json(rows.map((c) => ({ ...c, config: maskSensitiveConfig(c.config || {}) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.post('/test-config', authenticate, async (req, res) => {
  try {
    const { type, config } = req.body || {};

    if (!type) {
      return res.status(400).json({
        status: 'error',
        message: 'Connector type is required'
      });
    }

    const normalizedConfig = normalizeConnectorConfig(config || {});
    const canonicalType = normalizeJdbcType(type);

    if (isJdbcType(canonicalType)) {
      const result = await testJdbcConfigDirect(canonicalType, normalizedConfig);
      return res.json({ status: 'success', ...result });
    }

    if (JarConnectorBridge.JAR_MAP[canonicalType]) {
      const result = await JarConnectorBridge.testJarConnector(canonicalType, normalizedConfig);
      return res.json({ status: result.success ? 'success' : 'error', ...result });
    }

    const result = await ProvisioningEngine.testConnectionConfig(canonicalType, normalizedConfig);
    return res.json({ status: 'success', ...result });
  } catch (err) {
    logger.error('Connector test-config failed', { error: err.message, stack: err.stack });
    return res.status(400).json({
      status: 'error',
      message: err.message || 'Connection test failed'
    });
  }
});

r.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM connectors WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.post('/', authenticate, auditLog('connector.create'), async (req, res) => {
  const { name, type, description, config, sync_schedule, provisioning_direction, create_application, application_name, owner, is_authoritative, is_sox, is_birthright } = req.body;
  const normalizedType = normalizeJdbcType(type);
  const normalizedConfig = normalizeConnectorConfig(normalizedType, config || {});
  if (!name || !normalizedType) return res.status(400).json({ error: 'name and type required' });
  if (!CONNECTORS[normalizedType]) return res.status(400).json({ error: `Unknown type: ${normalizedType}` });
  try {
    const { rows } = await db.query(
      `INSERT INTO connectors (tenant_id,name,type,description,config,sync_schedule,provisioning_direction,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
      [req.tenantId, name, normalizedType, description || '', JSON.stringify(normalizedConfig), sync_schedule, provisioning_direction || 'bidirectional']
    );
    let createdApplication = null;
    if (create_application !== false) {
      const appName = (application_name || `${name} Application`).trim();
      const existing = await db.query(
        `SELECT * FROM applications WHERE tenant_id=$1 AND metadata->>'connector_id'=$2 LIMIT 1`,
        [req.tenantId, rows[0].id]
      );
      if (existing.rows.length) {
        createdApplication = existing.rows[0];
      } else {
        const app = await db.query(
          `INSERT INTO applications (tenant_id, name, description, type, status, provisioning_enabled, provisioning_type, provisioning_config, metadata, owner_id, is_authoritative, is_sox, is_birthright)
           VALUES ($1,$2,$3,$4,'active',true,'connector',$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            req.tenantId,
            appName,
            description || `${name} managed through connector onboarding`,
            'saas',
            JSON.stringify({ connector_id: rows[0].id }),
            JSON.stringify({ connector_id: rows[0].id, auto_created: true }),
            (owner && owner.id) ? owner.id : null,
            !!is_authoritative,
            !!is_sox,
            !!is_birthright,
          ]
        );
        createdApplication = app.rows[0];
      }
    }
    res.status(201).json({
      ...rows[0],
      application: createdApplication,
      redirectTo: createdApplication ? `/applications?open=${createdApplication.id}` : '/connectors',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.put('/:id', authenticate, auditLog('connector.update'), async (req, res) => {
  const { name, description, config, sync_schedule, provisioning_direction, is_birthright, is_authoritative, is_sox } = req.body;
  try {
    const { rows: existing } = await db.query('SELECT * FROM connectors WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });

    const mergedConfig = { ...(existing[0].config || {}) };
    if (config) {
      for (const [k, v] of Object.entries(config)) {
        if (v !== '••••••••') mergedConfig[k] = v;
      }
    }

    const normalizedType = normalizeJdbcType(existing[0].type);
    const normalizedMergedConfig = normalizeConnectorConfig(normalizedType, mergedConfig);

    const { rows } = await db.query(
      `UPDATE connectors SET name=COALESCE($1,name), description=COALESCE($2,description), config=$3,
       sync_schedule=COALESCE($4,sync_schedule), provisioning_direction=COALESCE($5,provisioning_direction),
       is_birthright=CASE WHEN $6::boolean IS NOT NULL THEN $6 ELSE is_birthright END,
       updated_at=NOW()
       WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [name, description, JSON.stringify(normalizedMergedConfig), sync_schedule, provisioning_direction,
       is_birthright !== undefined ? !!is_birthright : null, req.params.id, req.tenantId]
    );

    // Also update the linked application's flags so Application page stays in sync
    await db.query(
      `UPDATE applications SET
         is_authoritative = CASE WHEN $1::boolean IS NOT NULL THEN $1 ELSE is_authoritative END,
         is_sox           = CASE WHEN $2::boolean IS NOT NULL THEN $2 ELSE is_sox END,
         is_birthright    = CASE WHEN $3::boolean IS NOT NULL THEN $3 ELSE is_birthright END,
         updated_at = NOW()
       WHERE tenant_id=$4
         AND (metadata->>'connector_id' = $5 OR provisioning_config->>'connector_id' = $5)`,
      [
        is_authoritative !== undefined ? !!is_authoritative : null,
        is_sox !== undefined ? !!is_sox : null,
        is_birthright !== undefined ? !!is_birthright : null,
        req.tenantId,
        req.params.id,
      ]
    ).catch(() => {}); // non-fatal if no linked app

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.delete('/:id', authenticate, auditLog('connector.delete'), async (req, res) => {
  const client = await db.connect();
  try {
    const { justification } = req.body || {};
    const { rows } = await client.query('SELECT * FROM connectors WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (!rows.length) return res.status(404).json({ error: 'Connector not found' });
    const connector = rows[0];

    await client.query('BEGIN');

    // 1. Delete connector account data (accounts + groups + their access items)
    //    NOTE: Users (identities) are NOT deleted — only their account links to this connector.
    await client.query('DELETE FROM account_access_items WHERE connector_id=$1', [req.params.id]);
    await client.query('DELETE FROM account_links WHERE connector_id=$1', [req.params.id]);

    // 2. Delete connector metadata
    await client.query('UPDATE provisioning_transactions SET connector_id=NULL WHERE connector_id=$1', [req.params.id]);
    await client.query('DELETE FROM sync_jobs WHERE connector_id=$1', [req.params.id]);
    await client.query('DELETE FROM connector_schemas WHERE connector_id=$1', [req.params.id]);
    await client.query('DELETE FROM schema_custom_attributes WHERE connector_id=$1', [req.params.id]);
    await client.query('DELETE FROM attribute_mappings WHERE connector_id=$1', [req.params.id]);
    await client.query('DELETE FROM aggregation_jobs WHERE connector_id=$1', [req.params.id]);
    await client.query('DELETE FROM provisioning_policies WHERE connector_id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);

    // 3. Delete linked application + its entitlements and scim tokens
    const appRes = await client.query(
      `SELECT id FROM applications WHERE tenant_id=$1
        AND (metadata->>'connector_id' = $2 OR provisioning_config->>'connector_id' = $2)`,
      [req.tenantId, req.params.id]
    );
    for (const app of appRes.rows) {
      await client.query('DELETE FROM entitlements WHERE application_id=$1 AND tenant_id=$2', [app.id, req.tenantId]);
      await client.query('DELETE FROM scim_tokens WHERE application_id=$1 AND tenant_id=$2', [app.id, req.tenantId]);
      await client.query(
        `DELETE FROM certification_items ci USING certifications c
          WHERE ci.certification_id=c.id AND c.tenant_id=$1 AND ci.resource_id=$2`,
        [req.tenantId, app.id]
      );
      await client.query('DELETE FROM applications WHERE id=$1 AND tenant_id=$2', [app.id, req.tenantId]);
    }

    // 4. Delete the connector itself
    await client.query('DELETE FROM connectors WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);

    await client.query('COMMIT');

    // Send deletion notification email (fire-and-forget)
    try {
      const acctCount = (await db.query(
        'SELECT COUNT(*)::int AS c FROM account_links WHERE connector_id=$1',
        [req.params.id]
      ).catch(() => ({ rows: [{ c: 0 }] }))).rows[0]?.c || 0;
      const entCount = appRes.rows.length > 0
        ? (await db.query(
            'SELECT COUNT(*)::int AS c FROM entitlements WHERE application_id = ANY($1::uuid[]) AND tenant_id=$2',
            [appRes.rows.map(a => a.id), req.tenantId]
          ).catch(() => ({ rows: [{ c: 0 }] }))).rows[0]?.c || 0
        : 0;
      const actorEmail = req.user?.email || process.env.ADMIN_NOTIFY_EMAIL || process.env.SMTP_FROM || 'admin@nexusiam.io';
      const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || actorEmail;
      const toList = [...new Set([actorEmail, adminEmail])].join(',');
      for (const app of appRes.rows) {
        EmailService.sendApplicationDeleted({
          app: { name: app.name || connector.name, type: connector.type },
          deletedBy: req.user?.username || req.user?.email || 'Admin',
          justification: justification || 'Deleted via Connector page',
          deletedConnector: true,
          acctCount,
          entCount,
          to: toList,
        }).catch(e => logger.warn('[EMAIL] Connector delete notification failed', { error: e.message }));
      }
      if (appRes.rows.length === 0) {
        // No linked app — still send a connector-level deletion notice
        EmailService.sendApplicationDeleted({
          app: { name: connector.name, type: connector.type },
          deletedBy: req.user?.username || req.user?.email || 'Admin',
          justification: justification || 'Deleted via Connector page',
          deletedConnector: true,
          acctCount,
          entCount: 0,
          to: toList,
        }).catch(e => logger.warn('[EMAIL] Connector delete notification failed', { error: e.message }));
      }
    } catch (emailErr) {
      logger.warn('[EMAIL] Connector delete notification error', { error: emailErr.message });
    }

    res.json({ success: true, deleted: { id: connector.id, name: connector.name }, justification });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Connector delete failed', { error: err.message });
    res.status(500).json({ error: 'Failed to delete connector: ' + err.message });
  } finally {
    client.release();
  }
});

r.post('/:id/test', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM connectors WHERE id=$1 AND tenant_id=$2',
      [req.params.id, req.tenantId]
    );

    if (!rows.length) {
      return res.status(404).json({ status: 'error', message: 'Connector not found' });
    }

    const connector = rows[0];
    const canonicalType = normalizeJdbcType(connector.type);
    const normalizedConfig = normalizeConnectorConfig(connector.config || {});

    let result;
    if (isJdbcType(canonicalType)) {
      result = await testJdbcConfigDirect(canonicalType, normalizedConfig);
    } else {
      result = await ProvisioningEngine.testConnectionConfig(canonicalType, normalizedConfig);
    }

    return res.json({
      status: 'success',
      ...result
    });
  } catch (err) {
    logger.error('Connector saved test failed', { error: err.message, stack: err.stack });
    return res.status(400).json({
      status: 'error',
      message: err.message || 'Connection test failed'
    });
  }
});

r.post('/:id/sync', authenticate, auditLog('connector.sync'), async (req, res) => {
  const { direction } = req.body;
  try {
    const { rows } = await db.query('SELECT provisioning_direction FROM connectors WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const syncDir = direction || rows[0].provisioning_direction || 'pull';
    const result = await ProvisioningEngine.executeSync(req.params.id, syncDir);
    res.json({ message: 'Sync completed', direction: syncDir, ...result });
  } catch (err) {
    logger.error('Sync failed', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

r.get('/:id/accounts', authenticate, async (req, res) => {
  try {
    const result = await ProvisioningEngine.listAccountLinks(req.params.id, req.tenantId, { page: req.query.page, limit: req.query.limit });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.get('/:id/jobs', authenticate, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM sync_jobs WHERE connector_id=$1 ORDER BY started_at DESC LIMIT 20', [req.params.id]);
  res.json(rows);
});

r.post('/:id/schema/discover', authenticate, auditLog('connector.schema.discover'), async (req, res) => {
  try {
    const result = await SchemaEngine.discoverSchema(req.params.id);
    // result is now { account: [...], group: [...] }
    const accountSchema = Array.isArray(result) ? result : (result.account || []);
    const groupSchema = Array.isArray(result) ? [] : (result.group || []);
    res.json({ schema: accountSchema, groupSchema, count: accountSchema.length, groupCount: groupSchema.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.get('/:id/schema', authenticate, async (req, res) => {
  try {
    const objectType = req.query.object_type || null; // 'account' | 'group' | null (all)
    const custom = await SchemaEngine.listCustomAttributes(req.params.id);
    const { rows: connRows } = await db.query('SELECT type FROM connectors WHERE id=$1', [req.params.id]);
    const connType = connRows[0]?.type;
    const def = connType ? CONNECTORS[connType] : null;

    if (objectType) {
      // Return single object type
      let schema = await SchemaEngine.getSchema(req.params.id, objectType) || [];
      if (!schema.length && objectType === 'account' && def) schema = [...(def.nativeSchema || [])];
      if (!schema.length && objectType === 'group' && def) {
        schema = await SchemaEngine._buildGroupSchema({ type: connType }, def);
      }
      if (objectType === 'account') {
        const existingNames = new Set(schema.map(s => s.name));
        for (const a of custom) {
          if (!existingNames.has(a.attribute_name)) {
            schema.push({ name: a.attribute_name, type: a.attribute_type, description: a.description, isCustom: true });
          }
        }
      }
      return res.json({ schema, objectType, source: 'discovered' });
    }

    // Return all object types
    const allSaved = await SchemaEngine.getSchema(req.params.id) || {};
    let accountSchema = allSaved.account || [];
    let groupSchema = allSaved.group || [];

    // Fall back to registry if nothing discovered yet
    if (!accountSchema.length && def) accountSchema = [...(def.nativeSchema || [])];
    if (!groupSchema.length && def) groupSchema = await SchemaEngine._buildGroupSchema({ type: connType }, def);

    // Merge custom attrs into account schema
    const existingNames = new Set(accountSchema.map(s => s.name));
    for (const a of custom) {
      if (!existingNames.has(a.attribute_name)) {
        accountSchema.push({ name: a.attribute_name, type: a.attribute_type, description: a.description, isCustom: true });
      }
    }

    res.json({
      schema: accountSchema,       // kept for backward compat
      groupSchema,
      accountSchema,
      objectTypes: { account: accountSchema, group: groupSchema },
      source: Object.keys(allSaved).length ? 'discovered' : 'registry',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.get('/:id/schema/custom', authenticate, async (req, res) => {
  res.json(await SchemaEngine.listCustomAttributes(req.params.id));
});

r.post('/:id/schema/custom', authenticate, auditLog('connector.schema.custom.add'), async (req, res) => {
  const { name, type, description, is_required, default_value } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const attr = await SchemaEngine.addCustomAttribute(req.params.id, { name, type, description, is_required, default_value });
    res.status(201).json(attr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.delete('/:id/schema/custom/:attrId', authenticate, async (req, res) => {
  await SchemaEngine.deleteCustomAttribute(req.params.attrId);
  res.json({ success: true });
});

// PATCH /:id/schema/attribute — update flags or type on a discovered attribute
r.patch('/:id/schema/attribute', authenticate, async (req, res) => {
  try {
    const { name, objectType = 'account', included, readOnly, isRequired, type } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const { rows: connRows } = await db.query('SELECT type FROM connectors WHERE id=$1', [req.params.id]);
    const connType = connRows[0]?.type;
    const def = connType ? CONNECTORS[connType] : null;

    let { rows } = await db.query(
      'SELECT schema_definition FROM connector_schemas WHERE connector_id=$1 AND object_type=$2',
      [req.params.id, objectType]
    );

    // If no saved schema yet (registry fallback), bootstrap from registry then patch
    if (!rows.length && def) {
      let baseSchema = objectType === 'account'
        ? [...(def.nativeSchema || [])]
        : await SchemaEngine._buildGroupSchema({ type: connType }, def);
      // Save it so future patches work
      await db.query(
        `INSERT INTO connector_schemas (connector_id, object_type, schema_definition)
         VALUES ($1,$2,$3)
         ON CONFLICT (connector_id, object_type) DO UPDATE SET schema_definition=$3`,
        [req.params.id, objectType, JSON.stringify(baseSchema)]
      );
      rows = [{ schema_definition: baseSchema }];
    }

    if (!rows.length) return res.status(404).json({ error: 'Schema not found — run Auto-Discover first' });

    const schema = rows[0].schema_definition;
    const updated = schema.map(attr => {
      if (attr.name !== name) return attr;
      const patch = {};
      if (included   !== undefined) patch.included   = included;
      if (readOnly   !== undefined) patch.readOnly   = readOnly;
      if (isRequired !== undefined) patch.isRequired = isRequired;
      if (type       !== undefined) patch.type       = type;
      return { ...attr, ...patch };
    });

    await db.query(
      'UPDATE connector_schemas SET schema_definition=$1 WHERE connector_id=$2 AND object_type=$3',
      [JSON.stringify(updated), req.params.id, objectType]
    );
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.get('/:id/mappings', authenticate, async (req, res) => {
  const mappings = await SchemaEngine.getMapping(req.params.id);
  res.json(mappings || []);
});

r.put('/:id/mappings', authenticate, auditLog('connector.mapping.save'), async (req, res) => {
  try {
    const { mappings } = req.body;
    await SchemaEngine.saveMapping(req.params.id, mappings || []);
    res.json({ success: true, count: (mappings || []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.post('/:id/mappings/test', authenticate, async (req, res) => {
  try {
    const { sampleRecord, mappings, direction } = req.body;
    const output = SchemaEngine.applyMappings(sampleRecord || {}, mappings || [], direction || 'pull');
    res.json({ output });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = r;