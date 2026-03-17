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
  source VARCHAR(50) DEFAULT 'local' CHECK (source IN ('local','ldap','saml','oidc','scim')),
  external_id VARCHAR(255),
  attributes JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, username),
  UNIQUE(tenant_id, email)
);
