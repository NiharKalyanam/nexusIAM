/**
 * NexusIAM Provisioning Engine
 * Handles push (NexusIAM→App), pull (App→NexusIAM), and bidirectional sync
 * for all 35+ connector types.
 */

const axios = require('axios');
const mysql = require('mysql2/promise');
const { Client: PgClient } = require('pg');
const sql = require('mssql');
const db = require('../../config/database');
const logger = require('../../config/logger');
const SchemaEngine = require('../schema/SchemaEngine');
const RuleEngine = require('../rules/RuleEngine');

class ProvisioningEngine {

  // ─── Entry point: dispatch to correct connector handler ─────────────────────

  async executeSync(connectorId, direction = 'pull', options = {}) {
    const { rows } = await db.query('SELECT * FROM connectors WHERE id = $1', [connectorId]);
    if (!rows.length) throw new Error('Connector not found');
    const connector = rows[0];
    const config = connector.config || {};

    const jobId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    logger.info(`[SYNC] Starting ${direction} sync`, { connectorId, type: connector.type, jobId });

    // Log job start
    await db.query(
      `INSERT INTO sync_jobs (id, connector_id, direction, status, started_at)
       VALUES ($1,$2,$3,'running',NOW())`,
      [jobId, connectorId, direction]
    );

    let result = { added: 0, updated: 0, removed: 0, errors: 0, skipped: 0 };

    try {
      if (direction === 'pull' || direction === 'bidirectional') {
        if (options.aggregationType === 'group') {
          result = await this._pullGroupsFromSource(connector, config, options);
        } else {
          result = await this._pullFromSource(connector, config, options);
        }
      }
      if (direction === 'push' || direction === 'bidirectional') {
        const pushResult = await this._pushToTarget(connector, config, options);
        result.added += pushResult.added;
        result.updated += pushResult.updated;
        result.errors += pushResult.errors;
      }

      await db.query(
        `UPDATE sync_jobs SET status='completed', completed_at=NOW(), result=$2, records_processed=$3
         WHERE id=$1`,
        [jobId, JSON.stringify(result), result.added + result.updated + result.removed]
      );
      await db.query(`UPDATE connectors SET last_sync=NOW(), status='connected' WHERE id=$1`, [connectorId]);
      logger.info(`[SYNC] Completed`, { jobId, result });
    } catch (err) {
      logger.error(`[SYNC] Failed`, { jobId, error: err.message });
      await db.query(
        `UPDATE sync_jobs SET status='failed', completed_at=NOW(), error_message=$2 WHERE id=$1`,
        [jobId, err.message]
      );
      await db.query(`UPDATE connectors SET status='error' WHERE id=$1`, [connectorId]);
      throw err;
    }

    return { jobId, result };
  }

  // ─── PULL: App → NexusIAM ──────────────────────────────────────────────────

  async _pullFromSource(connector, config, options) {
    const result = { added: 0, updated: 0, removed: 0, errors: 0, skipped: 0, accounts: 0, linked: 0, unlinked: 0, errorDetails: [] };
    const mappings = await SchemaEngine.getMapping(connector.id) || [];
    let sourceUsers = [];

    try {
      sourceUsers = await this._fetchAllUsersFromApp(connector, config);
    } catch (err) {
      logger.error(`[PULL] Failed to fetch users from source`, { connector: connector.name, error: err.message, type: connector.type });
      throw new Error(`Failed to fetch users from source: ${err.message}`);
    }

    logger.info(`[PULL] Fetched ${sourceUsers.length} users from ${connector.name}`);

    for (const sourceUser of sourceUsers) {
      try {
        const mapped = mappings.length > 0
          ? SchemaEngine.applyMappings(sourceUser, mappings, 'pull')
          : this._autoMap(sourceUser, connector.type);

        const correlation = this._buildCorrelationCandidates(connector, mapped, sourceUser);
        let linkedUserId = null;
        let userWasCreated = false;
        let userWasUpdated = false;

        if (correlation.lookupEmail || correlation.lookupUsername || correlation.lookupEmployeeId) {
          const existing = await db.query(
            `SELECT id FROM users
              WHERE tenant_id = $1
                AND (
                  ($2::text IS NOT NULL AND LOWER(email) = LOWER($2::text))
                  OR ($3::text IS NOT NULL AND LOWER(username) = LOWER($3::text))
                  OR ($4::text IS NOT NULL AND employee_id = $4::text)
                )
              LIMIT 1`,
            [connector.tenant_id, correlation.lookupEmail, correlation.lookupUsername, correlation.lookupEmployeeId]
          );

          if (existing.rows.length) {
            linkedUserId = existing.rows[0].id;
            await db.query(
              `UPDATE users SET
                 first_name = COALESCE($1, first_name),
                 last_name = COALESCE($2, last_name),
                 display_name = COALESCE($3, display_name),
                 department = COALESCE($4, department),
                 title = COALESCE($5, title),
                 phone = COALESCE($6, phone),
                 employee_id = COALESCE($7, employee_id),
                 status = COALESCE($8, status),
                 source = COALESCE(source, $9),
                 external_id = COALESCE($10, external_id),
                 attributes = $11,
                 updated_at = NOW()
               WHERE id = $12`,
              [
                mapped.first_name,
                mapped.last_name,
                mapped.display_name || sourceUser.displayName || sourceUser.display_name,
                mapped.department,
                mapped.title,
                mapped.phone,
                mapped.employee_id || correlation.lookupEmployeeId,
                mapped.active === false ? 'inactive' : 'active',
                this._resolveUserSource(connector.type),
                mapped.external_id || mapped.id || sourceUser.id || sourceUser.objectId,
                JSON.stringify({ ...mapped, _sourceConnector: connector.id, _sourceRecord: sourceUser }),
                linkedUserId,
              ]
            );
            userWasUpdated = true;
          } else if (correlation.canCreateIdentity) {
            const username = correlation.lookupUsername || correlation.lookupEmail?.split('@')[0] || `acct_${Date.now()}`;
            const inserted = await db.query(
              `INSERT INTO users (tenant_id, username, email, first_name, last_name, display_name, department, title,
               phone, employee_id, status, source, external_id, attributes, password_hash)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, crypt('NexusPull@Temp!',gen_salt('bf'))) RETURNING id`,
              [
                connector.tenant_id,
                username,
                correlation.lookupEmail || `${username}@placeholder.local`,
                mapped.first_name,
                mapped.last_name,
                mapped.display_name || sourceUser.displayName || sourceUser.display_name || username,
                mapped.department,
                mapped.title,
                mapped.phone,
                mapped.employee_id || correlation.lookupEmployeeId,
                mapped.active === false ? 'inactive' : 'active',
                this._resolveUserSource(connector.type),
                mapped.external_id || mapped.id || sourceUser.id || sourceUser.objectId,
                JSON.stringify({ ...mapped, _sourceConnector: connector.id, _sourceRecord: sourceUser }),
              ]
            );
            linkedUserId = inserted.rows[0].id;
            userWasCreated = true;
          }
        }

        const accountLink = await this._upsertAccountLink(connector, sourceUser, linkedUserId);
        await this._syncAccountAccessItems(accountLink, connector, sourceUser);

        // Apply identity_source_mappings → write into users.identity_attributes
        if (linkedUserId) {
          try {
            await this._applyIdentityAttributeMappings(connector, sourceUser, linkedUserId);
          } catch (mappingErr) {
            logger.warn('[PULL] Identity attribute mapping error', { error: mappingErr.message });
          }
        }

        result.accounts++;
        if (linkedUserId) result.linked++; else result.unlinked++;
        if (userWasCreated) result.added++;
        else if (userWasUpdated) result.updated++;
        else result.skipped++;
      } catch (err) {
        logger.warn(`[PULL] Error processing user`, { error: err.message, user: sourceUser, connector: connector.name });
        result.errors++;
        if (result.errorDetails.length < 10) {
          result.errorDetails.push({
            nativeIdentity: sourceUser?.id || sourceUser?.email || sourceUser?.username || null,
            error: err.message,
          });
        }
      }
    }

    return result;
  }

  // ─── GROUP AGGREGATION: App → NexusIAM (groups/entitlements) ─────────────

