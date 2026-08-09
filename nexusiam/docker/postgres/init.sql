-- NexusIAM Database Initialization
-- Complete schema for all IAM features

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Tenants (Multi-tenant support) ──────────────────────────────────────────
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  plan VARCHAR(50) DEFAULT 'starter' CHECK (plan IN ('starter','professional','enterprise')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','suspended','trial')),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Organizations ────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES organizations(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  username VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  display_name VARCHAR(200),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','locked','pending')),
  employee_id VARCHAR(100),
  department VARCHAR(200),
  title VARCHAR(200),
  manager_id UUID REFERENCES users(id),
  phone VARCHAR(50),
  location VARCHAR(200),
  mfa_enabled BOOLEAN DEFAULT false,
  mfa_secret VARCHAR(100),
  mfa_backup_codes TEXT[],
  last_login TIMESTAMPTZ,
  password_expires_at TIMESTAMPTZ,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  source VARCHAR(50) DEFAULT 'local' CHECK (source IN ('local','ldap','saml','oidc','scim','jdbc','api')),
  external_id VARCHAR(255),
  attributes JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, username),
  UNIQUE(tenant_id, email)
);

-- ─── Roles ────────────────────────────────────────────────────────────────────
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  type VARCHAR(30) DEFAULT 'business' CHECK (type IN ('system','business','it','birthright')),
  risk_level INTEGER DEFAULT 1 CHECK (risk_level BETWEEN 1 AND 5),
  owner_id UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

-- ─── Entitlements / Permissions ───────────────────────────────────────────────
CREATE TABLE entitlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  application_id UUID,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  type VARCHAR(50) DEFAULT 'permission',
  value VARCHAR(500),
  risk_level INTEGER DEFAULT 1 CHECK (risk_level BETWEEN 1 AND 5),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Role-Entitlement Mapping ─────────────────────────────────────────────────
CREATE TABLE role_entitlements (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  entitlement_id UUID REFERENCES entitlements(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  PRIMARY KEY (role_id, entitlement_id)
);

-- ─── User-Role Assignments ────────────────────────────────────────────────────
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  justification TEXT,
  ticket_ref VARCHAR(100),
  UNIQUE(user_id, role_id)
);

-- ─── Applications ─────────────────────────────────────────────────────────────
CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  type VARCHAR(50) CHECK (type IN ('web','api','mobile','desktop','saas','legacy')),
  sso_enabled BOOLEAN DEFAULT false,
  sso_protocol VARCHAR(20) CHECK (sso_protocol IN ('saml','oidc','oauth2','ldap','cas')),
  sso_config JSONB DEFAULT '{}',
  provisioning_enabled BOOLEAN DEFAULT false,
  provisioning_type VARCHAR(30) CHECK (provisioning_type IN ('scim','api','manual','connector')),
  provisioning_config JSONB DEFAULT '{}',
  owner_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'active',
  logo_url VARCHAR(500),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Access Requests ──────────────────────────────────────────────────────────
CREATE TABLE access_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_number VARCHAR(50) UNIQUE NOT NULL,
  requester_id UUID REFERENCES users(id),
  target_user_id UUID REFERENCES users(id),
  request_type VARCHAR(50) CHECK (request_type IN ('role_grant','role_revoke','entitlement_grant','access_review','exception')),
  resource_type VARCHAR(50),
  resource_id UUID,
  status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','expired')),
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  justification TEXT NOT NULL,
  business_justification TEXT,
  duration_days INTEGER,
  expires_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  resolution_notes TEXT,
  cab_required BOOLEAN DEFAULT false,
  cab_case_id UUID,
  metadata JSONB DEFAULT '{}'
);

-- ─── Approval Workflows ───────────────────────────────────────────────────────
CREATE TABLE approval_workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  trigger_conditions JSONB DEFAULT '{}',
  steps JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Approval Steps (for each request) ───────────────────────────────────────
CREATE TABLE approval_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID REFERENCES access_requests(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  approver_id UUID REFERENCES users(id),
  approver_type VARCHAR(30) CHECK (approver_type IN ('user','role_owner','manager','group')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','skipped')),
  acted_at TIMESTAMPTZ,
  comments TEXT,
  due_date TIMESTAMPTZ
);

-- ─── CAB Cases ───────────────────────────────────────────────────────────────
CREATE TABLE cab_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  case_number VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  type VARCHAR(50) CHECK (type IN ('change','emergency_change','standard_change','major_change')),
  risk_level VARCHAR(20) CHECK (risk_level IN ('low','medium','high','critical')),
  status VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','approved','rejected','implemented','closed')),
  requester_id UUID REFERENCES users(id),
  assignee_id UUID REFERENCES users(id),
  planned_start TIMESTAMPTZ,
  planned_end TIMESTAMPTZ,
  implementation_plan TEXT,
  rollback_plan TEXT,
  impact_assessment TEXT,
  approvals JSONB DEFAULT '[]',
  related_requests UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Certifications / Access Reviews ─────────────────────────────────────────
CREATE TABLE certifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(300) NOT NULL,
  description TEXT,
  type VARCHAR(50) CHECK (type IN ('user_access','role_composition','entitlement','manager_review','application_access')),
  status VARCHAR(30) DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled')),
  scope_config JSONB DEFAULT '{}',
  due_date DATE NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ─── Certification Items ──────────────────────────────────────────────────────
CREATE TABLE certification_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  certification_id UUID REFERENCES certifications(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES users(id),
  subject_user_id UUID REFERENCES users(id),
  resource_type VARCHAR(50),
  resource_id UUID,
  resource_name VARCHAR(300),
  decision VARCHAR(20) CHECK (decision IN ('certify','revoke','exception','pending')),
  decision_reason TEXT,
  decided_at TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  risk_score INTEGER
);

-- ─── Policies ─────────────────────────────────────────────────────────────────
CREATE TABLE policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(300) NOT NULL,
  description TEXT,
  type VARCHAR(50) CHECK (type IN ('sod','password','mfa','session','access','data')),
  rules JSONB NOT NULL DEFAULT '[]',
  enforcement VARCHAR(20) DEFAULT 'enforce' CHECK (enforcement IN ('enforce','detect','report')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Policy Violations ────────────────────────────────────────────────────────
CREATE TABLE policy_violations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  policy_id UUID REFERENCES policies(id),
  user_id UUID REFERENCES users(id),
  violation_type VARCHAR(100),
  details JSONB DEFAULT '{}',
  severity VARCHAR(20) CHECK (severity IN ('low','medium','high','critical')),
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','mitigated','accepted','resolved')),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- ─── Connectors (for provisioning) ───────────────────────────────────────────
CREATE TABLE connectors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(100) NOT NULL,
  config JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'disconnected',
  last_sync TIMESTAMPTZ,
  sync_schedule VARCHAR(100),
  custom_jar_path VARCHAR(500),
  custom_class VARCHAR(300),
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);



-- ─── Aggregated Accounts / Account Links ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connectors(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  native_identity VARCHAR(255) NOT NULL,
  account_name VARCHAR(255),
  display_name VARCHAR(255),
  email VARCHAR(255),
  status VARCHAR(50),
  object_type VARCHAR(50) NOT NULL DEFAULT 'account',   -- 'account' | 'group'
  correlation_value VARCHAR(255),
  source_hash VARCHAR(128),
  source_record JSONB DEFAULT '{}',
  attributes JSONB DEFAULT '{}',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_aggregated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connector_id, native_identity)
);

CREATE INDEX IF NOT EXISTS idx_account_links_connector_id ON account_links(connector_id);
CREATE INDEX IF NOT EXISTS idx_account_links_user_id ON account_links(user_id);
CREATE INDEX IF NOT EXISTS idx_account_links_tenant_id ON account_links(tenant_id);


-- ─── Account Access / Entitlements discovered during aggregation ─────────────
CREATE TABLE IF NOT EXISTS account_access_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connectors(id) ON DELETE CASCADE,
  account_link_id UUID REFERENCES account_links(id) ON DELETE CASCADE,
  access_type VARCHAR(100) NOT NULL,
  access_value VARCHAR(500) NOT NULL,
  display_name VARCHAR(500),
  raw_item JSONB DEFAULT '{}',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_link_id, access_type, access_value)
);

CREATE INDEX IF NOT EXISTS idx_account_access_items_account_link_id ON account_access_items(account_link_id);
CREATE INDEX IF NOT EXISTS idx_account_access_items_connector_id ON account_access_items(connector_id);

-- ─── Audit Logs ───────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  session_id VARCHAR(100),
  action VARCHAR(200) NOT NULL,
  resource_type VARCHAR(100),
  resource_id VARCHAR(200),
  old_value JSONB,
  new_value JSONB,
  ip_address INET,
  user_agent TEXT,
  geolocation JSONB,
  status VARCHAR(20) DEFAULT 'success',
  error_message TEXT,
  correlation_id VARCHAR(100),
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Custom Loggers (customer-defined) ───────────────────────────────────────
CREATE TABLE custom_loggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  logger_class VARCHAR(500),
  log_level VARCHAR(20) DEFAULT 'INFO' CHECK (log_level IN ('DEBUG','INFO','WARN','ERROR')),
  config JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Plugins / Extensions ─────────────────────────────────────────────────────
CREATE TABLE plugins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  version VARCHAR(50),
  type VARCHAR(50) CHECK (type IN ('connector','workflow','validator','transformer','notifier','reporter')),
  file_path VARCHAR(500),
  entry_class VARCHAR(500),
  config JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'disabled' CHECK (status IN ('active','disabled','error')),
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  last_executed TIMESTAMPTZ
);

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  type VARCHAR(100),
  title VARCHAR(300),
  message TEXT,
  link VARCHAR(500),
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SCIM Tokens ──────────────────────────────────────────────────────────────
CREATE TABLE scim_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  application_id UUID REFERENCES applications(id),
  token_hash VARCHAR(255) NOT NULL,
  description VARCHAR(300),
  expires_at TIMESTAMPTZ,
  last_used TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_access_requests_tenant ON access_requests(tenant_id);
CREATE INDEX idx_access_requests_status ON access_requests(status);
CREATE INDEX idx_certification_items_cert ON certification_items(certification_id);
CREATE INDEX idx_policy_violations_tenant ON policy_violations(tenant_id);

-- ─── Seed Data ────────────────────────────────────────────────────────────────
INSERT INTO tenants (id, name, slug, plan, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'NexusIAM Demo Org', 'demo', 'enterprise', 'active');

INSERT INTO organizations (id, tenant_id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Root Organization', 'Top level organization');

INSERT INTO users (id, tenant_id, org_id, username, email, password_hash, first_name, last_name, status) VALUES
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010',
   'admin', 'admin@nexusiam.io', crypt('Admin@2024!', gen_salt('bf')), 'System', 'Admin', 'active');

INSERT INTO roles (id, tenant_id, name, description, type, risk_level) VALUES
  ('00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000001', 'Super Admin', 'Full platform access', 'system', 5),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', 'IAM Admin', 'Identity administration', 'system', 4),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001', 'Help Desk', 'Basic user management', 'business', 2),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000001', 'Auditor', 'Read-only audit access', 'business', 1);

INSERT INTO user_roles (user_id, role_id, tenant_id, assigned_by) VALUES
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000100');

INSERT INTO policies (tenant_id, name, type, rules, enforcement) VALUES
  ('00000000-0000-0000-0000-000000000001', 'SoD: Finance-Approver', 'sod', '[{"role_a":"Finance Maker","role_b":"Finance Checker","conflict":"cannot_coexist"}]', 'enforce'),
  ('00000000-0000-0000-0000-000000000001', 'MFA Required for Privileged', 'mfa', '[{"condition":"risk_level >= 4","require_mfa":true}]', 'enforce'),
  ('00000000-0000-0000-0000-000000000001', 'Password Policy', 'password', '[{"min_length":12,"complexity":true,"history":10,"max_age_days":90}]', 'enforce');

COMMIT;

-- ─── Connector Schema Extension (for Schema Engine + Provisioning) ─────────

-- Discovered / cached schema per connector
CREATE TABLE IF NOT EXISTS connector_schemas (
  connector_id    UUID REFERENCES connectors(id) ON DELETE CASCADE,
  object_type     VARCHAR(50) NOT NULL DEFAULT 'account',   -- 'account' | 'group' | 'entitlement'
  schema_definition JSONB NOT NULL DEFAULT '[]',
  discovered_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (connector_id, object_type)
);

-- Customer-defined custom attributes on top of native schema
CREATE TABLE IF NOT EXISTS schema_custom_attributes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id    UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  attribute_name  VARCHAR(255) NOT NULL,
  attribute_type  VARCHAR(50) NOT NULL DEFAULT 'string', -- string, number, boolean, date, datetime, multi_string, object
  description     TEXT,
  is_required     BOOLEAN DEFAULT FALSE,
  default_value   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connector_id, attribute_name)
);

-- Attribute mapping rules between NexusIAM canonical schema and app schema
CREATE TABLE IF NOT EXISTS attribute_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id        UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  source_attr         VARCHAR(512) NOT NULL,   -- NexusIAM field (push) or App field (pull)
  target_attr         VARCHAR(512) NOT NULL,   -- App field (push) or NexusIAM field (pull)
  transformer_type    VARCHAR(100) NOT NULL DEFAULT 'direct',
  transformer_config  JSONB DEFAULT '{}',
  direction           VARCHAR(20) NOT NULL DEFAULT 'both',  -- push | pull | both
  is_required         BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Sync job history
CREATE TABLE IF NOT EXISTS sync_jobs (
  id                  VARCHAR(64) PRIMARY KEY,
  connector_id        UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  direction           VARCHAR(20) NOT NULL DEFAULT 'pull',
  status              VARCHAR(20) NOT NULL DEFAULT 'running', -- running | completed | failed
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  records_processed   INTEGER DEFAULT 0,
  result              JSONB,
  error_message       TEXT
);