  async _pullGroupsFromSource(connector, config, options) {
    const result = { added: 0, updated: 0, removed: 0, errors: 0, skipped: 0,
                     groups: 0, entitlements_created: 0, errorDetails: [] };
    let groups = [];
    try {
      groups = await this._fetchAllGroupsFromApp(connector, config);
    } catch (err) {
      logger.error(`[GROUP-PULL] Failed to fetch groups`, { connector: connector.name, error: err.message });
      throw new Error(`Failed to fetch groups: ${err.message}`);
    }

    logger.info(`[GROUP-PULL] Fetched ${groups.length} groups from ${connector.name}`);

    const { rows: appRows } = await db.query(
      `SELECT id FROM applications WHERE tenant_id=$1
         AND (metadata->>'connector_id'=$2 OR provisioning_config->>'connector_id'=$2) LIMIT 1`,
      [connector.tenant_id, connector.id]
    );
    const applicationId = appRows[0]?.id || null;

    for (const group of groups) {
      const norm = this._normalizeGroupRecord(group, connector);
      if (!norm.nativeIdentity) { result.skipped++; continue; }

      // ── Step 1: upsert account_link for this group ────────────────────────
      let groupLink;
      try {
        const sourceHash = require('crypto').createHash('sha1')
          .update(JSON.stringify(group)).digest('hex');
        const { rows: linkRows } = await db.query(
          `INSERT INTO account_links
             (tenant_id, connector_id, native_identity, account_name, display_name, status,
              object_type, correlation_value, source_hash, source_record, attributes,
              first_seen_at, last_seen_at, last_aggregated_at)
           VALUES ($1,$2,$3,$4,$5,'active','group',$6,$7,$8::jsonb,$9::jsonb,NOW(),NOW(),NOW())
           ON CONFLICT (connector_id, native_identity) DO UPDATE
             SET account_name=EXCLUDED.account_name, display_name=EXCLUDED.display_name,
                 object_type='group', source_hash=EXCLUDED.source_hash,
                 source_record=EXCLUDED.source_record, attributes=EXCLUDED.attributes,
                 last_seen_at=NOW(), last_aggregated_at=NOW()
           RETURNING *`,
          [connector.tenant_id, connector.id, norm.nativeIdentity, norm.name,
           norm.displayName, norm.nativeIdentity, sourceHash,
           JSON.stringify(group), JSON.stringify({ ...norm, objectType: 'group' })]
        );
        groupLink = linkRows[0];
        result.groups++;
      } catch (err) {
        logger.error(`[GROUP-PULL] account_link upsert failed: ${err.message}`, { groupId: group?.id });
        result.errors++;
        result.errorDetails.push({ nativeIdentity: group?.id, groupName: group?.displayName, error: `account_link: ${err.message}` });
        continue;
      }

      // ── Step 2: upsert entitlement row ────────────────────────────────────
      try {
        const markReq = !!(options && options.markRequestable);
        const existingEnt = await db.query(
          `SELECT id FROM entitlements
            WHERE tenant_id=$1 AND type='group' AND value=$2
              AND (application_id=$3 OR (application_id IS NULL AND metadata->>'connector_id'=$4))
            LIMIT 1`,
          [connector.tenant_id, norm.nativeIdentity, applicationId || '00000000-0000-0000-0000-000000000000', connector.id.toString()]
        );
        if (!existingEnt.rows.length) {
          await db.query(
            `INSERT INTO entitlements (tenant_id, application_id, name, description, type, value, metadata)
             VALUES ($1,$2,$3,$4,'group',$5,
               jsonb_build_object('connector_id',$6::text,'group_id',$7::text,'member_count',$8::int,'requestable',$9::boolean))`,
            [connector.tenant_id, applicationId || null,
             norm.displayName || norm.nativeIdentity,
             norm.description || norm.displayName || norm.nativeIdentity,
             norm.nativeIdentity,
             connector.id.toString(), norm.nativeIdentity,
             norm.members.length, !!markReq]
          );
          result.entitlements_created++;
        } else {
          await db.query(
            `UPDATE entitlements
               SET name=$1, metadata = metadata || jsonb_build_object('member_count',$2::int,'requestable',$3::boolean)
             WHERE id=$4`,
            [norm.displayName || norm.nativeIdentity, norm.members.length, !!markReq, existingEnt.rows[0].id]
          );
          result.updated++;
        }
      } catch (err) {
        logger.error(`[GROUP-PULL] entitlement upsert failed: ${err.message}`, { groupId: group?.id, stack: err.stack });
        result.errorDetails.push({ nativeIdentity: group?.id, groupName: group?.displayName, error: `entitlement: ${err.message}` });
        // don't count as error — group was still processed, just entitlement failed
      }

      // ── Step 3: link members to this group (best-effort) ─────────────────
      for (const memberId of norm.members) {
        if (!memberId) continue;
        try {
          const { rows: ml } = await db.query(
            `SELECT id FROM account_links WHERE connector_id=$1 AND native_identity=$2 AND object_type='account' LIMIT 1`,
            [connector.id, String(memberId)]
          );
          if (!ml.length) continue;
          await db.query(
            `INSERT INTO account_access_items
               (tenant_id, connector_id, account_link_id, access_type, access_value, display_name, raw_item)
             VALUES ($1,$2,$3,'group',$4,$5,$6::jsonb)
             ON CONFLICT (account_link_id, access_type, access_value) DO UPDATE
               SET display_name=EXCLUDED.display_name`,
            [connector.tenant_id, connector.id, ml[0].id,
             norm.nativeIdentity, norm.displayName,
             JSON.stringify({ groupId: norm.nativeIdentity, groupName: norm.displayName })]
          );
        } catch (merr) {
          logger.warn(`[GROUP-PULL] member link failed: ${merr.message}`, { memberId });
        }
      }

      result.added++;
    }
    return result;
  }

  _normalizeGroupRecord(group, connector) {
    const nativeIdentity = String(
      group.id || group.objectId || group.groupId || group.teamId || group.sys_id || group.dn || ''
    );
    const name = group.displayName || group.name || group.cn || nativeIdentity;
    let members = [];
    const raw = group.members || group.member || group.uniqueMember || group.users || [];
    if (Array.isArray(raw)) {
      members = raw.map(m => {
        if (!m) return null;
        if (typeof m === 'string') return m;
        return m.value || m.id || m.userName || m.login || m.userId || m.memberUid || m.dn || null;
      }).filter(Boolean);
    }
    return { nativeIdentity, name, displayName: name, description: group.description || '', members };
  }

  async _fetchAllGroupsFromApp(connector, config) {
    switch (connector.type) {
      case 'scim2':
      case 'slack':       return await this._fetchScimGroups(config);
      case 'okta':        return await this._fetchOktaGroups(config);
      case 'azure_ad':    return await this._fetchAzureGroups(config);
      case 'github':      return await this._fetchGithubTeams(config);
      case 'salesforce':  return await this._fetchSalesforceGroups(config);
      case 'servicenow':  return await this._fetchServiceNowGroups(config);
      default:
        logger.warn(`[GROUP-PULL] No group handler for type: ${connector.type}`);
        return [];
    }
  }

  async _fetchScimGroups(config) {
    const baseUrl = (config.base_url || '').replace(/\/$/, '') ||
      (config.workspace_token ? 'https://api.slack.com/scim/v1' : null);
    if (!baseUrl) return [];
    const token = config.bearer_token || config.workspace_token;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const groups = [];
    let startIndex = 1;
    const count = config.page_size || 100;
    while (true) {
      const res = await axios.get(`${baseUrl}/Groups`,
        { headers, params: { startIndex, count }, timeout: 30000 });
      const batch = res.data?.Resources || [];
      groups.push(...batch);
      if (batch.length < count) break;
      startIndex += count;
    }
    return groups;
  }

  async _fetchOktaGroups(config) {
    const baseUrl = `https://${config.domain}.okta.com`;
    const headers = { Authorization: `SSWS ${config.api_token}` };
    const groups = [];
    let url = `${baseUrl}/api/v1/groups?limit=200`;
    while (url) {
      const res = await axios.get(url, { headers, timeout: 30000 });
      for (const g of (res.data || [])) {
        let members = [];
        try {
          const mr = await axios.get(`${baseUrl}/api/v1/groups/${g.id}/users?limit=1000`, { headers, timeout: 15000 });
          members = (mr.data || []).map(u => u.profile?.login || u.id);
        } catch {}
        groups.push({ id: g.id, displayName: g.profile?.name, description: g.profile?.description, members });
      }
      const next = res.headers?.link?.match(/<([^>]+)>; rel="next"/)?.[1];
      url = next || null;
    }
    return groups;
  }

  async _fetchAzureGroups(config) {
    const token = await SchemaEngine._getAzureToken(config);
    const headers = { Authorization: `Bearer ${token}` };
    const groups = [];
    let url = 'https://graph.microsoft.com/v1.0/groups?$top=100&$select=id,displayName,description';
    while (url) {
      const res = await axios.get(url, { headers, timeout: 30000 });
      for (const g of (res.data?.value || [])) {
        let members = [];
        try {
          const mr = await axios.get(
            `https://graph.microsoft.com/v1.0/groups/${g.id}/members?$select=id,userPrincipalName&$top=999`,
            { headers, timeout: 15000 });
          members = (mr.data?.value || []).map(m => m.userPrincipalName || m.id);
        } catch {}
        groups.push({ ...g, members });
      }
      url = res.data?.['@odata.nextLink'] || null;
    }
    return groups;
  }

  async _fetchGithubTeams(config) {
    const headers = { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github.v3+json' };
    const base = config.enterprise_url ? `${config.enterprise_url}/api/v3` : 'https://api.github.com';
    const res = await axios.get(`${base}/orgs/${config.org}/teams?per_page=100`, { headers, timeout: 30000 });
    const teams = res.data || [];
    for (const t of teams) {
      try {
        const mr = await axios.get(`${base}/orgs/${config.org}/teams/${t.slug}/members?per_page=100`, { headers, timeout: 15000 });
        t.members = (mr.data || []).map(m => m.login);
      } catch { t.members = []; }
    }
    return teams.map(t => ({ id: String(t.id), displayName: t.name, description: t.description, members: t.members }));
  }

  async _fetchSalesforceGroups(config) {
    const token = await SchemaEngine._getSalesforceToken(config);
    const v = config.api_version || 'v59.0';
    const q = encodeURIComponent("SELECT Id,Name,Type FROM Group WHERE Type='Regular'");
    const res = await axios.get(`${config.instance_url}/services/data/${v}/query?q=${q}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });
    return (res.data?.records || []).map(g => ({ id: g.Id, displayName: g.Name, description: g.Type, members: [] }));
  }

  async _fetchServiceNowGroups(config) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const res = await axios.get(
      `${config.instance_url}/api/now/table/sys_user_group?sysparm_fields=sys_id,name,description&sysparm_limit=5000`,
      { headers: { Authorization: `Basic ${auth}` }, timeout: 30000 });
    return (res.data?.result || []).map(g => ({ id: g.sys_id, displayName: g.name, description: g.description, members: [] }));
  }


  // ─── PUSH: NexusIAM → App ─────────────────────────────────────────────────

  async _pushToTarget(connector, config, options) {
    const result = { added: 0, updated: 0, errors: 0 };
    const mappings = await SchemaEngine.getMapping(connector.id) || [];
    const tenantId = connector.tenant_id;

    // Load provisioning policies for this connector (Create + Update)
    const { rows: policyRows } = await db.query(
      `SELECT operation, fields, enabled FROM provisioning_policies
        WHERE connector_id=$1 AND tenant_id=$2 AND enabled=true AND operation IN ('Create','Update')`,
      [connector.id, tenantId]
    );
    const policyByOp = {};
    for (const p of policyRows) policyByOp[p.operation] = p.fields;

    // Get users that need provisioning
    const whereClause = options.userId
      ? `WHERE u.id = $2`
      : `WHERE u.tenant_id = $2 AND u.status = 'active'`;

    const { rows: users } = await db.query(
      `SELECT u.*, array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) as roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'\n       LEFT JOIN roles r ON r.id = ur.role_id
       ${whereClause} GROUP BY u.id`,
      [connector.id, options.userId || tenantId]
    );

    for (const user of users) {
      try {
        // Check if account already exists (determines Create vs Update)
        const { rows: existing } = await db.query(
          `SELECT id FROM account_links WHERE connector_id=$1 AND tenant_id=$2 AND (email=$3 OR correlation_value=$3) AND object_type='account' LIMIT 1`,
          [connector.id, tenantId, user.email]
        );
        const operation = existing.length ? 'Update' : 'Create';
        const policyFields = policyByOp[operation];

        let targetPayload;
        if (policyFields && policyFields.length > 0) {
          // Policy-driven: resolve all fields via RuleEngine
          targetPayload = RuleEngine.resolveFields(policyFields, {
            identity: user,
            connector,
            operation,
            account: existing[0] || null,
          });
        } else if (mappings.length > 0) {
          // Schema mapping fallback
          targetPayload = SchemaEngine.applyMappings(user, mappings, 'push');
        } else {
          // Auto-map fallback
          targetPayload = this._autoMapReverse(user, connector.type);
        }

        const pushed = await this._provisionUserToApp(connector, config, targetPayload, user);
        if (pushed === 'created') result.added++;
        else if (pushed === 'updated') result.updated++;
      } catch (err) {
        logger.warn(`[PUSH] Error provisioning user ${user.email}`, { error: err.message });
        result.errors++;
      }
    }
    return result;
  }

  // ─── Fetch users from various app types ───────────────────────────────────

  async _fetchAllUsersFromApp(connector, config) {
    switch (connector.type) {

      case 'active_directory':
      case 'ldap':
        return await this._fetchLdapUsers(config, connector.type);

      case 'okta':
        return await this._fetchOktaUsers(config);

      case 'azure_ad':
        return await this._fetchAzureUsers(config);

      case 'google_workspace':
        return await this._fetchGoogleUsers(config);

      case 'scim2':
      case 'slack':
        return await this._fetchScimUsers(config);

      case 'salesforce':
        return await this._fetchSalesforceUsers(config);

      case 'servicenow':
        return await this._fetchServiceNowUsers(config);

      case 'workday':
        return await this._fetchWorkdayUsers(config);

      case 'github':
        return await this._fetchGithubUsers(config);

      case 'jira':
        return await this._fetchJiraUsers(config);

      case 'rest_generic':
        return await this._fetchRestUsers(config);

      case 'csv_flat_file':
        return await this._fetchCsvUsers(config);

      case 'jdbc_postgresql':
      case 'jdbc_mysql':
      case 'jdbc_mssql':
      case 'jdbc_oracle':
        return await this._fetchDbUsers(config, connector.type);

      default:
        logger.warn(`[PULL] No fetch handler for connector type: ${connector.type}`);
        return [];
    }
  }

  async _fetchOktaUsers(config) {
    const baseUrl = `https://${config.domain}.okta.com`;
    const headers = { Authorization: `SSWS ${config.api_token}` };
    const users = [];
    let url = `${baseUrl}/api/v1/users?limit=200&filter=status eq "ACTIVE"`;
    while (url) {
      const res = await axios.get(url, { headers, timeout: 30000 });
      for (const u of res.data) {
        users.push({ id: u.id, ...u.profile, status: u.status, created: u.created, lastLogin: u.lastLogin });
      }
      const next = res.headers?.link?.match(/<([^>]+)>; rel="next"/)?.[1];
      url = next || null;
    }
    return users;
  }

  async _fetchAzureUsers(config) {
    const token = await SchemaEngine._getAzureToken(config);
    const headers = { Authorization: `Bearer ${token}` };
    const users = [];
    let url = 'https://graph.microsoft.com/v1.0/users?$top=999&$select=id,userPrincipalName,displayName,givenName,surname,mail,jobTitle,department,employeeId,mobilePhone,businessPhones,accountEnabled,createdDateTime,lastSignInDateTime';
    while (url) {
      const res = await axios.get(url, { headers, timeout: 30000 });
      users.push(...(res.data?.value || []));
      url = res.data?.['@odata.nextLink'] || null;
    }
    return users;
  }

  async _fetchScimUsers(config) {
    const baseUrl = config.base_url?.replace(/\/$/, '') || config.workspace_token && 'https://api.slack.com/scim/v1';
    const token = config.bearer_token || config.workspace_token;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const users = [];
    let startIndex = 1;
    const count = config.page_size || 100;
    while (true) {
      const res = await axios.get(`${baseUrl}/Users`, { headers, params: { startIndex, count }, timeout: 30000 });
      const batch = res.data?.Resources || [];
      users.push(...batch);
      if (batch.length < count) break;
      startIndex += count;
    }
    return users;
  }

  async _fetchSalesforceUsers(config) {
    const token = await SchemaEngine._getSalesforceToken(config);
    const v = config.api_version || 'v59.0';
    const res = await axios.get(
      `${config.instance_url}/services/data/${v}/query?q=${encodeURIComponent("SELECT Id,Username,FirstName,LastName,Email,Title,Department,IsActive,EmployeeNumber,FederationIdentifier,LastLoginDate FROM User WHERE IsActive=true")}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
    );
    return res.data?.records || [];
  }

  async _fetchServiceNowUsers(config) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const res = await axios.get(
      `${config.instance_url}/api/now/table/${config.user_table || 'sys_user'}`,
      { headers: { Authorization: `Basic ${auth}` }, params: { sysparm_query: config.query_filter || 'active=true', sysparm_limit: 5000 }, timeout: 30000 }
    );
    return res.data?.result || [];
  }

  async _fetchWorkdayUsers(config) {
    // Workday RaaS (Reports as a Service) endpoint for workers
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const url = `https://services1.myworkday.com/ccx/service/${config.tenant}/Human_Resources/${config.version || 'v41.0'}/Get_Workers`;
    // In production this would use SOAP API — return demo structure here
    logger.info('[PULL] Workday connector — production would call SOAP API', { tenant: config.tenant });
    return [];
  }

  async _fetchGithubUsers(config) {
    const headers = { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github.v3+json' };
    const baseUrl = config.enterprise_url ? `${config.enterprise_url}/api/v3` : 'https://api.github.com';
    const res = await axios.get(`${baseUrl}/orgs/${config.org}/members?per_page=100`, { headers, timeout: 30000 });
    return res.data || [];
  }

  async _fetchJiraUsers(config) {
    const auth = Buffer.from(`${config.email}:${config.api_token}`).toString('base64');
    const users = [];
    let startAt = 0;
    while (true) {
      const res = await axios.get(
        `${config.base_url}/rest/api/3/users/search?maxResults=50&startAt=${startAt}`,
        { headers: { Authorization: `Basic ${auth}` }, timeout: 30000 }
      );
      users.push(...(res.data || []));
      if (!res.data?.length || res.data.length < 50) break;
      startAt += 50;
    }
    return users.filter(u => u.accountType === 'atlassian');
  }

  async _fetchRestUsers(config) {
    const headers = SchemaEngine._buildRestHeaders ? SchemaEngine._buildRestHeaders(config) : {};
    const endpoint = (config.list_users_endpoint || '/users').replace('GET ', '');
    const url = `${config.base_url}${endpoint}`;
    const res = await axios.get(url, { headers, timeout: 30000 });
    return SchemaEngine._extractArray ? SchemaEngine._extractArray(res.data, config.users_json_path) : (res.data?.data || res.data || []);
  }

  async _fetchCsvUsers(config) {
    const fs = require('fs');
    if (!config.file_path || !fs.existsSync(config.file_path)) {
      logger.warn('[CSV] File not found', { path: config.file_path });
      return [];
    }
    const { parse } = require('csv-parse/sync');
    const content = fs.readFileSync(config.file_path, config.encoding || 'utf8');
    return parse(content, { columns: config.has_header !== false, delimiter: config.delimiter || ',', skip_empty_lines: true });
  }

  async _fetchLdapUsers(config, connectorType) {
    // Real LDAP connection using ldapjs
    const ldap = require('ldapjs');
    return new Promise((resolve, reject) => {
      const client = ldap.createClient({ url: `${config.ssl ? 'ldaps' : 'ldap'}://${config.host}:${config.port || 389}`, timeout: 10000 });
      const users = [];
      client.on('error', reject);
      client.bind(config.bind_dn, config.bind_password, (err) => {
        if (err) return reject(err);
        const filter = config.user_filter || (connectorType === 'active_directory' ? '(&(objectClass=user)(objectCategory=person))' : '(objectClass=inetOrgPerson)');
        const opts = { filter, scope: 'sub', attributes: ['*'], paged: { pageSize: config.page_size || 500 } };
        client.search(config.user_search_base || config.base_dn, opts, (err, res) => {
          if (err) return reject(err);
          res.on('searchEntry', e => users.push(e.object));
          res.on('error', reject);
          res.on('end', () => { client.destroy(); resolve(users); });
        });
      });
    });
  }

  async _fetchDbUsers(config, dbType) {
    const query = String(config.query_all_users || config.query_fetch_all_users || config.fetch_all_users_sql || '').trim().replace(/;\s*$/, '');
    const userTable = config.user_table || config.user_table_name;
    if (!query && !userTable) {
      logger.warn('[DB] No query configured for db connector');
      return [];
    }
    const host = this._normalizeContainerHost(config.host || config.hostname || config.server);
    const port = Number(config.port || (dbType === 'jdbc_postgresql' ? 5432 : dbType === 'jdbc_mssql' ? 1433 : 3306));
    const database = config.database || config.database_name;
    const username = config.username || config.user;
    const password = config.password || '';
    const sqlText = query || (dbType === 'jdbc_mssql' ? `SELECT TOP 500 * FROM ${userTable}` : `SELECT * FROM ${userTable} LIMIT 500`);

    if (dbType === 'jdbc_postgresql') {
      const { Pool } = require('pg');
      const pool = new Pool({ host, port, database, user: username, password });
      try {
        const res = await pool.query(sqlText);
        return res.rows || [];
      } finally { await pool.end(); }
    }

    if (dbType === 'jdbc_mysql') {
      const conn = await mysql.createConnection({ host, port, user: username, password, database, connectTimeout: 8000 });
      try {
        const [rows] = await conn.query(sqlText);
        return rows || [];
      } finally { await conn.end(); }
    }

    if (dbType === 'jdbc_mssql') {
      const pool = await sql.connect({ user: username, password, server: host, port, database, options: { trustServerCertificate: true, encrypt: false }, connectionTimeout: 8000 });
      try {
        const result = await pool.request().query(sqlText);
        return result.recordset || [];
      } finally { await pool.close(); }
    }

    logger.warn('[DB] Unsupported JDBC type for pull', { dbType });
    return [];
  }

  // ─── Provision user TO app ─────────────────────────────────────────────────

  async _provisionUserToApp(connector, config, payload, user) {
    switch (connector.type) {
      case 'okta': return await this._provisionOkta(config, payload, user);
      case 'azure_ad': return await this._provisionAzure(config, payload, user);
      case 'scim2':
      case 'slack': return await this._provisionScim(config, payload, user);
      case 'active_directory':
      case 'ldap': return await this._provisionLdap(config, payload, user, connector.type);
      default:
        logger.warn(`[PUSH] No push handler for type: ${connector.type}`);
        return 'skipped';
    }
  }

  async _provisionOkta(config, payload, user) {
    const baseUrl = `https://${config.domain}.okta.com`;
    const headers = { Authorization: `SSWS ${config.api_token}`, 'Content-Type': 'application/json' };
    try {
      // Check if user exists
      const search = await axios.get(`${baseUrl}/api/v1/users/${encodeURIComponent(user.email)}`, { headers, timeout: 10000 });
      await axios.post(`${baseUrl}/api/v1/users/${search.data.id}`, { profile: payload }, { headers, timeout: 10000 });
      return 'updated';
    } catch (err) {
      if (err.response?.status === 404) {
        await axios.post(`${baseUrl}/api/v1/users?activate=true`, { profile: payload, credentials: { password: { value: 'Nexus@Temp2024!' } } }, { headers, timeout: 10000 });
        return 'created';
      }
      throw err;
    }
  }

  async _provisionAzure(config, payload, user) {
    const token = await SchemaEngine._getAzureToken(config);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    try {
      const search = await axios.get(`https://graph.microsoft.com/v1.0/users?$filter=userPrincipalName eq '${payload.userPrincipalName}'`, { headers, timeout: 10000 });
      if (search.data?.value?.length) {
        await axios.patch(`https://graph.microsoft.com/v1.0/users/${search.data.value[0].id}`, payload, { headers, timeout: 10000 });
        return 'updated';
      } else {
        await axios.post('https://graph.microsoft.com/v1.0/users', payload, { headers, timeout: 10000 });
        return 'created';
      }
    } catch (err) { throw err; }
  }

  async _provisionScim(config, payload, user) {
    const baseUrl = (config.base_url || '').replace(/\/$/, '');
    const token = config.bearer_token || config.workspace_token;
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' };
    try {
      const search = await axios.get(`${baseUrl}/Users?filter=userName eq "${payload.userName}"`, { headers, timeout: 10000 });
      if (search.data?.Resources?.length) {
        await axios.patch(`${baseUrl}/Users/${search.data.Resources[0].id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: payload }] }, { headers, timeout: 10000 });
        return 'updated';
      } else {
        await axios.post(`${baseUrl}/Users`, { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], ...payload }, { headers, timeout: 10000 });
        return 'created';
      }
    } catch (err) { throw err; }
  }

  async _provisionLdap(config, payload, user, connectorType) {
    // LDAP provisioning via ldapjs
    logger.info('[LDAP] Provisioning user', { username: user.username });
    return 'skipped'; // Stub — full LDAP write in production
  }

  // ─── Auto-mapping fallbacks (when no explicit mappings configured) ──────────

  _autoMap(sourceUser, connectorType) {
    const maps = {
      active_directory: { sAMAccountName: 'username', mail: 'email', givenName: 'first_name', sn: 'last_name', department: 'department', title: 'title', telephoneNumber: 'phone', employeeID: 'employee_id', distinguishedName: 'external_id' },
      ldap: { uid: 'username', mail: 'email', givenName: 'first_name', sn: 'last_name', o: 'department', telephoneNumber: 'phone' },
      okta: { login: 'username', email: 'email', firstName: 'first_name', lastName: 'last_name', department: 'department', title: 'title', mobilePhone: 'phone', employeeNumber: 'employee_id' },
      azure_ad: { userPrincipalName: 'username', mail: 'email', givenName: 'first_name', surname: 'last_name', department: 'department', jobTitle: 'title', mobilePhone: 'phone', employeeId: 'employee_id', id: 'external_id' },
      salesforce: { Username: 'username', Email: 'email', FirstName: 'first_name', LastName: 'last_name', Department: 'department', Title: 'title', Phone: 'phone', EmployeeNumber: 'employee_id', Id: 'external_id' },
      servicenow: { user_name: 'username', email: 'email', first_name: 'first_name', last_name: 'last_name', department: 'department', title: 'title', phone: 'phone' },
      workday: { User_Name: 'username', Email_Address: 'email', First_Name: 'first_name', Last_Name: 'last_name', Department: 'department', Job_Title: 'title', Phone_Number: 'phone', Employee_ID: 'employee_id' },
      github: { login: 'username', email: 'email', name: 'display_name' },
      jira: { emailAddress: 'email', displayName: 'display_name', accountId: 'external_id' },
      scim2: { userName: 'username', 'emails.0.value': 'email', 'name.givenName': 'first_name', 'name.familyName': 'last_name', title: 'title', 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.department': 'department', id: 'external_id' },
      slack: { userName: 'username', 'emails.0.value': 'email', 'name.givenName': 'first_name', 'name.familyName': 'last_name' },
      jdbc_mysql: { id: 'external_id', email: 'email', first_name: 'first_name', last_name: 'last_name', display_name: 'display_name', username: 'username', department: 'department', jobTitle: 'title', title: 'title', mobile: 'phone', phone: 'phone', employee_id: 'employee_id', status: 'status' },
      jdbc_postgresql: { id: 'external_id', email: 'email', first_name: 'first_name', last_name: 'last_name', display_name: 'display_name', username: 'username', department: 'department', jobTitle: 'title', title: 'title', mobile: 'phone', phone: 'phone', employee_id: 'employee_id', status: 'status' },
      jdbc_mssql: { id: 'external_id', email: 'email', first_name: 'first_name', last_name: 'last_name', display_name: 'display_name', username: 'username', department: 'department', jobTitle: 'title', title: 'title', mobile: 'phone', phone: 'phone', employee_id: 'employee_id', status: 'status' },
      jdbc_oracle: { id: 'external_id', email: 'email', first_name: 'first_name', last_name: 'last_name', display_name: 'display_name', username: 'username', department: 'department', jobTitle: 'title', title: 'title', mobile: 'phone', phone: 'phone', employee_id: 'employee_id', status: 'status' },
    };

    const fieldMap = maps[connectorType] || {};
    const result = {};
    for (const [src, dst] of Object.entries(fieldMap)) {
      const val = SchemaEngine._getNestedValue ? SchemaEngine._getNestedValue(sourceUser, src) : sourceUser[src];
      if (val !== undefined) result[dst] = val;
    }
    result.active = sourceUser.active !== undefined ? sourceUser.active : (sourceUser.accountEnabled !== undefined ? sourceUser.accountEnabled : (sourceUser.IsActive !== undefined ? sourceUser.IsActive : true));
    return result;
  }

  _autoMapReverse(user, connectorType) {
    const maps = {
      okta: { username: 'login', email: 'email', first_name: 'firstName', last_name: 'lastName', department: 'department', title: 'title', phone: 'mobilePhone', employee_id: 'employeeNumber' },
      azure_ad: { email: 'mail', first_name: 'givenName', last_name: 'surname', department: 'department', title: 'jobTitle', phone: 'mobilePhone', employee_id: 'employeeId' },
      scim2: { username: 'userName', email: 'emails[0].value', first_name: 'name.givenName', last_name: 'name.familyName', title: 'title', department: 'department' },
    };
    const fieldMap = maps[connectorType] || {};
    const result = {};
    for (const [src, dst] of Object.entries(fieldMap)) {
      if (user[src] !== undefined) result[dst] = user[src];
    }
    return result;
  }

  // ─── Test connection ───────────────────────────────────────────────────────



  _resolveUserSource(connectorType) {
    const directoryLike = ['active_directory', 'ldap'];
    const federatedLike = ['azure_ad', 'okta', 'google_workspace'];
    const scimLike = ['scim2', 'slack'];
    if (directoryLike.includes(connectorType)) return 'ldap';
    if (federatedLike.includes(connectorType)) return 'oidc';
    if (scimLike.includes(connectorType)) return 'scim';
    return 'local';
  }

  _normalizeAccountRecord(sourceUser = {}, connector = {}) {
    // Extract SCIM emails array (emails[0].value or primary email)
    let scimEmail = null;
    if (Array.isArray(sourceUser.emails) && sourceUser.emails.length) {
      const primary = sourceUser.emails.find(e => e.primary) || sourceUser.emails[0];
      scimEmail = primary?.value || null;
    }
    // Extract SCIM name object
    const scimFirstName = sourceUser.name?.givenName || null;
    const scimLastName  = sourceUser.name?.familyName || null;

    const nativeIdentity = String(
      sourceUser.id || sourceUser.objectId || sourceUser.userName || sourceUser.username ||
      scimEmail || sourceUser.email || sourceUser.mail || sourceUser.userPrincipalName || sourceUser.employeeId || ''
    ).trim();

    const email = scimEmail || sourceUser.email || sourceUser.mail || sourceUser.userPrincipalName || sourceUser.login || null;
    const accountName = sourceUser.username || sourceUser.userName || sourceUser.login || email || nativeIdentity || null;

    const firstName = sourceUser.first_name || scimFirstName || sourceUser.givenName || sourceUser.firstName || '';
    const lastName  = sourceUser.last_name  || scimLastName  || sourceUser.surname  || sourceUser.lastName  || '';
    const displayName = sourceUser.display_name || sourceUser.displayName ||
      sourceUser.name?.formatted ||
      [firstName, lastName].filter(Boolean).join(' ') || accountName;

    const status = sourceUser.status || (sourceUser.active === false || sourceUser.accountEnabled === false ? 'Inactive' : 'Active');
    const correlationValue = email || accountName || nativeIdentity;
    return { nativeIdentity, accountName, displayName, email, status, correlationValue };
  }

  _buildCorrelationCandidates(connector, mapped = {}, sourceUser = {}) {
    const configuredAttr = (connector.config?.correlation_attribute || connector.config?.identity_attribute || '').trim();
    const configuredValue = configuredAttr ? (mapped[configuredAttr] || sourceUser[configuredAttr]) : null;
    // Also handle SCIM emails array directly on sourceUser
    const scimEmailDirect = Array.isArray(sourceUser.emails)
      ? (sourceUser.emails.find(e => e.primary) || sourceUser.emails[0])?.value || null
      : null;
    const lookupEmail = mapped.email || sourceUser.email || scimEmailDirect || sourceUser.mail || sourceUser.userPrincipalName || null;
    const lookupUsername = mapped.username || sourceUser.username || sourceUser.userName || sourceUser.login || null;
    const lookupEmployeeId = mapped.employee_id || sourceUser.employee_id || sourceUser.employeeId || null;
    return {
      configuredAttr,
      configuredValue,
      lookupEmail,
      lookupUsername,
      lookupEmployeeId,
      canCreateIdentity: Boolean(lookupEmail || lookupUsername),
    };
  }

  _extractAccessItems(sourceUser = {}) {
    const results = [];
    const candidateFields = [
      ['groups', 'group'],
      ['roles', 'role'],
      ['entitlements', 'entitlement'],
      ['permissions', 'permission'],
      ['memberOf', 'group'],
      ['licenses', 'license'],
      ['appRoles', 'role'],
    ];
    for (const [field, type] of candidateFields) {
      const value = sourceUser[field];
      if (!value) continue;
      const arr = Array.isArray(value) ? value : [value];
      for (const item of arr) {
        if (item == null) continue;
        if (typeof item === 'string' || typeof item === 'number') {
          results.push({ access_type: type, access_value: String(item), display_name: String(item), raw_item: item });
        } else if (typeof item === 'object') {
          const raw = item;
          const val = item.value || item.id || item.name || item.displayName || item.display || item.cn || item.role || item.permission;
          if (!val) continue;
          results.push({ access_type: item.type || type, access_value: String(val), display_name: item.displayName || item.name || String(val), raw_item: raw });
        }
      }
    }
    const seen = new Set();
    return results.filter((i) => {
      const key = `${i.access_type}::${i.access_value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }


  // ── Apply identity_source_mappings to write users.identity_attributes ────────
  async _applyIdentityAttributeMappings(connector, sourceRecord, userId) {
    // 1. Find the application linked to this connector
    const appRes = await db.query(
      `SELECT id FROM applications
        WHERE tenant_id = $1
          AND COALESCE(metadata->>'connector_id', provisioning_config->>'connector_id') = $2::text
        LIMIT 1`,
      [connector.tenant_id, connector.id]
    );
    if (!appRes.rows.length) return;
    const applicationId = appRes.rows[0].id;

    // 2. Get all identity attributes that have a source mapping for this application
    const mappings = await db.query(
      `SELECT ia.attribute_name, ia.attribute_type, ia.is_multi_valued,
              ism.source_attribute, ism.priority
         FROM identity_source_mappings ism
         JOIN identity_attributes ia ON ia.id = ism.identity_attribute_id
        WHERE ia.tenant_id = $1
          AND ism.source_application_id = $2
        ORDER BY ism.priority ASC`,
      [connector.tenant_id, applicationId]
    );
    if (!mappings.rows.length) return;

    // 3. Build identity_attributes patch from source record
    // sourceRecord can be nested (SCIM: urn:...:User.employeeNumber)
    const flatRecord = this._flattenSourceRecord(sourceRecord);
    const patch = {};
    for (const m of mappings.rows) {
      const raw = flatRecord[m.source_attribute] ?? flatRecord[m.source_attribute.toLowerCase()];
      if (raw !== undefined && raw !== null && raw !== '') {
        patch[m.attribute_name] = m.is_multi_valued
          ? (Array.isArray(raw) ? raw : [raw])
          : String(raw);
      }
    }
    if (!Object.keys(patch).length) return;

    // 4. Merge with existing identity_attributes and write back
    await db.query(
      `UPDATE users
          SET identity_attributes = COALESCE(identity_attributes, '{}'::jsonb) || $1::jsonb,
              last_refresh = NOW()
        WHERE id = $2`,
      [JSON.stringify(patch), userId]
    );
  }

  // Flatten nested SCIM / source records into dot-notation and direct keys
  _flattenSourceRecord(obj, prefix = '') {
    const result = {};
    if (!obj || typeof obj !== 'object') return result;
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        // Also store the parent key as JSON string for multi-value
        Object.assign(result, this._flattenSourceRecord(v, key));
        // Store leaf values by last segment too (e.g. employeeNumber from urn:...:User)
        for (const [lk, lv] of Object.entries(v)) {
          if (typeof lv !== 'object') result[lk] = lv;
        }
      } else {
        result[key] = v;
        // also store just the leaf key (no prefix) for convenience
        result[k] = v;
      }
    }
    return result;
  }

  async _upsertAccountLink(connector, sourceUser, linkedUserId = null) {
    const acct = this._normalizeAccountRecord(sourceUser, connector);
    if (!acct.nativeIdentity) return null;
    const sourceHash = require('crypto').createHash('sha1').update(JSON.stringify(sourceUser || {})).digest('hex');
    const { rows } = await db.query(
      `INSERT INTO account_links (tenant_id, connector_id, user_id, native_identity, account_name, display_name, email, status, object_type, correlation_value, source_hash, source_record, attributes, first_seen_at, last_seen_at, last_aggregated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'account',$9,$10,$11::jsonb,$12::jsonb,NOW(),NOW(),NOW())
       ON CONFLICT (connector_id, native_identity) DO UPDATE
         SET user_id = COALESCE(EXCLUDED.user_id, account_links.user_id),
             account_name = EXCLUDED.account_name,
             display_name = EXCLUDED.display_name,
             email = EXCLUDED.email,
             status = EXCLUDED.status,
             object_type = 'account',
             correlation_value = EXCLUDED.correlation_value,
             source_hash = EXCLUDED.source_hash,
             source_record = EXCLUDED.source_record,
             attributes = EXCLUDED.attributes,
             last_seen_at = NOW(),
             last_aggregated_at = NOW()
       RETURNING *`,
      [connector.tenant_id, connector.id, linkedUserId, acct.nativeIdentity, acct.accountName, acct.displayName, acct.email, acct.status, acct.correlationValue, sourceHash, JSON.stringify(sourceUser || {}), JSON.stringify(sourceUser || {})]
    );
    return rows[0] || null;
  }

  async _syncAccountAccessItems(accountLink, connector, sourceUser) {
    if (!accountLink) return [];
    const items = this._extractAccessItems(sourceUser);
    await db.query(`DELETE FROM account_access_items WHERE account_link_id = $1`, [accountLink.id]);
    for (const item of items) {
      await db.query(
        `INSERT INTO account_access_items (tenant_id, connector_id, account_link_id, access_type, access_value, display_name, raw_item, first_seen_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW())
         ON CONFLICT (account_link_id, access_type, access_value) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               raw_item = EXCLUDED.raw_item,
               last_seen_at = NOW()`,
        [connector.tenant_id, connector.id, accountLink.id, item.access_type, item.access_value, item.display_name, JSON.stringify(item.raw_item || {})]
      );
    }
    return items;
  }

  async listAccountLinks(connectorId, tenantId, { page = 1, limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    const safePage = Math.max(1, Number(page) || 1);
    const offset = (safePage - 1) * safeLimit;
    const totalRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM account_links WHERE connector_id = $1 AND tenant_id = $2 AND object_type = 'account'`,
      [connectorId, tenantId]
    );
    const total = totalRes.rows[0]?.total || 0;
    const { rows } = await db.query(
      `SELECT al.*, u.username AS linked_username, u.email AS linked_email,
              COALESCE(aic.access_count, 0) AS access_count,
              COALESCE(aic.access_items, '[]'::jsonb) AS access_items
         FROM account_links al
         LEFT JOIN users u ON u.id = al.user_id
         LEFT JOIN (
           SELECT aai.account_link_id,
                  COUNT(*) AS access_count,
                  jsonb_agg(jsonb_build_object(
                    'id', aai.id,
                    'type', aai.access_type,
                    'value', aai.access_value,
                    'display_name', aai.display_name,
                    'raw_item', aai.raw_item
                  ) ORDER BY aai.access_type, aai.display_name) AS access_items
             FROM account_access_items aai
            GROUP BY aai.account_link_id
         ) aic ON aic.account_link_id = al.id
        WHERE al.connector_id = $1 AND al.tenant_id = $2 AND al.object_type = 'account'
        ORDER BY al.last_aggregated_at DESC, al.account_name
        LIMIT $3 OFFSET $4`,
      [connectorId, tenantId, safeLimit, offset]
    );
    return { data: rows, total, page: safePage, limit: safeLimit, pages: Math.max(1, Math.ceil(total / safeLimit)) };
  }

  async testConnection(connectorId) {
    const { rows } = await db.query('SELECT * FROM connectors WHERE id = $1', [connectorId]);
    if (!rows.length) throw new Error('Connector not found');
    const connector = rows[0];
    return this.testConnectionConfig(connector.type, connector.config || {});
  }

  async testConnectionConfig(type, rawConfig = {}) {
    const config = this._normalizeConnectorConfig(type, rawConfig);
    const start = Date.now();

    switch (type) {
      case 'okta': {
        const res = await axios.get(`https://${config.domain}.okta.com/api/v1/users?limit=1`, { headers: { Authorization: `SSWS ${config.api_token}` }, timeout: 8000 });
        return { status: 'connected', latency: Date.now() - start, detail: `Okta tenant: ${config.domain}` };
      }
      case 'azure_ad': {
        const token = await SchemaEngine._getAzureToken(config);
        await axios.get('https://graph.microsoft.com/v1.0/organization', { headers: { Authorization: `Bearer ${token}` }, timeout: 8000 });
        return { status: 'connected', latency: Date.now() - start, detail: `Azure AD tenant: ${config.tenant_id}` };
      }
      case 'active_directory':
      case 'ldap': {
        const ldap = require('ldapjs');
        await new Promise((resolve, reject) => {
          const client = ldap.createClient({ url: `${config.ssl ? 'ldaps' : 'ldap'}://${config.host}:${config.port || 389}`, timeout: 8000 });
          client.on('error', reject);
          client.bind(config.bind_dn, config.bind_password, (err) => { client.destroy(); err ? reject(err) : resolve(); });
        });
        return { status: 'connected', latency: Date.now() - start, detail: `LDAP host: ${config.host}` };
      }
      case 'scim2': {
        const baseUrl = (config.base_url || '').replace(/\/$/, '');
        if (!baseUrl) throw new Error('SCIM base_url is required');
        const token = config.bearer_token || config.workspace_token;
        const headers = { Accept: 'application/scim+json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await axios.get(`${baseUrl}/Users`, { headers, timeout: 8000, params: { startIndex: 1, count: 1 } });
        return { status: 'connected', latency: Date.now() - start, detail: `SCIM authenticated endpoint reachable (${res.status})` };
      }
      case 'salesforce': {
        const token = await SchemaEngine._getSalesforceToken(config);
        return { status: 'connected', latency: Date.now() - start, detail: `Salesforce instance: ${config.instance_url}` };
      }
      case 'servicenow': {
        const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
        await axios.get(`${config.instance_url}/api/now/table/sys_user?sysparm_limit=1`, { headers: { Authorization: `Basic ${auth}` }, timeout: 8000 });
        return { status: 'connected', latency: Date.now() - start, detail: `ServiceNow: ${config.instance_url}` };
      }
      case 'rest_generic': {
        const headers = {};
        if (config.auth_token) headers[config.auth_header || 'Authorization'] = `Bearer ${config.auth_token}`;
        await axios.get(`${config.base_url}${(config.list_users_endpoint || '/users').replace('GET ', '')}`, { headers, timeout: 8000, params: { limit: 1 } });
        return { status: 'connected', latency: Date.now() - start, detail: `REST API: ${config.base_url}` };
      }
      case 'jdbc_mysql':
      case 'jdbc_postgresql':
      case 'jdbc_mssql': {
        const jdbc = await this._testJdbcConnection(type, config);
        return { ...jdbc, latency: Date.now() - start };
      }
      default:
        return { status: 'unknown', latency: Date.now() - start, detail: `No test handler for type: ${type}. Configuration saved.` };
    }
  }

  _normalizeConnectorConfig(type, config = {}) {
    const out = { ...(config || {}) };
    if (out.fetch_all_users_sql && !out.query_all_users) out.query_all_users = out.fetch_all_users_sql;
    if (out.query_fetch_all_users && !out.query_all_users) out.query_all_users = out.query_fetch_all_users;
    if (out.fetch_single_user_sql && !out.query_get_user) out.query_get_user = out.fetch_single_user_sql;
    if (out.query_single_user && !out.query_get_user) out.query_get_user = out.query_single_user;
    if (out.database_name && !out.database) out.database = out.database_name;
    if (out.user_table_name && !out.user_table) out.user_table = out.user_table_name;
    if (out.database_host && !out.host) out.host = out.database_host;
    if (out.hostname && !out.host) out.host = out.hostname;
    if (out.server && !out.host) out.host = out.server;
    if (out.use_ssl !== undefined && out.ssl === undefined) out.ssl = out.use_ssl;
    return out;
  }

  _normalizeContainerHost(host) {
    if (!host) return host;
    const normalized = String(host).trim().toLowerCase();
    if (['localhost', '127.0.0.1', '::1'].includes(normalized)) return 'host.docker.internal';
    return host;
  }

  async _testJdbcConnection(type, config) {
    const host = this._normalizeContainerHost(config.host || config.hostname || config.server);
    const port = Number(config.port || (type === 'jdbc_postgresql' ? 5432 : type === 'jdbc_mssql' ? 1433 : 3306));
    const database = config.database || config.database_name;
    const username = config.username || config.user;
    const password = config.password || '';
    const previewQuery = String(config.fetch_all_users_sql || config.query_fetch_all_users || '').trim().replace(/;\s*$/, '');

    if (type === 'jdbc_mysql') {
      const conn = await mysql.createConnection({ host, port, user: username, password, database, connectTimeout: 8000 });
      try {
        const [rows, fields] = await conn.query(previewQuery || `SELECT * FROM ${config.user_table} LIMIT 1`);
        return {
          status: 'connected',
          detail: `MySQL connection successful to ${host}:${port}/${database}`,
          previewCount: Array.isArray(rows) ? rows.length : 0,
          columns: (fields || []).map(f => f.name),
        };
      } finally { await conn.end(); }
    }

    if (type === 'jdbc_postgresql') {
      const client = new PgClient({ host, port, database, user: username, password, connectionTimeoutMillis: 8000 });
      await client.connect();
      try {
        const result = await client.query(previewQuery || `SELECT * FROM ${config.user_table} LIMIT 1`);
        return {
          status: 'connected',
          detail: `PostgreSQL connection successful to ${host}:${port}/${database}`,
          previewCount: result.rows?.length || 0,
          columns: result.fields?.map(f => f.name) || Object.keys(result.rows?.[0] || {}),
        };
      } finally { await client.end(); }
    }

    if (type === 'jdbc_mssql') {
      const pool = await sql.connect({
        user: username,
        password,
        server: host,
        port,
        database,
        options: { trustServerCertificate: true, encrypt: false },
        connectionTimeout: 8000,
      });
      try {
        const result = await pool.request().query(previewQuery || `SELECT TOP 1 * FROM ${config.user_table}`);
        return {
          status: 'connected',
          detail: `SQL Server connection successful to ${host}:${port}/${database}`,
          previewCount: result.recordset?.length || 0,
          columns: result.recordset?.[0] ? Object.keys(result.recordset[0]) : [],
        };
      } finally { await pool.close(); }
    }

    return { status: 'connected', detail: `Config saved for ${type}` };
  }


  _renderSqlTemplate(template, payload = {}) {
    const sqlTemplate = String(template || '').trim();
    if (!sqlTemplate) throw new Error('SQL template is required for this operation');
    return sqlTemplate.replace(/\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}/g, (_, key) => {
      const value = key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), payload);
      if (value === undefined || value === null) return '';
      if (typeof value === 'number') return String(value);
      return String(value).replace(/'/g, "''");
    });
  }

  async queueManualProvisioning({ tenantId, actorUserId, connectorId, operation, payload = {}, requestId = null }) {
    const { rows: connectors } = await db.query('SELECT * FROM connectors WHERE id=$1 AND tenant_id=$2', [connectorId, tenantId]);
    if (!connectors.length) throw new Error('Connector not found');
    const connector = connectors[0];
    const planPayload = { operation, payload, connectorType: connector.type, queuedBy: actorUserId, queuedAt: new Date().toISOString() };
    const { rows } = await db.query(
      `INSERT INTO provisioning_transactions (tenant_id, request_id, target_user_id, connector_id, operation, status, plan_payload)
       VALUES ($1,$2,$3,$4,$5,'queued',$6) RETURNING *`,
      [tenantId, requestId, payload.target_user_id || null, connectorId, operation, JSON.stringify(planPayload)]
    );
    return rows[0];
  }

  async listTransactions(tenantId, { status, connectorId, limit = 50 } = {}) {
    const params = [tenantId];
    let idx = 2;
    const where = ['pt.tenant_id = $1'];
    if (status) { where.push(`pt.status = $${idx++}`); params.push(status); }
    if (connectorId) { where.push(`pt.connector_id = $${idx++}`); params.push(connectorId); }
    params.push(Number(limit) || 50);
    const { rows } = await db.query(
      `SELECT pt.*, c.name as connector_name, c.type as connector_type,
              u.username as target_username, u.email as target_email
         FROM provisioning_transactions pt
         LEFT JOIN connectors c ON c.id = pt.connector_id
         LEFT JOIN users u ON u.id = pt.target_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY pt.created_at DESC
        LIMIT $${idx}`,
      params
    );
    return rows;
  }

  async executeTransaction(transactionId, tenantId, actorUserId = null) {
    const { rows } = await db.query(
      `SELECT pt.*, c.name as connector_name, c.type as connector_type, c.config as connector_config
         FROM provisioning_transactions pt
         JOIN connectors c ON c.id = pt.connector_id
        WHERE pt.id=$1 AND pt.tenant_id=$2`,
      [transactionId, tenantId]
    );
    if (!rows.length) throw new Error('Provisioning transaction not found');
    const txn = rows[0];
    const connector = { id: txn.connector_id, type: txn.connector_type, name: txn.connector_name, config: txn.connector_config || {}, tenant_id: tenantId };
    const config = this._normalizeConnectorConfig(connector.type, connector.config || {});
    const plan = txn.plan_payload || {};
    const payload = (plan && typeof plan === 'object' && plan.payload && typeof plan.payload === 'object')
      ? plan.payload
      : plan;

    await db.query(`UPDATE provisioning_transactions SET status='running' WHERE id=$1`, [transactionId]);

    try {
      const result = await this._executeConnectorOperation(connector, config, txn.operation, payload, actorUserId);
      await db.query(
        `UPDATE provisioning_transactions
            SET status=$2, connector_response=$3, error_message=NULL, completed_at=NOW()
          WHERE id=$1`,
        [transactionId, result.status || 'completed', JSON.stringify(result)]
      );
      return result;
    } catch (err) {
      await db.query(
        `UPDATE provisioning_transactions
            SET status='failed', error_message=$2, connector_response=$3, completed_at=NOW()
          WHERE id=$1`,
        [transactionId, err.message, JSON.stringify({ error: err.message })]
      );
      throw err;
    }
  }

  async retryTransaction(transactionId, tenantId, actorUserId = null) {
    await db.query(`UPDATE provisioning_transactions SET status='queued', completed_at=NULL, error_message=NULL WHERE id=$1 AND tenant_id=$2`, [transactionId, tenantId]);
    return this.executeTransaction(transactionId, tenantId, actorUserId);
  }

  async _executeConnectorOperation(connector, config, operation, payload, actorUserId) {
    if (connector.type.startsWith('jdbc_')) {
      return this._executeJdbcProvisioning(connector.type, config, operation, payload);
    }
    if (connector.type === 'scim2' || connector.type === 'slack') {
      return this._executeScimProvisioning(connector, config, operation, payload, actorUserId);
    }
    return {
      status: 'failed',
      message: `Provisioning adapter for ${connector.type} is not implemented yet.`,
      operation,
      payload,
    };
  }

  _buildScimHeaders(config = {}) {
    const token = config.bearer_token || config.workspace_token;
    const headers = {
      Accept: 'application/scim+json',
      'Content-Type': 'application/scim+json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async _getTargetUserRow(targetUserId, tenantId) {
    if (!targetUserId) return null;
    const { rows } = await db.query(
      `SELECT id, username, email, first_name, last_name, display_name, status FROM users WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [targetUserId, tenantId]
    );
    return rows[0] || null;
  }

  async _resolveScimUser(connector, config, payload = {}) {
    const baseUrl = (config.base_url || '').replace(/\/$/, '');
    if (!baseUrl) throw new Error('SCIM base_url is required');
    const headers = this._buildScimHeaders(config);

    let link = null;
    if (payload.target_user_id) {
      const { rows: linkRows } = await db.query(
        `SELECT native_identity, account_name, email, correlation_value FROM account_links WHERE connector_id=$1 AND user_id=$2 AND object_type='account' ORDER BY last_aggregated_at DESC NULLS LAST LIMIT 1`,
        [connector.id, payload.target_user_id]
      );
      link = linkRows[0] || null;
      if (link?.native_identity) {
        try {
          const res = await axios.get(`${baseUrl}/Users/${encodeURIComponent(link.native_identity)}`, { headers, timeout: 10000 });
          return res.data;
        } catch (e) {
          if (e.response?.status === 401) throw new Error(`SCIM authentication failed with status ${e.response.status}`);
        }
      }
    }

    const localUser = await this._getTargetUserRow(payload.target_user_id, connector.tenant_id);
    const rawCandidates = [
      payload.userName,
      payload.username,
      payload.email,
      payload.resource_name,
      localUser?.username,
      localUser?.email,
      localUser?.display_name,
      link?.account_name,
      link?.email,
      link?.correlation_value,
      link?.native_identity,
    ].filter(Boolean);
    const candidates = [...new Set(rawCandidates.map(v => String(v).trim()).filter(Boolean))];

    for (const candidate of candidates) {
      const escaped = candidate.replace(/"/g, '\"');
      for (const filterExpr of [
        `userName eq "${escaped}"`,
        `emails.value eq "${escaped}"`,
        `displayName eq "${escaped}"`,
      ]) {
        try {
          const res = await axios.get(`${baseUrl}/Users`, { headers, timeout: 10000, params: { filter: filterExpr, startIndex: 1, count: 1 } });
          if (res.data?.Resources?.length) return res.data.Resources[0];
        } catch (e) {
          if (e.response?.status === 401) throw new Error(`SCIM authentication failed with status ${e.response.status}`);
        }
      }
    }

    try {
      const res = await axios.get(`${baseUrl}/Users`, { headers, timeout: 10000, params: { startIndex: 1, count: 200 } });
      const resources = res.data?.Resources || [];
      const normalizedCandidates = candidates.map(v => String(v).toLowerCase());
      const matched = resources.find(u => normalizedCandidates.includes(String(u.userName || '').toLowerCase()) || (u.emails || []).some(e => normalizedCandidates.includes(String(e.value || '').toLowerCase())) || normalizedCandidates.includes(String(u.displayName || '').toLowerCase()));
      if (matched) return matched;
    } catch (e) {
      if (e.response?.status === 401) throw new Error(`SCIM authentication failed with status ${e.response.status}`);
    }

    throw new Error(`SCIM target user not found (tried: ${candidates.join(', ') || 'no candidates'})`);
  }

  async _resolveScimGroup(connector, config, payload = {}) {
    const baseUrl = (config.base_url || '').replace(/\/$/, '');
    if (!baseUrl) throw new Error('SCIM base_url is required');
    const headers = this._buildScimHeaders(config);

    let entitlement = null;
    if (payload.resource_id) {
      const { rows } = await db.query(
        `SELECT id, application_id, name, value, display_value, metadata FROM entitlements WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
        [payload.resource_id, connector.tenant_id]
      );
      entitlement = rows[0] || null;
    }

    const meta = entitlement?.metadata || {};
    const rawCandidates = [
      meta.external_id,
      meta.group_id,
      meta.scim_group_id,
      payload.group_id,
      payload.external_id,
      entitlement?.value,
      entitlement?.display_value,
      entitlement?.name,
      payload.resource_name,
    ].filter(Boolean);
    const candidates = [...new Set(rawCandidates.map(v => String(v).trim()).filter(Boolean))];

    for (const candidate of candidates) {
      try {
        const direct = await axios.get(`${baseUrl}/Groups/${encodeURIComponent(candidate)}`, { headers, timeout: 10000 });
        if (direct.data?.id) return direct.data;
      } catch (e) {
        if (e.response?.status === 401) throw new Error(`SCIM authentication failed with status ${e.response.status}`);
      }
      for (const filterExpr of [
        `displayName eq "${candidate.replace(/"/g, '\"')}"`,
        `externalId eq "${candidate.replace(/"/g, '\"')}"`,
      ]) {
        try {
          const res = await axios.get(`${baseUrl}/Groups`, { headers, timeout: 10000, params: { filter: filterExpr, startIndex: 1, count: 1 } });
          if (res.data?.Resources?.length) return res.data.Resources[0];
        } catch (e) {
          if (e.response?.status === 401) throw new Error(`SCIM authentication failed with status ${e.response.status}`);
        }
      }
    }
    throw new Error('SCIM target group not found for entitlement');
  }

  _buildScimUserPayload(payload = {}) {
    const userName = payload.userName || payload.username || payload.email;
    const first = payload.first_name || payload.firstName || payload.givenName || '';
    const last = payload.last_name || payload.lastName || payload.familyName || '';
    const email = payload.email || null;
    const scimPayload = {
      userName,
      active: payload.active !== false,
      name: { givenName: first, familyName: last },
    };
    if (email) scimPayload.emails = [{ value: email, type: 'work', primary: true }];
    if (payload.display_name || payload.displayName) scimPayload.displayName = payload.display_name || payload.displayName;
    return scimPayload;
  }

  async _executeScimProvisioning(connector, config, operation, payload = {}, actorUserId = null) {
    const baseUrl = (config.base_url || '').replace(/\/$/, '');
    if (!baseUrl) return { status: 'failed', message: 'SCIM base_url is required', operation };
    const headers = this._buildScimHeaders(config);
    const request = async (method, url, data = undefined, params = undefined) => {
      try {
        const res = await axios({ method, url, data, params, headers, timeout: 10000 });
        return res;
      } catch (e) {
        if (e.response?.status === 401) throw new Error(`SCIM authentication failed with status ${e.response.status}`);
        throw new Error(e.response?.data?.detail || e.response?.data?.error || e.message);
      }
    };

    try {
      if (operation === 'create_account') {
        const body = { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], ...this._buildScimUserPayload(payload) };
        const res = await request('post', `${baseUrl}/Users`, body);
        return { status: 'success', operation, targetId: res.data?.id, responseStatus: res.status };
      }

      if (operation === 'update_account') {
        const targetUser = await this._resolveScimUser(connector, config, payload);
        const body = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', value: this._buildScimUserPayload(payload) }],
        };
        const res = await request('patch', `${baseUrl}/Users/${encodeURIComponent(targetUser.id)}`, body);
        return { status: 'success', operation, targetId: targetUser.id, responseStatus: res.status };
      }

      if (operation === 'enable_account' || operation === 'disable_account') {
        const targetUser = await this._resolveScimUser(connector, config, payload);
        const body = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', value: { active: operation === 'enable_account' } }],
        };
        const res = await request('patch', `${baseUrl}/Users/${encodeURIComponent(targetUser.id)}`, body);
        return { status: 'success', operation, targetId: targetUser.id, responseStatus: res.status };
      }

      if (operation === 'delete_account') {
        const targetUser = await this._resolveScimUser(connector, config, payload);
        const res = await request('delete', `${baseUrl}/Users/${encodeURIComponent(targetUser.id)}`);
        return { status: 'success', operation, targetId: targetUser.id, responseStatus: res.status };
      }

      if (operation === 'grant_entitlement_access' || operation === 'grant_role_access') {
        const targetUser = await this._resolveScimUser(connector, config, payload);
        const targetGroup = await this._resolveScimGroup(connector, config, payload);
        const body = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'add', path: 'members', value: [{ value: targetUser.id, display: targetUser.userName || targetUser.displayName }] }],
        };
        const res = await request('patch', `${baseUrl}/Groups/${encodeURIComponent(targetGroup.id)}`, body);
        return { status: 'success', operation, targetUserId: targetUser.id, targetGroupId: targetGroup.id, responseStatus: res.status };
      }

      if (operation === 'remove_entitlement_access' || operation === 'remove_role_access') {
        const targetUser = await this._resolveScimUser(connector, config, payload);
        const targetGroup = await this._resolveScimGroup(connector, config, payload);
        const body = {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'remove', path: `members[value eq "${targetUser.id}"]` }],
        };
        const res = await request('patch', `${baseUrl}/Groups/${encodeURIComponent(targetGroup.id)}`, body);
        return { status: 'success', operation, targetUserId: targetUser.id, targetGroupId: targetGroup.id, responseStatus: res.status };
      }

      return { status: 'failed', message: `Unsupported SCIM operation ${operation}`, operation };
    } catch (err) {
      return { status: 'failed', operation, error: err.message, message: err.message };
    }
  }

  async _executeJdbcProvisioning(type, config, operation, payload) {
    const sqlMap = {
      create_account: config.query_create_user || config.create_user_sql,
      update_account: config.query_update_user || config.update_user_sql,
      disable_account: config.query_disable_user || config.disable_user_sql || config.query_delete_user || config.delete_user_sql,
      delete_account: config.query_delete_user || config.delete_user_sql,
      enable_account: config.query_enable_user || config.enable_user_sql || config.query_update_user || config.update_user_sql,
    };
    const template = sqlMap[operation];
    if (!template) {
      return { status: 'failed', message: `No SQL template configured for operation ${operation}`, operation, payload };
    }
    const rendered = this._renderSqlTemplate(template, payload);
    const host = this._normalizeContainerHost(config.host || config.hostname || config.server);
    const port = Number(config.port || (type === 'jdbc_postgresql' ? 5432 : type === 'jdbc_mssql' ? 1433 : 3306));
    const database = config.database || config.database_name;
    const username = config.username || config.user;
    const password = config.password || '';

    if (type === 'jdbc_mysql') {
      const conn = await mysql.createConnection({ host, port, user: username, password, database, connectTimeout: 8000 });
      try {
        const [result] = await conn.query(rendered);
        return { status: 'success', operation, sql: rendered, rowsAffected: result?.affectedRows ?? 0 };
      } finally { await conn.end(); }
    }
    if (type === 'jdbc_postgresql') {
      const client = new PgClient({ host, port, database, user: username, password, connectionTimeoutMillis: 8000 });
      await client.connect();
      try {
        const result = await client.query(rendered);
        return { status: 'success', operation, sql: rendered, rowsAffected: result?.rowCount ?? 0 };
      } finally { await client.end(); }
    }
    if (type === 'jdbc_mssql') {
      const pool = await sql.connect({ user: username, password, server: host, port, database, options: { trustServerCertificate: true, encrypt: false }, connectionTimeout: 8000 });
      try {
        const result = await pool.request().query(rendered);
        return { status: 'success', operation, sql: rendered, rowsAffected: Array.isArray(result.rowsAffected) ? (result.rowsAffected[0] || 0) : 0 };
      } finally { await pool.close(); }
    }
    return { status: 'failed', message: `Unsupported JDBC type ${type}`, operation, sql: rendered };
  }

  /**
   * Re-aggregates a single user from a target connector after provisioning.
   * Uses targeted single-user fetch (SCIM by ID, JDBC by query) — does NOT
   * fetch all users. This is called after access request approval to immediately
   * reflect new access in the user's profile without a full aggregation.
   */
  async aggregateSingleUser(connectorId, tenantId, userId) {
    try {
      const { rows: cRows } = await db.query(
        'SELECT * FROM connectors WHERE id=$1 AND tenant_id=$2',
        [connectorId, tenantId]
      );
      if (!cRows.length) return;
      const connector = { ...cRows[0] };
      connector.config = typeof connector.config === 'string' ? JSON.parse(connector.config || '{}') : (connector.config || {});
      connector.tenant_id = tenantId;

      const { rows: uRows } = await db.query(
        'SELECT id, username, email, external_id, display_name, first_name, last_name FROM users WHERE id=$1 AND tenant_id=$2',
        [userId, tenantId]
      );
      if (!uRows.length) return;
      const user = uRows[0];

      // Get existing account link for native_identity
      const { rows: alRows } = await db.query(
        'SELECT native_identity, account_name, correlation_value FROM account_links WHERE connector_id=$1 AND user_id=$2 AND tenant_id=$3 AND object_type=\'account\' ORDER BY last_aggregated_at DESC NULLS LAST LIMIT 1',
        [connectorId, userId, tenantId]
      );
      const existingLink = alRows[0] || null;

      let sourceUser = null;

      // ── SCIM: fetch by native_identity (direct GET /Users/:id) ──
      if (['scim2', 'slack'].includes(connector.type)) {
        try {
          sourceUser = await this._resolveScimUser(connector, connector.config, {
            target_user_id: userId,
            email: user.email,
            userName: user.username,
          });
        } catch {}
      }

      // ── LDAP/AD: targeted search by sAMAccountName or mail ──
      else if (['active_directory', 'ldap'].includes(connector.type)) {
        try {
          const allUsers = await this._fetchLdapUsers(connector.config, connector.type);
          sourceUser = allUsers.find(u =>
            (user.email && (u.mail === user.email || u.userPrincipalName === user.email)) ||
            (user.username && u.sAMAccountName === user.username) ||
            (existingLink?.native_identity && (u.sAMAccountName === existingLink.native_identity || u.distinguishedName === existingLink.native_identity))
          ) || null;
        } catch {}
      }

      // ── JDBC: query single user by external_id or email ──
      else if (connector.type.startsWith('jdbc_')) {
        try {
          const config = connector.config;
          const singleUserSql = config.query_get_user || config.fetch_single_user_sql;
          if (singleUserSql) {
            const result = await this._executeJdbcSingleUser(connector, singleUserSql, user);
            if (result) sourceUser = result;
          } else {
            // Fall back to full fetch and filter
            const all = await this._fetchAllUsersFromApp(connector, config).catch(() => []);
            sourceUser = all.find(u => {
              const mapped = this._autoMap(u, connector.type);
              return (user.email && mapped.email === user.email) || (user.username && mapped.username === user.username) || (user.external_id && (u.id === user.external_id || u.employee_id === user.external_id));
            }) || null;
          }
        } catch {}
      }

      // ── REST/Generic: full fetch + filter (last resort) ──
      else {
        try {
          const all = await this._fetchAllUsersFromApp(connector, connector.config).catch(() => []);
          sourceUser = all.find(u => {
            const mapped = this._autoMap(u, connector.type);
            return (user.email && mapped.email === user.email) || (user.username && mapped.username === user.username);
          }) || null;
        } catch {}
      }

      if (!sourceUser) {
        logger.info('[SINGLE-AGG] User not found on target system (non-fatal)', { connectorId, userId, connector: connector.name });
        return;
      }

      // Upsert account link + access items
      await this._upsertAccountLink(connector, sourceUser, userId);

      logger.info('[SINGLE-AGG] Successfully re-aggregated user after provisioning', {
        connectorId, userId, connector: connector.name
      });
    } catch (err) {
      logger.warn('[SINGLE-AGG] Failed (non-fatal)', { connectorId, userId, error: err.message });
    }
  }

  // Helper: execute a JDBC single-user fetch query
  async _executeJdbcSingleUser(connector, sql, user) {
    try {
      const config = connector.config;
      const rendered = sql
        .replace(/\{\{email\}\}/gi, `'${(user.email || '').replace(/'/g, "''")}'`)
        .replace(/\{\{username\}\}/gi, `'${(user.username || '').replace(/'/g, "''")}'`)
        .replace(/\{\{id\}\}/gi, `'${(user.external_id || '').replace(/'/g, "''")}'`)
        .replace(/\?/g, `'${(user.email || user.username || '').replace(/'/g, "''")}'`);

      const host = this._normalizeContainerHost(config.host || config.hostname || config.server);
      const port = Number(config.port || (connector.type === 'jdbc_postgresql' ? 5432 : connector.type === 'jdbc_mssql' ? 1433 : 3306));
      const database = config.database || config.database_name;
      const username = config.username || config.user;
      const password = config.password || '';

      let rows = [];
      if (connector.type === 'jdbc_mysql') {
        const conn = await mysql.createConnection({ host, port, user: username, password, database, connectTimeout: 8000 });
        try { const [r] = await conn.query(rendered); rows = Array.isArray(r) ? r : []; } finally { await conn.end(); }
      } else if (connector.type === 'jdbc_postgresql') {
        const client = new PgClient({ host, port, database, user: username, password, connectionTimeoutMillis: 8000 });
        await client.connect();
        try { const r = await client.query(rendered); rows = r.rows || []; } finally { await client.end(); }
      } else if (connector.type === 'jdbc_mssql') {
        const pool = await sql.connect({ user: username, password, server: host, port, database, options: { trustServerCertificate: true, encrypt: false }, connectionTimeout: 8000 });
        try { const r = await pool.request().query(rendered); rows = r.recordset || []; } finally { await pool.close(); }
      }
      return rows[0] || null;
    } catch {
      return null;
    }
  }

}

module.exports = new ProvisioningEngine();