-- Add provisioning_direction + description to connectors if not present
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS provisioning_direction VARCHAR(20) DEFAULT 'bidirectional';
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- Add external_id + attributes to users if not present
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_id VARCHAR(512);
ALTER TABLE users ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(10) DEFAULT 'dark';
ALTER TABLE users ADD COLUMN IF NOT EXISTS source VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(255);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attr_mappings_connector ON attribute_mappings(connector_id);
CREATE INDEX IF NOT EXISTS idx_custom_attrs_connector ON schema_custom_attributes(connector_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_connector ON sync_jobs(connector_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id) WHERE external_id IS NOT NULL;

-- ─── Scheduler Support Columns ────────────────────────────────────────────────
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS last_reminder_sent TIMESTAMPTZ;
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS resource_name VARCHAR(255);
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS expiry_warning_sent TIMESTAMPTZ;

-- ─── Role Inheritance (Birthright/Business → IT roles) ────────────────────────
CREATE TABLE IF NOT EXISTS role_inheritance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  child_role_id  UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (parent_role_id, child_role_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_role_inheritance_parent
  ON role_inheritance(parent_role_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_role_inheritance_child
  ON role_inheritance(child_role_id, tenant_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pwd_warning_sent TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(255);
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ;
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE certification_items ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES users(id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLEAU / BI DIRECT CONNECT SETUP
-- These views are pre-joined, analysis-ready, and safe for read-only BI access.
-- Connect Tableau to: postgresql://nexusiam_bi:<password>@<host>:5432/nexusiam
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── View 1: vw_user_access_flat ──────────────────────────────────────────────
-- One row per user-role assignment. Primary Tableau dimension table.
CREATE OR REPLACE VIEW vw_user_access_flat AS
SELECT
  t.slug AS tenant,
  u.username, u.email, u.first_name, u.last_name,
  u.department, u.title, u.status AS user_status,
  u.employee_id, u.source, u.last_login,
  u.mfa_enabled, u.created_at AS user_created_at,
  r.name AS role_name, r.type AS role_type, r.description AS role_description,
  ur.status AS assignment_status,
  ur.assigned_at, ur.expires_at,
  CASE WHEN ur.expires_at IS NULL THEN 'permanent' ELSE 'temporary' END AS access_type,
  CASE WHEN ur.expires_at < NOW() THEN true ELSE false END AS is_expired,
  assigned_by.username AS assigned_by
FROM user_roles ur
JOIN users u ON u.id = ur.user_id
JOIN roles r ON r.id = ur.role_id
JOIN tenants t ON t.id = ur.tenant_id
LEFT JOIN users assigned_by ON assigned_by.id = ur.assigned_by
WHERE ur.status = 'active';

-- ─── View 2: vw_access_requests_analytics ─────────────────────────────────────
-- Flattened access requests with resolution SLA metrics.
CREATE OR REPLACE VIEW vw_access_requests_analytics AS
SELECT
  t.slug AS tenant,
  ar.ticket_number, ar.status, ar.priority, ar.request_type,
  ar.requested_at, ar.resolved_at,
  DATE_TRUNC('day', ar.requested_at) AS request_date,
  DATE_TRUNC('week', ar.requested_at) AS request_week,
  DATE_TRUNC('month', ar.requested_at) AS request_month,
  EXTRACT(DOW FROM ar.requested_at) AS day_of_week,
  EXTRACT(HOUR FROM ar.requested_at) AS hour_of_day,
  ROUND(EXTRACT(EPOCH FROM (ar.resolved_at - ar.requested_at)) / 3600.0, 2) AS resolution_hours,
  CASE
    WHEN ar.resolved_at - ar.requested_at < INTERVAL '4 hours' THEN 'same_day'
    WHEN ar.resolved_at - ar.requested_at < INTERVAL '2 days' THEN 'within_2_days'
    WHEN ar.resolved_at - ar.requested_at < INTERVAL '7 days' THEN 'within_week'
    ELSE 'over_week'
  END AS sla_bucket,
  req.username AS requester_username, req.email AS requester_email,
  req.department AS requester_department,
  r.name AS role_requested,
  resolver.username AS resolved_by
FROM access_requests ar
JOIN tenants t ON t.id = ar.tenant_id
JOIN users req ON req.id = ar.requester_id
LEFT JOIN roles r ON r.id = ar.resource_id
LEFT JOIN users resolver ON resolver.id = ar.resolved_by;

-- ─── View 3: vw_certification_summary ────────────────────────────────────────
-- Campaign-level certification metrics for Tableau dashboards.
CREATE OR REPLACE VIEW vw_certification_summary AS
SELECT
  t.slug AS tenant,
  c.name AS campaign_name, c.type, c.status, c.due_date,
  c.created_at, c.completed_at,
  COUNT(ci.id) AS total_items,
  COUNT(ci.id) FILTER (WHERE ci.decision = 'certified') AS certified,
  COUNT(ci.id) FILTER (WHERE ci.decision = 'revoke') AS revoked,
  COUNT(ci.id) FILTER (WHERE ci.decision = 'pending') AS pending,
  ROUND(COUNT(ci.id) FILTER (WHERE ci.decision != 'pending')::numeric / NULLIF(COUNT(ci.id), 0) * 100, 1) AS completion_pct,
  ROUND(COUNT(ci.id) FILTER (WHERE ci.decision = 'revoke')::numeric / NULLIF(COUNT(ci.id) FILTER (WHERE ci.decision != 'pending'), 0) * 100, 1) AS revoke_rate_pct
FROM certifications c
JOIN tenants t ON t.id = c.tenant_id
LEFT JOIN certification_items ci ON ci.certification_id = c.id
GROUP BY c.id, t.slug;

-- ─── View 4: vw_sod_violations ────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_sod_violations AS
SELECT
  t.slug AS tenant,
  pv.violation_type, pv.severity, pv.status,
  pv.detected_at,
  DATE_TRUNC('day', pv.detected_at) AS violation_date,
  DATE_TRUNC('month', pv.detected_at) AS violation_month,
  p.name AS policy_name, p.enforcement,
  u.username, u.email, u.department, u.title
FROM policy_violations pv
JOIN tenants t ON t.id = pv.tenant_id
JOIN policies p ON p.id = pv.policy_id
JOIN users u ON u.id = pv.user_id;

-- ─── View 5: vw_connector_sync_history ────────────────────────────────────────
CREATE OR REPLACE VIEW vw_connector_sync_history AS
SELECT
  t.slug AS tenant,
  c.name AS connector_name, c.type AS connector_type, c.status AS connector_status,
  sj.direction, sj.status AS sync_status,
  sj.started_at, sj.completed_at,
  DATE_TRUNC('day', sj.started_at) AS sync_date,
  sj.records_processed,
  EXTRACT(EPOCH FROM (sj.completed_at - sj.started_at)) AS duration_secs,
  sj.error_message
FROM sync_jobs sj
JOIN connectors c ON c.id = sj.connector_id
JOIN tenants t ON t.id = c.tenant_id;

-- ─── View 6: vw_dormant_users ────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_dormant_users AS
SELECT
  t.slug AS tenant,
  u.username, u.email, u.first_name, u.last_name, u.department, u.title,
  u.status, u.last_login, u.created_at, u.source,
  EXTRACT(DAY FROM NOW() - u.last_login) AS days_since_login,
  u.last_login IS NULL AS never_logged_in,
  COUNT(ur.role_id) AS active_role_count
FROM users u
JOIN tenants t ON t.id = u.tenant_id
LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'
WHERE u.status = 'active'
  AND (u.last_login IS NULL OR u.last_login < NOW() - INTERVAL '90 days')
GROUP BY u.id, t.slug;

-- ─── Read-Only BI User for Tableau ────────────────────────────────────────────
-- Change the password before exposing to your BI team.
-- ─────────────────────────────────────────────────────────────────────────────
-- BI TOOLS READ-ONLY ACCESS (Tableau, Metabase, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexusiam_bi') THEN
    CREATE ROLE nexusiam_bi WITH LOGIN PASSWORD 'NexusBIRead@2024!';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE nexusiam TO nexusiam_bi;
GRANT USAGE ON SCHEMA public TO nexusiam_bi;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO nexusiam_bi;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO nexusiam_bi;

-- Grant read-only access to all reporting views
GRANT CONNECT ON DATABASE nexusiam TO nexusiam_bi;
GRANT USAGE ON SCHEMA public TO nexusiam_bi;
GRANT SELECT ON
  vw_user_access_flat,
  vw_access_requests_analytics,
  vw_certification_summary,
  vw_sod_violations,
  vw_connector_sync_history,
  vw_dormant_users
TO nexusiam_bi;

-- Also grant read on base tables (optional — for Tableau custom SQL)
GRANT SELECT ON
  users, roles, user_roles, access_requests, certifications,
  certification_items, policy_violations, policies, connectors,
  sync_jobs, audit_logs, tenants, organizations
TO nexusiam_bi;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PLATFORM STUDIO / EXTENSIBILITY FOUNDATION
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  provider_type VARCHAR(50) NOT NULL DEFAULT 'smtp',
  from_email VARCHAR(255),
  from_name VARCHAR(255),
  smtp_host VARCHAR(255),
  smtp_port INTEGER DEFAULT 587,
  secure BOOLEAN DEFAULT false,
  username VARCHAR(255),
  password_encrypted TEXT,
  is_active BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_key VARCHAR(150) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body_html TEXT,
  body_text TEXT,
  variables JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, template_key)
);

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(100) DEFAULT 'governance',
  trigger_type VARCHAR(100) DEFAULT 'manual',
  trigger_conditions JSONB DEFAULT '{}',
  steps JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'running',
  trigger_type VARCHAR(100),
  input_payload JSONB DEFAULT '{}',
  execution_log JSONB DEFAULT '[]',
  started_by UUID REFERENCES users(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS script_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  language VARCHAR(50) DEFAULT 'javascript',
  entry_type VARCHAR(100) DEFAULT 'workflow_rule',
  code TEXT NOT NULL,
  test_input JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quick_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  icon VARCHAR(100),
  route VARCHAR(255),
  action_type VARCHAR(100) DEFAULT 'navigate',
  workflow_id UUID REFERENCES workflow_definitions(id),
  visibility_rule TEXT,
  enabled BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 100,
  config JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  title VARCHAR(300) NOT NULL,
  assignee_id UUID REFERENCES users(id),
  reference_type VARCHAR(100),
  reference_id UUID,
  status VARCHAR(50) DEFAULT 'pending',
  due_at TIMESTAMPTZ,
  payload JSONB DEFAULT '{}',
  acted_by UUID REFERENCES users(id),
  acted_at TIMESTAMPTZ,
  action_comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_name VARCHAR(300) NOT NULL,
  task_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'running',
  started_by UUID REFERENCES users(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  input_payload JSONB DEFAULT '{}',
  output_payload JSONB DEFAULT '{}',
  error_detail JSONB
);

CREATE TABLE IF NOT EXISTS provisioning_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID REFERENCES access_requests(id),
  target_user_id UUID REFERENCES users(id),
  connector_id UUID REFERENCES connectors(id),
  operation VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'queued',
  plan_payload JSONB DEFAULT '{}',
  connector_response JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_work_items_assignee ON work_items(tenant_id, assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(tenant_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_prov_txn_request ON provisioning_transactions(tenant_id, request_id, created_at DESC);

INSERT INTO email_providers (tenant_id, name, provider_type, from_email, from_name, smtp_host, smtp_port, secure, username, password_encrypted, is_active)
SELECT '00000000-0000-0000-0000-000000000001', 'Local MailHog', 'smtp', 'no-reply@nexusiam.io', 'NexusIAM', 'mailhog', 1025, false, '', '', true
WHERE NOT EXISTS (SELECT 1 FROM email_providers WHERE tenant_id='00000000-0000-0000-0000-000000000001');

INSERT INTO email_templates (tenant_id, template_key, subject, body_html, body_text, variables)
SELECT '00000000-0000-0000-0000-000000000001', 'access_request_approval', 'Approval needed: {{ticketNumber}}', '<p>Hello {{approverName}},</p><p>{{requesterName}} submitted {{ticketNumber}} for {{resourceName}}.</p>', 'Hello {{approverName}}, {{requesterName}} submitted {{ticketNumber}} for {{resourceName}}.', '["ticketNumber","approverName","requesterName","resourceName"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND template_key='access_request_approval');

INSERT INTO script_definitions (tenant_id, name, description, language, entry_type, code, test_input, enabled, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'Privileged Access Guard', 'Blocks critical access without business justification', 'javascript', 'workflow_rule', 'if ((input.priority || "medium") === "critical" && !input.businessJustification) { return { allowed: false, reason: "Business justification required" }; } return { allowed: true, route: input.priority === "critical" ? "CAB" : "STANDARD" };', '{"priority":"critical","businessJustification":""}'::jsonb, true, '00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM script_definitions WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND name='Privileged Access Guard');

INSERT INTO workflow_definitions (tenant_id, name, description, category, trigger_type, trigger_conditions, steps, is_active, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'Access Request Orchestrator', 'Metadata-driven workflow for access requests', 'governance', 'event', '{"event":"access_request.created"}'::jsonb,
'[
  {"name":"Manager Approval","type":"APPROVAL","assigneeType":"role","assigneeValue":"IAM Admin"},
  {"name":"Policy Rule","type":"RUN_SCRIPT","scriptId":null},
  {"name":"Notify Approver","type":"SEND_EMAIL","template":"access_request_approval","recipientMode":"assignee"},
  {"name":"Provision Access","type":"PROVISION","operation":"role_grant"}
]'::jsonb,
true, '00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND name='Access Request Orchestrator');

INSERT INTO quick_links (tenant_id, name, icon, route, action_type, enabled, sort_order, config, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'Request Access', 'Shield', '/access-requests', 'navigate', true, 10, '{}'::jsonb, '00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM quick_links WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND name='Request Access');

-- ═══════════════════════════════════════════════════════════════════════════════
-- DEVELOPER CONSOLE / TENANT EXTENSIBILITY SURFACE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS form_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(100) DEFAULT 'request',
  schema JSONB DEFAULT '{}',
  ui_schema JSONB DEFAULT '{}',
  validation_rules JSONB DEFAULT '[]',
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS ui_page_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  route_path VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(100),
  page_type VARCHAR(100) DEFAULT 'custom',
  page_config JSONB DEFAULT '{}',
  required_permissions JSONB DEFAULT '[]',
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, route_path)
);

CREATE TABLE IF NOT EXISTS plugin_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  version VARCHAR(50) DEFAULT '1.0.0',
  status VARCHAR(50) DEFAULT 'draft',
  package_type VARCHAR(100) DEFAULT 'metadata',
  manifest JSONB DEFAULT '{}',
  capabilities JSONB DEFAULT '[]',
  routes JSONB DEFAULT '[]',
  extension_points JSONB DEFAULT '[]',
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS logger_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  logger_name VARCHAR(255) NOT NULL,
  level VARCHAR(50) DEFAULT 'info',
  target_type VARCHAR(100) DEFAULT 'application',
  pattern TEXT,
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, logger_name)
);

CREATE TABLE IF NOT EXISTS extension_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hook_key VARCHAR(200) NOT NULL,
  hook_type VARCHAR(100) DEFAULT 'workflow_step',
  script_id UUID REFERENCES script_definitions(id) ON DELETE SET NULL,
  plugin_id UUID REFERENCES plugin_registry(id) ON DELETE SET NULL,
  execution_mode VARCHAR(50) DEFAULT 'sync',
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, hook_key)
);

CREATE TABLE IF NOT EXISTS connector_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connectors(id) ON DELETE SET NULL,
  execution_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'success',
  correlation_id VARCHAR(255),
  request_payload JSONB DEFAULT '{}',
  response_payload JSONB DEFAULT '{}',
  error_detail JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_definitions_tenant ON form_definitions(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_plugin_registry_tenant ON plugin_registry(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_exec_logs_tenant ON connector_execution_logs(tenant_id, created_at DESC);

INSERT INTO form_definitions (tenant_id, name, description, category, schema, ui_schema, validation_rules, enabled, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'Dynamic Access Request Form', 'Metadata-driven form customers can extend', 'request',
'{"type":"object","required":["targetUser","resource","justification"],"properties":{"targetUser":{"type":"string","title":"Target User"},"resource":{"type":"string","title":"Resource"},"justification":{"type":"string","title":"Business Justification"},"priority":{"type":"string","enum":["low","medium","high","critical"]}}}'::jsonb,
'{"order":["targetUser","resource","justification","priority"]}'::jsonb,
'["justification_min_length:10"]'::jsonb,
true, '00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM form_definitions WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND name='Dynamic Access Request Form');

INSERT INTO ui_page_definitions (tenant_id, name, route_path, title, description, icon, page_type, page_config, required_permissions, enabled, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'Emergency Access', '/quick/emergency-access', 'Emergency Access', 'Tenant-defined page with its own form and approval policy', 'ShieldAlert', 'custom',
'{"form":"Dynamic Access Request Form","workflow":"Access Request Orchestrator","layout":"two-column"}'::jsonb,
'["REQUEST_ACCESS"]'::jsonb,
true, '00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM ui_page_definitions WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND route_path='/quick/emergency-access');

INSERT INTO plugin_registry (tenant_id, name, version, status, package_type, manifest, capabilities, routes, extension_points, enabled, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'Core Access Extensions', '1.0.0', 'published', 'metadata',
'{"displayName":"Core Access Extensions","author":"NexusIAM","description":"Sample tenant extension package"}'::jsonb,
'["quicklink","workflow-step","ui-page"]'::jsonb,
'[{"path":"/quick/emergency-access","title":"Emergency Access"}]'::jsonb,
'["access_request.created","workflow.step.provision","notification.beforeSend"]'::jsonb,
true, '00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM plugin_registry WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND name='Core Access Extensions');

INSERT INTO logger_configs (tenant_id, logger_name, level, target_type, pattern, enabled, config, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'provisioning.engine', 'debug', 'application', '%timestamp% [%level%] %message%', true,
'{"capturePayload":true,"maskSecrets":true}'::jsonb,
'00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM logger_configs WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND logger_name='provisioning.engine');

INSERT INTO extension_hooks (tenant_id, hook_key, hook_type, execution_mode, enabled, config, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'access_request.created', 'workflow_step', 'sync', true,
'{"description":"Hook point for additional risk validation before approval"}'::jsonb,
'00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM extension_hooks WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND hook_key='access_request.created');


-- ═══════════════════════════════════════════════════════════════════════════════
-- V8: CAPABILITIES / LIFECYCLE / AGGREGATION / LAUNCHPAD
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  capability_key VARCHAR(200) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'general',
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, capability_key)
);

CREATE TABLE IF NOT EXISTS user_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability_key VARCHAR(200) NOT NULL,
  grant_type VARCHAR(50) DEFAULT 'direct',
  granted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, capability_key)
);

CREATE TABLE IF NOT EXISTS lifecycle_event_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  event_key VARCHAR(120) NOT NULL,
  description TEXT,
  trigger_source VARCHAR(100) DEFAULT 'identity_change',
  trigger_conditions JSONB DEFAULT '{}',
  workflow_id UUID REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  form_definition_id UUID REFERENCES form_definitions(id) ON DELETE SET NULL,
  config JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, event_key)
);

CREATE TABLE IF NOT EXISTS lifecycle_event_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lifecycle_event_id UUID REFERENCES lifecycle_event_definitions(id) ON DELETE CASCADE,
  subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'completed',
  input_payload JSONB DEFAULT '{}',
  output_payload JSONB DEFAULT '{}',
  error_detail JSONB,
  triggered_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aggregation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES connectors(id) ON DELETE CASCADE,
  job_name VARCHAR(255) NOT NULL,
  aggregation_type VARCHAR(100) NOT NULL DEFAULT 'account',
  mode VARCHAR(50) DEFAULT 'full',
  schedule_cron VARCHAR(120),
  options JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'idle',
  last_run_at TIMESTAMPTZ,
  last_result JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE quick_links ADD COLUMN IF NOT EXISTS required_capabilities JSONB DEFAULT '[]';
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS provisioning_direction VARCHAR(50) DEFAULT 'bidirectional';
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE roles ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

INSERT INTO platform_capabilities (tenant_id, capability_key, display_name, category, description)
SELECT '00000000-0000-0000-0000-000000000001', x.capability_key, x.display_name, x.category, x.description
FROM (VALUES
  ('dashboard.view','Dashboard','overview','View overview dashboards'),
  ('users.manage','Manage Identities','identity','Create/update identities'),
  ('applications.manage','Manage Applications','identity','Configure applications and onboarding'),
  ('connectors.manage','Manage Connectors','operations','Add connectors and mappings'),
  ('aggregations.run','Run Aggregations','operations','Run account/group aggregation jobs'),
  ('lifecycle.manage','Manage Lifecycle Events','operations','Configure JML event definitions'),
  ('quicklinks.manage','Manage Quick Links','studio','Create/edit launchpad entries'),
  ('approvals.work','Work Items','governance','Complete approvals and governance work items'),
  ('reports.view','Reports','operations','Access reports'),
  ('admin.capabilities','Capabilities','admin','Assign capabilities to users'),
  ('developer.console','Developer Console','admin','Access developer tooling'),
  ('studio.manage','Platform Studio','studio','Manage workflows, forms, scripts'),
  ('approvals.admin','Approvals Admin','governance','View and act on all pending approvals across all approvers'),
  ('certifications.view','View Certifications','governance','View access certification campaigns and results'),
  ('certifications.manage','Manage Certifications','governance','Launch, manage, and complete access certifications'),
  ('policies.view','View Policies','governance','View SoD and access policies'),
  ('policies.manage','Manage Policies','governance','Create and manage SoD and access policies'),
  ('roles.manage','Manage Roles','identity','Create, edit, and assign roles and entitlements'),
  ('entitlements.manage','Manage Entitlements','identity','Manage entitlements and access items'),
  ('workgroups.manage','Manage Workgroups','identity','Create and manage workgroups and membership'),
  ('audit.view','View Audit Logs','admin','View audit trail and system logs'),
  ('cab.view','View CAB Cases','governance','View Change Advisory Board cases'),
  ('cab.manage','Manage CAB Cases','governance','Submit and manage Change Advisory Board cases')
) AS x(capability_key, display_name, category, description)
WHERE NOT EXISTS (
  SELECT 1 FROM platform_capabilities pc WHERE pc.tenant_id='00000000-0000-0000-0000-000000000001' AND pc.capability_key=x.capability_key
);

UPDATE roles SET metadata = COALESCE(metadata, '{}'::jsonb) ||
  CASE name
    WHEN 'Super Admin' THEN '{"capabilities":["*"]}'::jsonb
    WHEN 'IAM Admin' THEN '{"capabilities":["dashboard.view","users.manage","applications.manage","connectors.manage","aggregations.run","lifecycle.manage","quicklinks.manage","approvals.work","reports.view","studio.manage","developer.console"]}'::jsonb
    WHEN 'Help Desk' THEN '{"capabilities":["dashboard.view","users.manage","approvals.work"]}'::jsonb
    WHEN 'Auditor' THEN '{"capabilities":["dashboard.view","reports.view"]}'::jsonb
    ELSE metadata
  END
WHERE tenant_id='00000000-0000-0000-0000-000000000001';

UPDATE quick_links SET required_capabilities='["approvals.work"]'::jsonb WHERE name='Request Access' AND tenant_id='00000000-0000-0000-0000-000000000001';

INSERT INTO lifecycle_event_definitions (tenant_id, name, event_key, description, trigger_source, trigger_conditions, workflow_id, config, enabled, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'Joiner', 'joiner', 'New hire onboarding with birthright access', 'hr_feed', '{"status":"hire"}'::jsonb,
  (SELECT id FROM workflow_definitions WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND name='Access Request Orchestrator' LIMIT 1),
  '{"birthrightRoles":["Employee Base Access"],"notifyManager":true}'::jsonb, true, '00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM lifecycle_event_definitions WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND event_key='joiner');

INSERT INTO lifecycle_event_definitions (tenant_id, name, event_key, description, trigger_source, trigger_conditions, workflow_id, config, enabled, created_by)
SELECT '00000000-0000-0000-0000-000000000001', 'Leaver', 'leaver', 'Termination and deprovisioning event', 'hr_feed', '{"status":"termination"}'::jsonb,
  (SELECT id FROM workflow_definitions WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND name='Access Request Orchestrator' LIMIT 1),
  '{"disableAccounts":true,"revokeRoles":true}'::jsonb, true, '00000000-0000-0000-0000-000000000100'
WHERE NOT EXISTS (SELECT 1 FROM lifecycle_event_definitions WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND event_key='leaver');

INSERT INTO aggregation_jobs (tenant_id, connector_id, job_name, aggregation_type, mode, schedule_cron, options, status, created_by)
SELECT '00000000-0000-0000-0000-000000000001', c.id, c.name || ' Account Aggregation', 'account', 'full', '0 2 * * *', '{"createAccounts":true,"linkToIdentities":true}'::jsonb, 'idle', '00000000-0000-0000-0000-000000000100'
FROM connectors c
WHERE c.tenant_id='00000000-0000-0000-0000-000000000001'
AND NOT EXISTS (SELECT 1 FROM aggregation_jobs aj WHERE aj.connector_id=c.id AND aj.aggregation_type='account');


-- Demo sample data removed from default initialization.
-- Set up applications/connectors through the UI after first login.

-- user_capabilities: see definition above with tenant_id

-- ─── Provisioning Policies ───────────────────────────────────────────────────
-- One policy per connector per operation (Create/Update/Enable/Disable/Delete)
CREATE TABLE IF NOT EXISTS provisioning_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  operation VARCHAR(50) NOT NULL,   -- 'Create' | 'Update' | 'Enable' | 'Disable' | 'Delete' | 'Unlock'
  enabled BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  fields JSONB NOT NULL DEFAULT '[]',
  -- fields: [{ name, label, type, source, value, rule_script, required, transform }]
  -- source: 'identity' | 'static' | 'rule' | 'generator'
  -- transform: null | 'upper' | 'lower' | 'concat' | 'split' | 'regex' | 'date_format'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connector_id, operation)
);

CREATE INDEX IF NOT EXISTS idx_prov_policies_connector ON provisioning_policies(connector_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2 ADDITIONS — Workgroups, Identity Mapping, Lifecycle, Enhancements
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Workgroups ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workgroups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_type VARCHAR(20) DEFAULT 'identity',  -- 'identity' | 'workgroup'
  group_email VARCHAR(255),
  notification_setting VARCHAR(50) DEFAULT 'members_and_email',
  -- 'members_and_email' | 'members_only' | 'email_only'
  capabilities JSONB DEFAULT '[]',
  -- array of capability keys e.g. ["iam_administrator","access_request_approver"]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS workgroup_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workgroup_id UUID NOT NULL REFERENCES workgroups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(workgroup_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workgroups_tenant ON workgroups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workgroup_members_wg ON workgroup_members(workgroup_id);
CREATE INDEX IF NOT EXISTS idx_workgroup_members_user ON workgroup_members(user_id);

-- ─── Global Settings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS global_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(tenant_id, key)
);

-- Default: mover trigger fields
INSERT INTO global_settings (tenant_id, key, value)
SELECT id, 'mover_trigger_fields',
  '["department","manager","jobTitle","location"]'::jsonb
FROM tenants
ON CONFLICT DO NOTHING;

-- ─── Identity Attributes (schema definition) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS identity_attributes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attribute_name VARCHAR(255) NOT NULL,   -- internal name e.g. 'firstName'
  display_name VARCHAR(255),              -- label e.g. 'First Name'
  attribute_type VARCHAR(50) DEFAULT 'string',
  -- 'string'|'boolean'|'date'|'integer'|'multi_string'
  edit_mode VARCHAR(20) DEFAULT 'editable', -- 'editable'|'read_only'
  is_multi_valued BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT false,        -- system attrs can't be deleted
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, attribute_name)
);

-- ─── Identity Source Mappings ─────────────────────────────────────────────────
-- Each identity attribute can pull from multiple sources in priority order
CREATE TABLE IF NOT EXISTS identity_source_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identity_attribute_id UUID NOT NULL REFERENCES identity_attributes(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 1,        -- 1 = highest priority
  source_application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  source_connector_id UUID REFERENCES connectors(id) ON DELETE CASCADE,
  source_attribute VARCHAR(255) NOT NULL, -- attribute name in source app
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(identity_attribute_id, priority)
);

-- ─── Identity Target Mappings ─────────────────────────────────────────────────
-- Each identity attribute can push to multiple target applications
CREATE TABLE IF NOT EXISTS identity_target_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identity_attribute_id UUID NOT NULL REFERENCES identity_attributes(id) ON DELETE CASCADE,
  target_application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  target_attribute VARCHAR(255) NOT NULL,
  transformation_rule TEXT,               -- JS expression or null
  provision_all_accounts BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(identity_attribute_id, target_application_id, target_attribute)
);

CREATE INDEX IF NOT EXISTS idx_identity_attrs_tenant ON identity_attributes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_identity_src_map_attr ON identity_source_mappings(identity_attribute_id);
CREATE INDEX IF NOT EXISTS idx_identity_tgt_map_attr ON identity_target_mappings(identity_attribute_id);

-- ─── Lifecycle Events ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lifecycle_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  -- 'JOINER'|'LEAVER'|'MOVER'|'REHIRE'
  triggered_by VARCHAR(100),              -- 'aggregation'|'manual'|'attribute_sync'
  changed_attributes JSONB DEFAULT '{}',  -- what changed for MOVER
  previous_values JSONB DEFAULT '{}',
  new_values JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_user ON lifecycle_events(user_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_tenant ON lifecycle_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_type ON lifecycle_events(event_type);

-- ─── Enhance users table — add correlated + identity fields ──────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS correlated BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS correlated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_refresh TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_score INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(50) DEFAULT 'identity';
-- 'identity' | 'workgroup' | 'service_account'
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_attributes JSONB DEFAULT '{}';
-- stores all dynamic identity attribute values keyed by attribute_name
ALTER TABLE users ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '[]';
-- direct capabilities (separate from workgroup-inherited ones)

-- ─── Enhance entitlements table ───────────────────────────────────────────────
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS owner_type VARCHAR(20) DEFAULT 'identity';
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS owner_workgroup_id UUID REFERENCES workgroups(id) ON DELETE SET NULL;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS elevated_access BOOLEAN DEFAULT false;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS classifications JSONB DEFAULT '[]';
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS display_value VARCHAR(500);
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS attribute VARCHAR(255);
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS custom_metadata JSONB DEFAULT '{}'::jsonb;

-- Prevent duplicate entitlements on import
CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_unique
  ON entitlements(tenant_id, application_id, value, type)
  WHERE application_id IS NOT NULL;

-- ─── Enhance applications table ───────────────────────────────────────────────
ALTER TABLE applications ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS owner_type VARCHAR(20) DEFAULT 'identity';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS owner_workgroup_id UUID REFERENCES workgroups(id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_authoritative BOOLEAN DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_sox BOOLEAN DEFAULT false;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS is_birthright BOOLEAN DEFAULT false;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS provisioning_direction VARCHAR(50) DEFAULT 'bidirectional';
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ─── Default identity attributes (system) ────────────────────────────────────
-- These will be seeded per-tenant on first login via backend, but also here for demo tenant
INSERT INTO identity_attributes (tenant_id, attribute_name, display_name, attribute_type, is_system, sort_order)
SELECT
  t.id,
  a.attribute_name,
  a.display_name,
  a.attribute_type,
  true,
  a.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('firstName',   'First Name',   'string',  1),
  ('lastName',    'Last Name',    'string',  2),
  ('email',       'Email',        'string',  3),
  ('department',  'Department',   'string',  4),
  ('jobTitle',    'Job Title',    'string',  5),
  ('manager',     'Manager',      'string',  6),
  ('location',    'Location',     'string',  7),
  ('country',     'Country',      'string',  8),
  ('employeeId',  'Employee ID',  'string',  9),
  ('costCenter',  'Cost Center',  'string',  10),
  ('businessUnit','Business Unit','string',  11),
  ('positionId',  'Position ID',  'string',  12),
  ('userType',    'User Type',    'string',  13),
  ('status',      'Status',       'string',  14),
  ('active',      'Active',       'boolean', 15)
) AS a(attribute_name, display_name, attribute_type, sort_order)
ON CONFLICT DO NOTHING;

-- ─── Phase 2 Security Tables ─────────────────────────────────────────────────

-- Inbound API Keys (external systems calling NexusIAM)
CREATE TABLE IF NOT EXISTS api_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  key_id        VARCHAR(64) NOT NULL UNIQUE,       -- public identifier shown in UI
  key_secret_hash TEXT NOT NULL,                   -- bcrypt hash, never stored plain
  key_preview   VARCHAR(10),                       -- last 6 chars for display only
  description   TEXT,
  is_active     BOOLEAN DEFAULT true,
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Outbound Credential Vault (NexusIAM calling external systems)
CREATE TABLE IF NOT EXISTS credential_vault (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             VARCHAR(200) NOT NULL,           -- referenced by connectors/rules
  credential_type  VARCHAR(50) NOT NULL DEFAULT 'api_key', -- api_key|basic|oauth2|token|certificate
  encrypted_value  TEXT NOT NULL,                   -- AES-256-GCM encrypted
  iv               VARCHAR(64) NOT NULL,            -- AES IV stored alongside
  metadata         JSONB DEFAULT '{}',              -- non-secret: endpoint, username, expiry hint
  description      TEXT,
  last_rotated_at  TIMESTAMPTZ DEFAULT NOW(),
  is_active        BOOLEAN DEFAULT true,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

-- Security Settings (SAML, session TTL, email config — one row per tenant)
CREATE TABLE IF NOT EXISTS security_settings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  -- Session
  session_idle_timeout_mins   INTEGER DEFAULT 30,
  session_max_lifetime_mins   INTEGER DEFAULT 480,
  jwt_access_token_ttl_mins   INTEGER DEFAULT 15,
  jwt_refresh_token_ttl_days  INTEGER DEFAULT 7,
  -- Email transport
  email_transport    VARCHAR(20) DEFAULT 'smtp',    -- smtp|file|disabled
  email_smtp_host    VARCHAR(255),
  email_smtp_port    INTEGER DEFAULT 587,
  email_smtp_user    VARCHAR(255),
  email_smtp_pass_vault_ref VARCHAR(200),           -- vault entry name for password
  email_smtp_from    VARCHAR(255) DEFAULT 'NexusIAM <noreply@nexusiam.io>',
  email_smtp_tls     BOOLEAN DEFAULT true,
  email_file_path    VARCHAR(500) DEFAULT '/tmp/nexusiam-emails',
  -- SAML
  saml_enabled       BOOLEAN DEFAULT false,
  saml_idp_entity_id VARCHAR(500),
  saml_idp_sso_url   VARCHAR(500),
  saml_idp_slo_url   VARCHAR(500),
  saml_idp_certificate TEXT,
  saml_sp_entity_id  VARCHAR(500),
  saml_attribute_map JSONB DEFAULT '{"email":"email","firstName":"firstName","lastName":"lastName"}',
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default security settings for demo tenant
INSERT INTO security_settings (tenant_id)
SELECT '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (
  SELECT 1 FROM security_settings WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
);

-- V20.5 migrations
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_type_check;
ALTER TABLE roles ADD CONSTRAINT roles_type_check CHECK (type IN ('system','business','it','birthright'));

-- Password policies table
CREATE TABLE IF NOT EXISTS password_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  min_length INTEGER DEFAULT 12,
  max_length INTEGER DEFAULT 128,
  min_letters INTEGER DEFAULT 1,
  min_digits INTEGER DEFAULT 1,
  min_uppercase INTEGER DEFAULT 1,
  min_lowercase INTEGER DEFAULT 1,
  min_special INTEGER DEFAULT 1,
  max_repeated INTEGER DEFAULT 3,
  history_length INTEGER DEFAULT 5,
  trivial_check BOOLEAN DEFAULT true,
  case_sensitive BOOLEAN DEFAULT true,
  days_until_expiry INTEGER DEFAULT 90,
  days_until_generated_expiry INTEGER DEFAULT 7,
  min_hours_between_changes INTEGER DEFAULT 24,
  check_dictionary BOOLEAN DEFAULT false,
  check_identity_attrs BOOLEAN DEFAULT true,
  min_attr_length INTEGER DEFAULT 3,
  require_current_password BOOLEAN DEFAULT true,
  enable_hashing BOOLEAN DEFAULT true,
  hashing_iterations INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default password policy for demo tenant
INSERT INTO password_policies (tenant_id, min_length, min_digits, min_uppercase, min_lowercase, min_special)
SELECT id, 12, 1, 1, 1, 1 FROM tenants WHERE slug='demo'
ON CONFLICT (tenant_id) DO NOTHING;

-- Access Request Settings table
CREATE TABLE IF NOT EXISTS access_request_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  require_manager_approval BOOLEAN DEFAULT true,
  require_entitlement_owner_approval BOOLEAN DEFAULT false,
  allow_self_approval BOOLEAN DEFAULT false,
  max_request_duration_days INTEGER DEFAULT 30,
  reminder_days INTEGER DEFAULT 2,
  escalation_days INTEGER DEFAULT 5,
  auto_expire_days INTEGER DEFAULT 7,
  notify_requester BOOLEAN DEFAULT true,
  notify_manager BOOLEAN DEFAULT true,
  notify_owner BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO access_request_settings (tenant_id)
SELECT id FROM tenants WHERE slug='demo'
ON CONFLICT (tenant_id) DO NOTHING;

-- Add is_birthright to applications table
ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_birthright BOOLEAN DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4A — SCALE INDEXES
-- Added to support 1M users, 50M entitlements, 500K access requests
-- All use IF NOT EXISTS — safe to run on existing DBs
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Entitlements (50M rows — biggest scale risk) ─────────────────────────────
-- Primary lookup: tenant + app (every entitlement list page)
CREATE INDEX IF NOT EXISTS idx_entitlements_tenant_app
  ON entitlements(tenant_id, application_id);

-- Type filter (group/role/permission filtering)
CREATE INDEX IF NOT EXISTS idx_entitlements_tenant_type
  ON entitlements(tenant_id, type);

-- Name search (LIKE 'abc%' style — prefix search)
CREATE INDEX IF NOT EXISTS idx_entitlements_name
  ON entitlements(tenant_id, name varchar_pattern_ops);

-- Value lookup (exact match on entitlement value during provisioning)
CREATE INDEX IF NOT EXISTS idx_entitlements_value
  ON entitlements(tenant_id, value varchar_pattern_ops);

-- Requestable filter (catalog page — most common filter)
CREATE INDEX IF NOT EXISTS idx_entitlements_requestable
  ON entitlements(tenant_id, application_id)
  WHERE (metadata->>'requestable')::boolean = true;

-- Owner lookup
CREATE INDEX IF NOT EXISTS idx_entitlements_owner
  ON entitlements(owner_id)
  WHERE owner_id IS NOT NULL;

-- ── Access Requests (500K rows — approval workflows) ─────────────────────────
-- Most common query: tenant + status (pending approvals list)
CREATE INDEX IF NOT EXISTS idx_access_requests_tenant_status
  ON access_requests(tenant_id, status);

-- Requester's own requests
CREATE INDEX IF NOT EXISTS idx_access_requests_requester
  ON access_requests(tenant_id, requester_id, status);

-- Target user's requests
CREATE INDEX IF NOT EXISTS idx_access_requests_target
  ON access_requests(tenant_id, target_user_id, status);

-- Resource lookup (which requests are for this role/entitlement)
CREATE INDEX IF NOT EXISTS idx_access_requests_resource
  ON access_requests(tenant_id, resource_id)
  WHERE resource_id IS NOT NULL;

-- Date range queries (reports, dashboards)
CREATE INDEX IF NOT EXISTS idx_access_requests_date
  ON access_requests(tenant_id, requested_at DESC);

-- Reminder scheduler (hourly job — pending + reminder date)
CREATE INDEX IF NOT EXISTS idx_access_requests_reminder
  ON access_requests(tenant_id, status, requested_at)
  WHERE status = 'pending';

-- ── Users (1M rows) ───────────────────────────────────────────────────────────
-- Name search (first + last for search bar)
CREATE INDEX IF NOT EXISTS idx_users_name
  ON users(tenant_id, lower(first_name || ' ' || last_name) varchar_pattern_ops);

-- Username exact lookup (login + correlation)
CREATE INDEX IF NOT EXISTS idx_users_username
  ON users(tenant_id, username);

-- Manager hierarchy queries
CREATE INDEX IF NOT EXISTS idx_users_manager
  ON users(manager_id)
  WHERE manager_id IS NOT NULL;

-- Department filter
CREATE INDEX IF NOT EXISTS idx_users_dept
  ON users(tenant_id, department)
  WHERE department IS NOT NULL;

-- Status + tenant (active users list — most common)
CREATE INDEX IF NOT EXISTS idx_users_tenant_status
  ON users(tenant_id, status);

-- Risk score (security dashboard)
CREATE INDEX IF NOT EXISTS idx_users_risk
  ON users(tenant_id, risk_score DESC)
  WHERE risk_score > 0;

-- ── User Roles (join table — hit on every identity detail) ───────────────────
CREATE INDEX IF NOT EXISTS idx_user_roles_user_status
  ON user_roles(user_id, status);

CREATE INDEX IF NOT EXISTS idx_user_roles_tenant_status
  ON user_roles(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_user_roles_expiry
  ON user_roles(expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';

-- ── Role Entitlements (join table — hit on every provisioning decision) ───────
CREATE INDEX IF NOT EXISTS idx_role_entitlements_role
  ON role_entitlements(role_id);

CREATE INDEX IF NOT EXISTS idx_role_entitlements_entitlement
  ON role_entitlements(entitlement_id);

-- ── Account Links (aggregated accounts) ──────────────────────────────────────
-- Tenant + status lookup
CREATE INDEX IF NOT EXISTS idx_account_links_tenant_type
  ON account_links(tenant_id, object_type);

-- User's accounts (identity detail page)
CREATE INDEX IF NOT EXISTS idx_account_links_user_connector
  ON account_links(user_id, connector_id);

-- Last aggregated (stale account detection)
CREATE INDEX IF NOT EXISTS idx_account_links_last_agg
  ON account_links(connector_id, last_aggregated_at DESC);

-- ── Account Access Items (entitlement discovery — can be huge) ────────────────
-- Tenant + type filter (entitlements page)
CREATE INDEX IF NOT EXISTS idx_aai_tenant_type
  ON account_access_items(tenant_id, access_type);

-- Value lookup (exact match during provisioning checks)
CREATE INDEX IF NOT EXISTS idx_aai_value
  ON account_access_items(tenant_id, access_value varchar_pattern_ops);

-- Last seen (stale entitlement detection)
CREATE INDEX IF NOT EXISTS idx_aai_last_seen
  ON account_access_items(connector_id, last_seen_at DESC);

-- ── Notifications (bell icon — must be fast) ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read, created_at DESC)
  WHERE read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_tenant
  ON notifications(tenant_id, created_at DESC);

-- ── Audit Logs (reporting — can grow very large) ─────────────────────────────
-- Composite: tenant + date (most report queries)
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_date
  ON audit_logs(tenant_id, created_at DESC);

-- Action type filter
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(tenant_id, action, created_at DESC);

-- ── Provisioning Transactions (approval detail + reports) ─────────────────────
CREATE INDEX IF NOT EXISTS idx_prov_txn_tenant_status
  ON provisioning_transactions(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_prov_txn_user
  ON provisioning_transactions(target_user_id, tenant_id);

-- ── Certifications ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_certifications_tenant_status
  ON certifications(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_cert_items_reviewer_decision
  ON certification_items(reviewer_id, decision)
  WHERE decision = 'pending';

-- ── Work Items (approvals queue) ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_work_items_ref
  ON work_items(reference_id, tenant_id);

-- ── Applications ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_applications_tenant_status
  ON applications(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_applications_name
  ON applications(tenant_id, lower(name) varchar_pattern_ops);

-- ── Connectors ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_connectors_tenant_status
  ON connectors(tenant_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- END PHASE 4A INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 5 — LIFECYCLE EVENTS ENGINE
-- Append this entire file after the last line of your existing init.sql
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- Safe to run on existing databases — no data loss, no conflicts
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: IDENTITY FLAGS
-- New columns on existing users table
-- Track refresh state, new identity detection, previous attribute snapshot
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_refresh          BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_refresh_reason   VARCHAR(100);
-- 'aggregation_delta' | 'manual' | 'new_identity' | 'attribute_change'
-- 'role_change' | 'policy_change' | 'scheduled'

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_new_identity        BOOLEAN DEFAULT false;
-- Set TRUE when account_links created for first time
-- Cleared after JOINER workflow completes successfully

ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_status        VARCHAR(50) DEFAULT 'active';
-- 'active' | 'inactive' | 'pending_joiner' | 'pending_leaver'
-- 'on_leave' | 'terminated' | 'dormant'

ALTER TABLE users ADD COLUMN IF NOT EXISTS previous_attributes    JSONB DEFAULT '{}';
-- Full snapshot of attributes from LAST successful refresh
-- Used for MOVER detection — compare current vs previous

ALTER TABLE users ADD COLUMN IF NOT EXISTS correlated_identity    BOOLEAN DEFAULT false;
-- TRUE = matched to a real person in authoritative source
-- FALSE = orphan account, no identity match yet

ALTER TABLE users ADD COLUMN IF NOT EXISTS joiner_fired           BOOLEAN DEFAULT false;
-- TRUE = JOINER event has been queued/processed for this user
-- Prevents duplicate JOINER events on re-aggregation

ALTER TABLE users ADD COLUMN IF NOT EXISTS start_date             DATE;
-- From HR source — used for pre-provisioning JOINER timing

ALTER TABLE users ADD COLUMN IF NOT EXISTS termination_date       DATE;
-- From HR source — used for LEAVER timing

ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date              DATE;
-- Original hire date — used for REHIRE detection


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: ACCOUNT SNAPSHOTS
-- Hash-based delta detection — avoids full table scans at scale
-- One row per account per connector — updated after every aggregation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS account_snapshots (
  connector_id      UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  native_identity   VARCHAR(255) NOT NULL,
  attribute_hash    VARCHAR(64) NOT NULL,
  -- MD5 of JSON.stringify(sortedAttributes)
  -- If hash unchanged → skip processing entirely (fast path)
  full_snapshot     JSONB DEFAULT '{}',
  -- Full attribute values at time of last snapshot
  snapshot_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (connector_id, native_identity)
);

CREATE INDEX IF NOT EXISTS idx_account_snapshots_connector
  ON account_snapshots(connector_id, snapshot_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: BLESSED ACCESS
-- What NexusIAM has officially approved for each user per connector
-- NCD detection = account_access_items MINUS blessed_access
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blessed_access (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id    UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  access_type     VARCHAR(100) NOT NULL,
  access_value    VARCHAR(500) NOT NULL,
  approved_via    VARCHAR(100),
  -- 'request_id:<uuid>' | 'birthright' | 'initial_load' | 'manual' | 'rehire'
  approved_at     TIMESTAMPTZ DEFAULT NOW(),
  approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ,
  UNIQUE(user_id, connector_id, access_type, access_value)
);

CREATE INDEX IF NOT EXISTS idx_blessed_access_user_connector
  ON blessed_access(user_id, connector_id);

CREATE INDEX IF NOT EXISTS idx_blessed_access_tenant
  ON blessed_access(tenant_id, connector_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: NCD INCIDENTS
-- Native Change Detection — access granted outside NexusIAM
-- Created when account_access_items has entries not in blessed_access
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ncd_incidents (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id          UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  access_type           VARCHAR(100) NOT NULL,
  access_value          VARCHAR(500) NOT NULL,
  detected_at           TIMESTAMPTZ DEFAULT NOW(),
  status                VARCHAR(50) DEFAULT 'pending_review',
  -- 'pending_review' | 'approved' | 'revoked' | 'ignored' | 'escalated'
  workflow_execution_id UUID,
  -- Points to the workflow execution handling this NCD
  approval_request_id   UUID REFERENCES access_requests(id) ON DELETE SET NULL,
  remediation_action    VARCHAR(100),
  -- 'approved' | 'revoked' | 'ignored'
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_ncd_incidents_tenant_status
  ON ncd_incidents(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_ncd_incidents_user
  ON ncd_incidents(user_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ncd_incidents_connector
  ON ncd_incidents(connector_id, detected_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: LIFECYCLE EVENT QUEUE
-- Async processing queue — aggregation writes here, workers read from here
-- Replaces simple fire-and-forget — full retry, locking, dead letter support
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lifecycle_event_queue (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type            VARCHAR(50) NOT NULL,
  -- 'JOINER' | 'LEAVER' | 'MOVER' | 'REHIRE' | 'NCD'
  -- 'TRANSFER' | 'LEAVE_OF_ABSENCE' | 'RETURN_FROM_LEAVE'
  -- 'ROLE_CHANGE' | 'DORMANT' | 'RISK_ESCALATION'
  -- or any custom event key defined by tenant
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id          UUID REFERENCES connectors(id) ON DELETE SET NULL,
  -- which connector triggered this event
  status                VARCHAR(30) DEFAULT 'pending',
  -- 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter' | 'skipped'
  attempts              INTEGER DEFAULT 0,
  max_attempts          INTEGER DEFAULT 6,
  -- 6 attempts × 4 hour intervals = 24 hours total retry window
  next_retry_at         TIMESTAMPTZ DEFAULT NOW(),
  locked_by             VARCHAR(100),
  -- worker ID that currently holds this event — prevents double processing
  locked_until          TIMESTAMPTZ,
  -- worker must complete before this time or lock is released
  detected_at           TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  delta_payload         JSONB DEFAULT '{}',
  -- what changed: { changed_fields: { title: { from: 'x', to: 'y' } } }
  context               JSONB DEFAULT '{}',
  -- full user attribute snapshot at time of event detection
  error_message         TEXT,
  -- last error message from failed attempt
  workflow_execution_id UUID
  -- filled in when workflow starts executing this event
);

CREATE INDEX IF NOT EXISTS idx_leq_pending
  ON lifecycle_event_queue(tenant_id, status, next_retry_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_leq_user
  ON lifecycle_event_queue(user_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_leq_status
  ON lifecycle_event_queue(tenant_id, status, detected_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: WORKFLOW EXECUTIONS
-- One row per workflow instance — tracks state across all steps
-- Steps can pause (WAIT), resume, branch — state carried in context JSONB
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_executions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id           UUID REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  trigger_event_id      UUID REFERENCES lifecycle_event_queue(id) ON DELETE SET NULL,
  -- which lifecycle event triggered this execution
  user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  -- the identity being processed
  status                VARCHAR(30) DEFAULT 'running',
  -- 'running' | 'completed' | 'failed' | 'waiting' | 'cancelled' | 'paused'
  current_step_index    INTEGER DEFAULT 0,
  started_at            TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  resume_at             TIMESTAMPTZ,
  -- set by WAIT_N_DAYS and WAIT_UNTIL_DATE steps
  -- worker skips this execution until resume_at is reached
  context               JSONB DEFAULT '{}',
  -- carries variables between steps
  -- example: { assignedRoles: [...], failedApps: [...], approvalDecision: 'approved' }
  error_message         TEXT
);

CREATE INDEX IF NOT EXISTS idx_wf_exec_status
  ON workflow_executions(tenant_id, status, resume_at);

CREATE INDEX IF NOT EXISTS idx_wf_exec_user
  ON workflow_executions(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_wf_exec_trigger
  ON workflow_executions(trigger_event_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 7: WORKFLOW STEP LOGS
-- One row per step per execution — full audit trail of every action taken
-- Enables the VIEW detail screen showing per-app per-step results
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_step_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id    UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step_index      INTEGER NOT NULL,
  step_type       VARCHAR(100) NOT NULL,
  -- 'ASSIGN_ROLE' | 'PROVISION_TO_APP' | 'SEND_EMAIL' | 'WAIT_N_DAYS'
  -- 'IF_CONDITION' | 'REQUEST_APPROVAL' | 'SINGLE_ACCOUNT_AGG' etc.
  step_name       VARCHAR(200),
  -- human readable name from canvas config
  status          VARCHAR(30) DEFAULT 'pending',
  -- 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting'
  target_app_id   UUID REFERENCES applications(id) ON DELETE SET NULL,
  -- which application this step processed (for provisioning steps)
  target_app_name VARCHAR(200),
  -- stored separately so it survives app rename/delete
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  input           JSONB DEFAULT '{}',
  -- step config + resolved parameters at execution time
  output          JSONB DEFAULT '{}',
  -- result: { accountCreated: true, accountId: 'CN=john...', entitlementsGranted: [...] }
  error_message   TEXT,
  resume_at       TIMESTAMPTZ
  -- for WAIT steps — when to resume
);

CREATE INDEX IF NOT EXISTS idx_wf_step_execution
  ON workflow_step_logs(execution_id, step_index);

CREATE INDEX IF NOT EXISTS idx_wf_step_status
  ON workflow_step_logs(tenant_id, status, started_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 8: MOVER TRIGGER CONFIG
-- Customer defines which attributes trigger MOVER (and other events)
-- Default: department, manager, title, location
-- Customer can add/remove/change comparison mode per attribute
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mover_trigger_config (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attribute_name    VARCHAR(255) NOT NULL,
  -- attribute name exactly as it appears in previous_attributes JSONB
  display_name      VARCHAR(255),
  -- human readable label for UI
  is_active         BOOLEAN DEFAULT true,
  event_type        VARCHAR(50) DEFAULT 'MOVER',
  -- which event to fire: 'MOVER' | 'TRANSFER' | 'ROLE_CHANGE' | custom key
  comparison_mode   VARCHAR(30) DEFAULT 'any_change',
  -- 'any_change'      → fire if value changed at all
  -- 'specific_values' → fire only if changed FROM or TO specific values
  from_values       JSONB DEFAULT '[]',
  -- only relevant if comparison_mode = 'specific_values'
  -- fire if previous value WAS one of these
  to_values         JSONB DEFAULT '[]',
  -- fire if new value IS one of these
  sort_order        INTEGER DEFAULT 0,
  UNIQUE(tenant_id, attribute_name)
);

-- Seed default MOVER trigger attributes for demo tenant
INSERT INTO mover_trigger_config
  (tenant_id, attribute_name, display_name, is_active, event_type, comparison_mode, sort_order)
SELECT
  '00000000-0000-0000-0000-000000000001',
  a.attribute_name, a.display_name, true, 'MOVER', 'any_change', a.sort_order
FROM (VALUES
  ('department',   'Department',   1),
  ('manager',      'Manager',      2),
  ('title',        'Job Title',    3),
  ('location',     'Location',     4),
  ('cost_center',  'Cost Center',  5),
  ('business_unit','Business Unit',6)
) AS a(attribute_name, display_name, sort_order)
ON CONFLICT (tenant_id, attribute_name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_mover_config_tenant
  ON mover_trigger_config(tenant_id, is_active);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 9: JOINER TRIGGER CONFIG
-- Customer defines WHEN to fire JOINER — not hardcoded
-- One row per tenant — created on first login if not exists
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS joiner_trigger_config (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger_mode            VARCHAR(50) DEFAULT 'immediate',
  -- 'immediate'          → fire as soon as new account appears
  -- 'start_date'         → fire N days before/after start_date field
  -- 'window'             → fire if account appeared within last N days
  -- 'attribute_condition'→ fire only if attribute condition matches
  -- 'always_on_new'      → any new account = joiner, no date check
  pre_provision_days      INTEGER DEFAULT 0,
  -- days BEFORE start_date to fire (0 = on start_date, 7 = 7 days before)
  window_days             INTEGER DEFAULT 1,
  -- used when trigger_mode = 'window'
  start_date_field        VARCHAR(100) DEFAULT 'start_date',
  -- attribute name in source that holds the start date
  attribute_conditions    JSONB DEFAULT '[]',
  -- array of conditions:
  -- [{ field: 'employment_type', operator: 'equals', value: 'full_time' }]
  fire_on_status_change   VARCHAR(100),
  -- fire JOINER when this status field changes TO this value
  -- example: 'active' → fires when status becomes 'active'
  UNIQUE(tenant_id)
);

-- Seed default joiner config for demo tenant
INSERT INTO joiner_trigger_config (tenant_id, trigger_mode, pre_provision_days, window_days)
SELECT '00000000-0000-0000-0000-000000000001', 'immediate', 0, 1
ON CONFLICT (tenant_id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 10: TASK DEFINITIONS
-- All task types: aggregation, identity refresh, NCD scan, SoD scan etc.
-- Customer creates, schedules, and executes tasks from Tasks page
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_definitions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  task_type           VARCHAR(100) NOT NULL,
  -- 'identity_refresh' | 'full_aggregation' | 'delta_aggregation'
  -- 'single_account_agg' | 'ncd_scan' | 'sod_scan' | 'risk_score_refresh'
  -- 'deprovision_terminated' | 'expire_temporary_access' | 'dormant_detection'
  -- 'orphan_detection' | 'cert_campaign_launch' | 'retry_failed_provisions'
  -- 'attribute_sync' | 'manager_refresh' | 'role_refresh' | 'custom'
  description         TEXT,
  config              JSONB DEFAULT '{}',
  -- full task config — all options customer set
  -- example for identity_refresh:
  -- {
  --   scope: 'all' | 'filter' | 'population' | 'needs_refresh_only',
  --   filter_expression: "department == 'Finance'",
  --   population_id: null,
  --   last_refresh_before: null,
  --   last_refresh_hours_ago: null,
  --   operations: {
  --     refresh_attributes: true,
  --     refresh_entitlements: true,
  --     refresh_manager: true,
  --     refresh_roles: true,
  --     refresh_detected_roles: true,
  --     provision_assignments: true,
  --     sync_attributes: true,
  --     refresh_risk_score: true,
  --     check_policies: true,
  --     process_lifecycle_events: true,
  --     maintain_identity_history: true,
  --     refresh_group_scorecards: true,
  --     clean_stale_groups: false
  --   },
  --   performance: {
  --     thread_count: 10,
  --     partition_count: 4,
  --     loss_limit_pct: 10
  --   }
  -- }
  schedule_cron       VARCHAR(100),
  -- standard cron: '0 2 * * *' = daily at 2am
  schedule_enabled    BOOLEAN DEFAULT false,
  next_run_at         TIMESTAMPTZ,
  last_run_at         TIMESTAMPTZ,
  last_run_status     VARCHAR(50),
  last_run_result     JSONB DEFAULT '{}',
  -- { total: 1000, success: 998, failed: 2, skipped: 0, duration_ms: 272000 }
  is_active           BOOLEAN DEFAULT true,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_task_def_tenant
  ON task_definitions(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_task_def_schedule
  ON task_definitions(schedule_enabled, next_run_at)
  WHERE schedule_enabled = true;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 11: TASK RESULTS
-- One row per task execution — parent record
-- Child records in task_subtask_results for per-user per-app detail
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_results (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_definition_id  UUID REFERENCES task_definitions(id) ON DELETE SET NULL,
  task_name           VARCHAR(255) NOT NULL,
  -- stored separately so renames don't affect history
  task_type           VARCHAR(100) NOT NULL,
  status              VARCHAR(50) DEFAULT 'running',
  -- 'running' | 'success' | 'failed' | 'partial' | 'cancelled'
  triggered_by        VARCHAR(50) DEFAULT 'manual',
  -- 'scheduler' | 'manual' | 'api' | 'post_aggregation'
  triggered_by_user   UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  duration_ms         INTEGER,
  config_snapshot     JSONB DEFAULT '{}',
  -- snapshot of config at time of execution
  -- so you can see exactly what options were used
  summary             JSONB DEFAULT '{}',
  -- { total: 1000, success: 998, failed: 2, skipped: 0 }
  error_detail        TEXT,
  -- top-level error if task failed to start
  loss_limit_triggered BOOLEAN DEFAULT false,
  -- true if task stopped due to loss limit protection
  is_downloaded       BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_task_results_tenant
  ON task_results(tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_results_status
  ON task_results(tenant_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_results_definition
  ON task_results(task_definition_id, started_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 12: TASK SUBTASK RESULTS
-- One row per sub-operation per user/app per execution
-- This powers the expandable detail view and downloadable CSV
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_subtask_results (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_result_id      UUID NOT NULL REFERENCES task_results(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subtask_name        VARCHAR(255) NOT NULL,
  -- 'Refresh Attributes' | 'Process Lifecycle' | 'SoD Check'
  -- 'Provision to AD' | 'Single Account Aggregation' etc.
  status              VARCHAR(50) DEFAULT 'pending',
  -- 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  target_type         VARCHAR(100),
  -- 'user' | 'connector' | 'application' | 'policy'
  target_id           UUID,
  -- user_id or connector_id or application_id
  target_name         VARCHAR(255),
  -- username or connector name — stored for display after deletions
  event_type          VARCHAR(50),
  -- 'JOINER' | 'LEAVER' | 'MOVER' etc. — for lifecycle subtasks
  application_id      UUID REFERENCES applications(id) ON DELETE SET NULL,
  application_name    VARCHAR(200),
  -- for provisioning subtasks — which app was processed
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  duration_ms         INTEGER,
  items_processed     INTEGER DEFAULT 0,
  items_success       INTEGER DEFAULT 0,
  items_failed        INTEGER DEFAULT 0,
  items_skipped       INTEGER DEFAULT 0,
  error_message       TEXT,
  detail              JSONB DEFAULT '{}'
  -- full detail for download and VIEW screen
  -- example: {
  --   accountCreated: true,
  --   accountId: 'CN=john.smith,OU=Finance,DC=corp,DC=com',
  --   entitlementsGranted: ['Domain Users', 'Finance-ReadOnly'],
  --   entitlementsFailed: [],
  --   attributesSet: { department: 'Finance', manager: 'CN=jane...' }
  -- }
);

CREATE INDEX IF NOT EXISTS idx_subtask_result_parent
  ON task_subtask_results(task_result_id, subtask_name);

CREATE INDEX IF NOT EXISTS idx_subtask_result_status
  ON task_subtask_results(tenant_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_subtask_result_target
  ON task_subtask_results(target_id, started_at DESC)
  WHERE target_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 13: IDENTITY HISTORY
-- Audit trail of every attribute state at every refresh
-- Enables: "what did this user's profile look like on March 1?"
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS identity_history (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_at         TIMESTAMPTZ DEFAULT NOW(),
  trigger             VARCHAR(100),
  -- 'refresh_task' | 'aggregation' | 'manual' | 'lifecycle_event'
  trigger_detail      VARCHAR(255),
  -- additional context: task name, aggregation job name etc.
  attributes_snapshot JSONB DEFAULT '{}',
  -- full attribute values at this point in time
  roles_snapshot      JSONB DEFAULT '[]',
  -- [ { roleId, roleName, roleType, assignedAt, expiresAt } ]
  entitlements_count  INTEGER DEFAULT 0,
  risk_score          INTEGER DEFAULT 0,
  identity_status     VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_identity_history_user
  ON identity_history(user_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_identity_history_tenant
  ON identity_history(tenant_id, snapshot_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 14: APPLICATION LIFECYCLE CONFIG
-- Per-application configuration for each lifecycle event type
-- What action to take for THIS app when JOINER/LEAVER/MOVER etc. fires
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS application_lifecycle_config (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id      UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type          VARCHAR(50) NOT NULL,
  -- 'JOINER' | 'LEAVER' | 'MOVER' | 'REHIRE' | 'NCD'
  -- 'LEAVE_OF_ABSENCE' | 'RETURN_FROM_LEAVE' | 'TRANSFER' | 'DORMANT'
  -- or any custom event key
  action              VARCHAR(100) DEFAULT 'skip',
  -- 'create_account'   → create account + grant entitlements
  -- 'disable_account'  → disable account in target system
  -- 'enable_account'   → enable account in target system
  -- 'delete_account'   → permanently delete account
  -- 'sync_attributes'  → push attribute changes to app
  -- 'deprovision'      → remove all access
  -- 'skip'             → do nothing for this event on this app
  -- 'manual'           → flag for manual review, create work item
  action_config       JSONB DEFAULT '{}',
  -- additional config per action:
  -- For LEAVER disable_account:
  --   { delay_days: 30, reset_password: true }
  -- For REHIRE enable_account:
  --   { restore_previous_entitlements: true, force_password_reset: true }
  -- For MOVER sync_attributes:
  --   { attributes: ['department', 'manager', 'title'] }
  provisioning_policy_id UUID REFERENCES provisioning_policies(id) ON DELETE SET NULL,
  is_active           BOOLEAN DEFAULT true,
  UNIQUE(application_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_app_lifecycle_config_app
  ON application_lifecycle_config(application_id, event_type);

CREATE INDEX IF NOT EXISTS idx_app_lifecycle_config_tenant
  ON application_lifecycle_config(tenant_id, event_type);


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 15: NEW CAPABILITIES
-- Seed new capabilities for the new pages
-- All use ON CONFLICT DO NOTHING — safe on existing DB
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO platform_capabilities
  (tenant_id, capability_key, display_name, category, description)
SELECT
  '00000000-0000-0000-0000-000000000001',
  c.capability_key, c.display_name, c.category, c.description
FROM (VALUES
  ('lifecycle.manage',
   'Manage Lifecycle Events',
   'operations',
   'Create, edit, and configure lifecycle event definitions and workflows'),

  ('lifecycle.trigger',
   'Trigger Lifecycle Events',
   'operations',
   'Manually trigger lifecycle events for identities'),

  ('tasks.view',
   'View Tasks',
   'operations',
   'View task definitions, schedules, and results (read only)'),

  ('tasks.manage',
   'Manage Tasks',
   'operations',
   'Create, edit, delete, and schedule tasks'),

  ('tasks.execute',
   'Execute Tasks',
   'operations',
   'Run tasks manually in the background'),

  ('tasks.results.download',
   'Download Task Results',
   'operations',
   'Download task result reports as CSV'),

  ('workflow.canvas',
   'Workflow Canvas Builder',
   'operations',
   'Access the drag-and-drop workflow canvas to build lifecycle workflows'),

  ('applications.lifecycle.config',
   'Configure Application Lifecycle',
   'identity',
   'Configure per-application behavior for each lifecycle event type'),

  ('ncd.manage',
   'Manage NCD Incidents',
   'governance',
   'Review and remediate Native Change Detection incidents'),

  ('identity.history.view',
   'View Identity History',
   'identity',
   'View historical snapshots of identity attributes and role assignments')
) AS c(capability_key, display_name, category, description)
ON CONFLICT (tenant_id, capability_key) DO NOTHING;

-- Grant all new capabilities to Super Admin and IAM Admin roles
UPDATE roles
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'),
  '{capabilities}',
  CASE name
    WHEN 'Super Admin' THEN '["*"]'::jsonb
    WHEN 'IAM Admin' THEN (
      COALESCE(metadata->'capabilities', '[]'::jsonb) ||
      '["lifecycle.manage","lifecycle.trigger","tasks.view","tasks.manage",
        "tasks.execute","tasks.results.download","workflow.canvas",
        "applications.lifecycle.config","ncd.manage","identity.history.view"]'::jsonb
    )
    WHEN 'Auditor' THEN (
      COALESCE(metadata->'capabilities', '[]'::jsonb) ||
      '["tasks.view","tasks.results.download","identity.history.view","ncd.manage"]'::jsonb
    )
    ELSE metadata->'capabilities'
  END
)
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND name IN ('Super Admin', 'IAM Admin', 'Auditor');


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 16: INDEXES ON NEW TABLES
-- All performance indexes for Phase 5 tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Users new columns
CREATE INDEX IF NOT EXISTS idx_users_needs_refresh
  ON users(tenant_id, needs_refresh)
  WHERE needs_refresh = true;

CREATE INDEX IF NOT EXISTS idx_users_is_new_identity
  ON users(tenant_id, is_new_identity)
  WHERE is_new_identity = true;

CREATE INDEX IF NOT EXISTS idx_users_identity_status
  ON users(tenant_id, identity_status);

CREATE INDEX IF NOT EXISTS idx_users_start_date
  ON users(tenant_id, start_date)
  WHERE start_date IS NOT NULL;

-- NCD incidents
CREATE INDEX IF NOT EXISTS idx_ncd_pending
  ON ncd_incidents(tenant_id, status, detected_at DESC)
  WHERE status = 'pending_review';

-- Lifecycle event queue — worker polling index (most critical)
CREATE INDEX IF NOT EXISTS idx_leq_worker_poll
  ON lifecycle_event_queue(status, next_retry_at, locked_until)
  WHERE status IN ('pending', 'failed');

-- Workflow executions — resume polling
CREATE INDEX IF NOT EXISTS idx_wf_exec_resume
  ON workflow_executions(status, resume_at)
  WHERE status = 'waiting';

-- Task definitions — scheduler polling
CREATE INDEX IF NOT EXISTS idx_task_def_next_run
  ON task_definitions(next_run_at, schedule_enabled)
  WHERE schedule_enabled = true AND is_active = true;

-- Task results — recent results per task
CREATE INDEX IF NOT EXISTS idx_task_results_recent
  ON task_results(task_definition_id, started_at DESC)
  WHERE task_definition_id IS NOT NULL;

-- Identity history — time range queries
CREATE INDEX IF NOT EXISTS idx_identity_history_range
  ON identity_history(tenant_id, user_id, snapshot_at DESC);

ALTER TABLE task_definitions ADD COLUMN IF NOT EXISTS previous_result_action VARCHAR(20) DEFAULT 'delete_latest';

-- ─── Ensure users.source allows jdbc and api (safe for existing DBs) ──────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_source_check;
ALTER TABLE users ADD CONSTRAINT users_source_check
  CHECK (source IN ('local','ldap','saml','oidc','scim','jdbc','api'));

-- ─── Ensure users.source column exists (for very old DBs) ────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS source VARCHAR(100) DEFAULT 'local';

-- ─────────────────────────────────────────────────────────────────────────────
-- END PHASE 5 — LIFECYCLE EVENTS ENGINE SCHEMA
-- Total new tables: 14
-- Total new columns on users: 9
-- Total new indexes: 26
-- Total new capabilities: 10
-- ─────────────────────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────────
-- NexusIAM Workflow Canvas — Additional Schema
-- Append this to the END of your init.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Workflow modification history table
CREATE TABLE IF NOT EXISTS workflow_modification_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  modified_by     UUID REFERENCES users(id),
  modified_at     TIMESTAMPTZ DEFAULT NOW(),
  change_summary  TEXT,
  steps_before    JSONB DEFAULT '[]',
  steps_after     JSONB DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_workflow_mod_history_workflow
  ON workflow_modification_history(workflow_id, modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_mod_history_tenant
  ON workflow_modification_history(tenant_id, modified_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_links_connector_native_type
  ON account_links(connector_id, native_identity, object_type);

ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

-- Add canvas position data support to workflow_definitions (already stored in steps[].canvas)
-- No schema change needed — steps JSONB already supports per-step canvas positions

-- ─────────────────────────────────────────────────────────────────────────────
-- END WORKFLOW CANVAS SCHEMA
-- ─────────────────────────────────────────────────────────────────────────────
-- =============================================================================
-- MOVER / LCE PHASE 2 — APPROVAL, CANVAS, EMAIL & WORKITEM ENHANCEMENTS
-- All statements use IF NOT EXISTS / ON CONFLICT — safe to run on live DBs
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LCE APPROVAL CONFIG
-- Generic per-event-type approval routing. Replaces hardcoded manager logic.
-- Supports: manager | user | workgroup | app_owner | custom_role | none
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lce_approval_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type            VARCHAR(50) NOT NULL,
  -- 'MOVER' | 'LEAVER' | 'REHIRE' | 'NCD' | 'JOINER' | any custom key
  enabled               BOOLEAN DEFAULT true,
  -- If false: no approval work item created, auto-proceed
  approver_type         VARCHAR(50) DEFAULT 'manager',
  -- 'manager'      → user's direct manager
  -- 'user'         → specific user by user_id
  -- 'workgroup'    → all members of workgroup (if empty → fallback)
  -- 'app_owner'    → owner of each affected application
  -- 'custom_role'  → any user with this NexusIAM role
  -- 'none'         → skip approval entirely
  approver_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  -- used when approver_type = 'user'
  approver_workgroup_id UUID REFERENCES workgroups(id) ON DELETE SET NULL,
  -- used when approver_type = 'workgroup'
  approver_role_name    VARCHAR(255),
  -- used when approver_type = 'custom_role'
  fallback_type         VARCHAR(50) DEFAULT 'none',
  -- what to do if primary approver resolves to NULL
  -- 'none' | 'user' | 'workgroup' | 'auto_approve' | 'auto_reject'
  fallback_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  fallback_workgroup_id UUID REFERENCES workgroups(id) ON DELETE SET NULL,
  reminder_days         INTEGER DEFAULT 2,
  escalation_days       INTEGER DEFAULT 5,
  auto_expire_days      INTEGER DEFAULT 7,
  -- email notification toggles
  notify_approver       BOOLEAN DEFAULT true,
  notify_requester      BOOLEAN DEFAULT true,
  notify_on_approve     BOOLEAN DEFAULT true,
  notify_on_reject      BOOLEAN DEFAULT true,
  notify_on_escalation  BOOLEAN DEFAULT true,
  -- Super admins always have full privileges (approve/reject/forward)
  -- This config controls regular approvers
  allow_forward         BOOLEAN DEFAULT true,
  allow_partial_approve BOOLEAN DEFAULT false,
  -- UI-level instruction shown to approver
  approver_instructions TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_lce_approval_config_tenant
  ON lce_approval_config(tenant_id, event_type);

-- Seed defaults for demo tenant
INSERT INTO lce_approval_config
  (tenant_id, event_type, enabled, approver_type, fallback_type,
   reminder_days, escalation_days, auto_expire_days)
SELECT
  '00000000-0000-0000-0000-000000000001',
  ev.event_type, true, 'manager', 'auto_approve', 2, 5, 7
FROM (VALUES ('MOVER'),('LEAVER'),('REHIRE'),('NCD'),('JOINER')) AS ev(event_type)
ON CONFLICT (tenant_id, event_type) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LCE WORKFLOW CANVAS CONFIG
-- Global per-event-type canvas options.
-- Stored as JSONB for extensibility — no schema change needed to add options.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lce_canvas_config (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type               VARCHAR(50) NOT NULL,
  -- Role inclusion options
  include_birthright_roles  BOOLEAN DEFAULT true,
  include_business_roles    BOOLEAN DEFAULT true,
  -- When true: show role → entitlement tooltip in work item UI
  show_role_entitlements    BOOLEAN DEFAULT true,
  -- When false: only show entitlements NOT part of any role
  include_role_entitlements BOOLEAN DEFAULT true,
  -- Application exclusion: array of application UUIDs to skip
  excluded_application_ids  JSONB DEFAULT '[]',
  -- Entitlement exclusion: array of entitlement UUIDs to skip
  excluded_entitlement_ids  JSONB DEFAULT '[]',
  -- Custom entitlement filters: only process entitlements matching these
  -- Array of: { field: 'custom_RiskLevel', operator: 'equals', value: 'High' }
  -- Supported operators: equals, not_equals, contains, in, exists
  entitlement_filters       JSONB DEFAULT '[]',
  -- Extensible catch-all for future options
  extra_config              JSONB DEFAULT '{}',
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_lce_canvas_config_tenant
  ON lce_canvas_config(tenant_id, event_type);

-- Seed defaults
INSERT INTO lce_canvas_config
  (tenant_id, event_type, include_birthright_roles, include_business_roles,
   show_role_entitlements, include_role_entitlements)
SELECT
  '00000000-0000-0000-0000-000000000001',
  ev.event_type, true, true, true, true
FROM (VALUES ('MOVER'),('LEAVER'),('REHIRE'),('NCD'),('JOINER')) AS ev(event_type)
ON CONFLICT (tenant_id, event_type) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. MOVER TRIGGER CONFIG — add specific value mode columns
-- specific_value_mode: 'static' = plain text, 'beanshell' = script
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE mover_trigger_config
  ADD COLUMN IF NOT EXISTS specific_value_mode VARCHAR(20) DEFAULT 'static';
  -- 'static'    → from_values/to_values are plain strings
  -- 'beanshell' → from_code/to_code are BeanShell scripts returning boolean

ALTER TABLE mover_trigger_config
  ADD COLUMN IF NOT EXISTS from_code TEXT;
  -- BeanShell code: return true if 'previousValue' matches condition
  -- Available vars: previousValue, currentValue, user, context

ALTER TABLE mover_trigger_config
  ADD COLUMN IF NOT EXISTS to_code TEXT;
  -- BeanShell code: return true if 'currentValue' matches condition

ALTER TABLE mover_trigger_config
  ADD COLUMN IF NOT EXISTS description TEXT;
  -- optional customer description of what this trigger does


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. WORK ITEMS — add LCE-specific columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS workgroup_id UUID REFERENCES workgroups(id) ON DELETE SET NULL;
  -- set when work item assigned to a whole workgroup (not individual)

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS lce_event_queue_id UUID REFERENCES lifecycle_event_queue(id) ON DELETE SET NULL;
  -- links back to the lifecycle event that created this work item

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS entitlement_snapshot JSONB DEFAULT '[]';
  -- bundle: array of { entitlement_id, value, type, application_name,
  --                    requestable, classification, roles: [...],
  --                    custom_metadata, action: 'add'|'remove'|'review' }

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS role_snapshot JSONB DEFAULT '[]';
  -- bundle: array of { role_id, name, type, entitlements: [...],
  --                    action: 'add'|'remove' }

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS forwarded_from UUID REFERENCES users(id) ON DELETE SET NULL;
  -- tracks who forwarded this item

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS forwarded_at TIMESTAMPTZ;

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS escalated_to UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS partial_decisions JSONB DEFAULT '[]';
  -- for partial approval: array of { entitlement_id, decision, decided_by, decided_at }

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_work_items_lce_queue
  ON work_items(lce_event_queue_id)
  WHERE lce_event_queue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_workgroup
  ON work_items(workgroup_id)
  WHERE workgroup_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_assignee_status
  ON work_items(assignee_id, status, tenant_id);

CREATE INDEX IF NOT EXISTS idx_work_items_tenant_type_status
  ON work_items(tenant_id, type, status);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. LCE EMAIL TEMPLATES
-- Reusable per-event-type email templates configurable from UI
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lce_email_templates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type    VARCHAR(50) NOT NULL,
  template_type VARCHAR(50) NOT NULL,
  -- 'approval_request' | 'reminder' | 'escalation' | 'approved' | 'rejected'
  -- 'forwarded' | 'auto_approved' | 'auto_rejected' | 'event_notification'
  subject       TEXT NOT NULL,
  body_html     TEXT,
  -- NULL = use system default template
  enabled       BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, event_type, template_type)
);

CREATE INDEX IF NOT EXISTS idx_lce_email_templates_tenant
  ON lce_email_templates(tenant_id, event_type, template_type);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. LCE SCHEDULED REMINDERS / ESCALATIONS
-- Tracks pending work items needing reminder/escalation
-- Picked up by ScheduledJobs.js existing job runner
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lce_work_item_schedule (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_item_id    UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  event_type      VARCHAR(50) NOT NULL,
  reminder_sent_at   TIMESTAMPTZ,
  escalation_sent_at TIMESTAMPTZ,
  escalation_due_at  TIMESTAMPTZ,
  reminder_due_at    TIMESTAMPTZ,
  auto_expire_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(work_item_id)
);

CREATE INDEX IF NOT EXISTS idx_lce_schedule_due
  ON lce_work_item_schedule(tenant_id, reminder_due_at, escalation_due_at)
  WHERE reminder_due_at IS NOT NULL OR escalation_due_at IS NOT NULL;

-- =============================================================================
-- END MOVER / LCE PHASE 2
-- =============================================================================

-- =============================================================================
-- PHASE 6 — LCE FULL EVENT SUPPORT (MOVER/NCD/LEAVER/REHIRE)
-- All statements safe on live DB (IF NOT EXISTS / ON CONFLICT)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LCE EVENT TYPE CONFIG
-- Per-event-type behaviour config (grace period, restore access, etc.)
-- Generic JSONB options column — no schema change needed to add new options
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lce_event_type_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type            VARCHAR(50) NOT NULL,
  -- LEAVER options (stored in options JSONB):
  --   grace_period_days: int (0 = immediate)
  --   delete_after_days: int (0 = never hard delete)
  --   disable_on_leaver: bool
  --   remove_roles_on_leaver: bool
  --   remove_entitlements_on_leaver: bool
  --   excluded_app_ids_from_disable: uuid[]
  -- REHIRE options:
  --   restore_previous_entitlements: bool
  --   restore_previous_roles: bool
  --   rehire_window_days: int (0 = always treat as rehire if prev leaver)
  --   force_birthright_rerun: bool
  -- NCD options:
  --   auto_revoke_on_reject: bool
  --   single_agg_on_detect: bool
  -- MOVER options:
  --   run_single_agg_after: bool
  --   update_manager_on_move: bool
  options               JSONB DEFAULT '{}',
  enabled               BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_lce_event_type_config_tenant
  ON lce_event_type_config(tenant_id, event_type);

-- Seed defaults for all event types
INSERT INTO lce_event_type_config (tenant_id, event_type, options)
SELECT
  '00000000-0000-0000-0000-000000000001',
  ev.event_type,
  ev.options::jsonb
FROM (VALUES
  ('MOVER',  '{"run_single_agg_after":true,"update_manager_on_move":true}'),
  ('LEAVER', '{"grace_period_days":0,"delete_after_days":0,"disable_on_leaver":true,"remove_roles_on_leaver":true,"remove_entitlements_on_leaver":true,"excluded_app_ids_from_disable":[]}'),
  ('REHIRE', '{"restore_previous_entitlements":false,"restore_previous_roles":false,"rehire_window_days":0,"force_birthright_rerun":true}'),
  ('NCD',    '{"auto_revoke_on_reject":true,"single_agg_on_detect":true}'),
  ('JOINER', '{"run_single_agg_after":true}')
) AS ev(event_type, options)
ON CONFLICT (tenant_id, event_type) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WORK ITEM ENTITLEMENTS
-- Per-entitlement rows for work items — supports individual approve/reject
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_item_entitlements (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_item_id        UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Entitlement details (snapshot at time of event — source of truth)
  entitlement_id      UUID,
  -- NULL for discovered/synthetic entitlements not yet managed
  application_id      UUID REFERENCES applications(id) ON DELETE SET NULL,
  application_name    VARCHAR(255),
  entitlement_value   VARCHAR(500) NOT NULL,
  entitlement_type    VARCHAR(100),
  display_name        VARCHAR(500),
  classification      VARCHAR(100),
  -- Risk level from custom_metadata — surfaced for approver
  risk_level          VARCHAR(50),
  -- Role this entitlement belongs to (if any)
  role_id             UUID REFERENCES roles(id) ON DELETE SET NULL,
  role_name           VARCHAR(255),
  role_type           VARCHAR(50),
  -- 'birthright' | 'business' | 'direct' | null
  -- Action being requested for this entitlement
  action              VARCHAR(50) DEFAULT 'review',
  -- 'add' | 'remove' | 'review' | 'revoke'
  -- Decision by approver
  decision            VARCHAR(50) DEFAULT 'pending',
  -- 'pending' | 'approved' | 'rejected' | 'forwarded' | 'skipped'
  decided_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  decision_comments   TEXT,
  forwarded_to_user   UUID REFERENCES users(id) ON DELETE SET NULL,
  forwarded_to_wg     UUID REFERENCES workgroups(id) ON DELETE SET NULL,
  -- Full custom_metadata snapshot for filter display in UI
  custom_metadata     JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wie_work_item
  ON work_item_entitlements(work_item_id, decision);

CREATE INDEX IF NOT EXISTS idx_wie_tenant_pending
  ON work_item_entitlements(tenant_id, decision)
  WHERE decision = 'pending';

CREATE INDEX IF NOT EXISTS idx_wie_entitlement
  ON work_item_entitlements(entitlement_id)
  WHERE entitlement_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. LCE SINGLE AGG LOG
-- Tracks single-account aggregation triggered per user per app after LCE fires
-- Used to verify target system state after provisioning changes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lce_single_agg_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lce_event_queue_id  UUID REFERENCES lifecycle_event_queue(id) ON DELETE SET NULL,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id      UUID REFERENCES applications(id) ON DELETE SET NULL,
  connector_id        UUID REFERENCES connectors(id) ON DELETE SET NULL,
  status              VARCHAR(50) DEFAULT 'pending',
  -- 'pending' | 'running' | 'completed' | 'failed'
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  accounts_found      INTEGER DEFAULT 0,
  error_detail        TEXT,
  result_snapshot     JSONB DEFAULT '{}',
  -- snapshot of account state from target after agg
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lce_single_agg_event
  ON lce_single_agg_log(lce_event_queue_id, status);

CREATE INDEX IF NOT EXISTS idx_lce_single_agg_user
  ON lce_single_agg_log(user_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. LCE FAILURE LOG
-- Every provisioning or workflow failure is captured here
-- Admin work item + admin email triggered from this table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lce_failure_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lce_event_queue_id  UUID REFERENCES lifecycle_event_queue(id) ON DELETE SET NULL,
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type          VARCHAR(50),
  application_id      UUID REFERENCES applications(id) ON DELETE SET NULL,
  application_name    VARCHAR(255),
  -- Which step failed
  step_type           VARCHAR(100),
  step_index          INTEGER,
  -- Error detail from target system — never swallow, always surface
  error_message       TEXT,
  error_code          VARCHAR(100),
  target_system_response JSONB DEFAULT '{}',
  -- Was admin notified?
  admin_notified      BOOLEAN DEFAULT false,
  admin_work_item_id  UUID REFERENCES work_items(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lce_failure_tenant
  ON lce_failure_log(tenant_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lce_failure_notified
  ON lce_failure_log(tenant_id, admin_notified)
  WHERE admin_notified = false;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. LCE CANVAS CONFIG — add missing event-specific columns
-- Extra options needed for LEAVER, REHIRE, NCD not in original schema
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lce_canvas_config
  ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 0;
  -- LEAVER: how many days before deprovisioning starts

ALTER TABLE lce_canvas_config
  ADD COLUMN IF NOT EXISTS restore_previous_access BOOLEAN DEFAULT false;
  -- REHIRE: restore entitlements from last LEAVER snapshot

ALTER TABLE lce_canvas_config
  ADD COLUMN IF NOT EXISTS single_agg_after_action BOOLEAN DEFAULT true;
  -- All events: run single-account agg per app to verify target state

ALTER TABLE lce_canvas_config
  ADD COLUMN IF NOT EXISTS custom_workflow_steps JSONB DEFAULT '[]';
  -- Array of customer-defined extra steps:
  -- [{ step_type: 'RUN_SCRIPT', label: 'My Step',
  --    config: { script_id: '...' },
  --    condition: { mode: 'beanshell', code: 'return user.department == "Finance";' },
  --    enabled: true, order: 99 }]

ALTER TABLE lce_canvas_config
  ADD COLUMN IF NOT EXISTS notify_failure_to_admins BOOLEAN DEFAULT true;
  -- Send failure emails + create work items for super admins on any error

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. LCE APPROVAL CONFIG — add email config columns (moved here from separate table)
-- So email settings live alongside approval settings in one UI tab
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lce_approval_config
  ADD COLUMN IF NOT EXISTS email_subject_prefix VARCHAR(100) DEFAULT 'NexusIAM';
  -- prefix for all email subjects for this event type

ALTER TABLE lce_approval_config
  ADD COLUMN IF NOT EXISTS notify_admin_on_failure BOOLEAN DEFAULT true;

ALTER TABLE lce_approval_config
  ADD COLUMN IF NOT EXISTS cc_manager_on_approval BOOLEAN DEFAULT false;

ALTER TABLE lce_approval_config
  ADD COLUMN IF NOT EXISTS approver_instructions TEXT;
  -- shown in work item UI to guide approver (may already exist, safe)


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. LIFECYCLE EVENT QUEUE — add canvas snapshot for audit trail
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lifecycle_event_queue
  ADD COLUMN IF NOT EXISTS canvas_config_snapshot JSONB DEFAULT '{}';
  -- snapshot of lce_canvas_config at time of event firing
  -- guarantees audit trail even if config changes later

ALTER TABLE lifecycle_event_queue
  ADD COLUMN IF NOT EXISTS approval_config_snapshot JSONB DEFAULT '{}';
  -- snapshot of lce_approval_config at time of event firing

ALTER TABLE lifecycle_event_queue
  ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;
  -- count of provisioning failures across all steps

ALTER TABLE lifecycle_event_queue
  ADD COLUMN IF NOT EXISTS admin_notified BOOLEAN DEFAULT false;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. LEAVER ACCESS SNAPSHOT
-- Before deprovisioning, capture full access state for potential REHIRE restore
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaver_access_snapshot (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lce_event_queue_id  UUID REFERENCES lifecycle_event_queue(id) ON DELETE SET NULL,
  -- Full snapshot of roles at time of LEAVER
  roles_snapshot      JSONB DEFAULT '[]',
  -- Array of { role_id, name, type, assigned_at }
  -- Full snapshot of entitlements at time of LEAVER
  entitlements_snapshot JSONB DEFAULT '[]',
  -- Array of { entitlement_id, value, application_id, application_name, type }
  -- Full snapshot of account states per app
  accounts_snapshot   JSONB DEFAULT '[]',
  -- Array of { application_id, native_identity, status, attributes }
  snapshot_at         TIMESTAMPTZ DEFAULT NOW(),
  -- How long to retain this snapshot (for REHIRE window)
  expires_at          TIMESTAMPTZ,
  UNIQUE(tenant_id, user_id, lce_event_queue_id)
);

CREATE INDEX IF NOT EXISTS idx_leaver_snapshot_user
  ON leaver_access_snapshot(user_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_leaver_snapshot_tenant
  ON leaver_access_snapshot(tenant_id, snapshot_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. MOVER TRIGGER CONFIG — script language support
-- Adds 'javascript' option alongside existing 'beanshell'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE mover_trigger_config
  ADD COLUMN IF NOT EXISTS script_language VARCHAR(20) DEFAULT 'beanshell';
  -- 'beanshell' | 'javascript' — consistent with provisioning policies

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. CAPABILITIES — new LCE capabilities for role-based access
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO platform_capabilities
  (tenant_id, capability_key, display_name, category, description)
SELECT
  '00000000-0000-0000-0000-000000000001',
  c.capability_key, c.display_name, c.category, c.description
FROM (VALUES
  ('lce.approval.config',
   'Configure LCE Approval Routing',
   'operations',
   'Configure approval routing, reminders, and escalations for lifecycle events'),
  ('lce.canvas.config',
   'Configure LCE Canvas',
   'operations',
   'Configure workflow canvas options for lifecycle events'),
  ('lce.email.config',
   'Configure LCE Email Templates',
   'operations',
   'Configure email templates and notification settings for lifecycle events'),
  ('lce.workitems.view',
   'View LCE Work Items',
   'governance',
   'View lifecycle event approval work items'),
  ('lce.workitems.action',
   'Act on LCE Work Items',
   'governance',
   'Approve, reject, or forward lifecycle event work items'),
  ('lce.failures.view',
   'View LCE Failures',
   'operations',
   'View lifecycle event provisioning failures and target system errors'),
  ('lce.single.agg',
   'Trigger Single Account Aggregation',
   'operations',
   'Trigger single-account aggregation per app after lifecycle event'),
  ('lce.snapshot.view',
   'View Access Snapshots',
   'governance',
   'View leaver access snapshots for rehire restore decisions')
) AS c(capability_key, display_name, category, description)
ON CONFLICT (tenant_id, capability_key) DO NOTHING;

-- Grant new LCE capabilities to Super Admin and IAM Admin
UPDATE roles
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'),
  '{capabilities}',
  CASE name
    WHEN 'Super Admin' THEN '["*"]'::jsonb
    WHEN 'IAM Admin' THEN (
      COALESCE(metadata->'capabilities', '[]'::jsonb) ||
      '["lce.approval.config","lce.canvas.config","lce.email.config","lce.workitems.view","lce.workitems.action","lce.failures.view","lce.single.agg","lce.snapshot.view"]'::jsonb
    )
    WHEN 'Auditor' THEN (
      COALESCE(metadata->'capabilities', '[]'::jsonb) ||
      '["lce.workitems.view","lce.failures.view","lce.snapshot.view"]'::jsonb
    )
    ELSE metadata->'capabilities'
  END
)
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND name IN ('Super Admin', 'IAM Admin', 'Auditor');

-- =============================================================================
-- END PHASE 6 — LCE FULL EVENT SUPPORT
-- New tables: lce_event_type_config, work_item_entitlements,
--             lce_single_agg_log, lce_failure_log, leaver_access_snapshot
-- Altered tables: lce_canvas_config, lce_approval_config,
--                 lifecycle_event_queue, mover_trigger_config, work_items
-- New capabilities: 8
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 6 PATCH — Add failure digest config columns to lce_approval_config
-- These control the scheduler's admin notification behaviour per tenant/event
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE lce_approval_config
  ADD COLUMN IF NOT EXISTS failure_digest_delay_minutes INTEGER DEFAULT 10;
  -- How many minutes after a failure before sending admin notification
  -- Default: 10 min (gives time for transient errors to self-resolve)

ALTER TABLE lce_approval_config
  ADD COLUMN IF NOT EXISTS failure_digest_batch_size INTEGER DEFAULT 50;
  -- Max failures to include in one digest email per run
  -- Default: 50 (prevents enormous emails on bulk failure events)

-- ─────────────────────────────────────────────────────────────────────────────
-- MOVER match_mode global config table
-- Stores OR/AND trigger mode per tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mover_global_config (
  tenant_id  UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  match_mode VARCHAR(10) DEFAULT 'any', -- 'any' = OR, 'all' = AND
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed demo tenant default
INSERT INTO mover_global_config (tenant_id, match_mode)
VALUES ('00000000-0000-0000-0000-000000000001', 'any')
ON CONFLICT (tenant_id) DO NOTHING;

-- Add description column to mover_trigger_config if missing
ALTER TABLE mover_trigger_config ADD COLUMN IF NOT EXISTS description TEXT;