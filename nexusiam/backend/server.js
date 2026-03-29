require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { collectDefaultMetrics, register } = require('prom-client');

const logger = require('./config/logger');
const db = require('./config/database');
const redisClient = require('./config/redis');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const applicationRoutes = require('./routes/applications');
const accessRequestRoutes = require('./routes/accessRequests');
const passwordPolicyRoutes = require('./routes/passwordPolicy');
const accessRequestSettingsRoutes = require('./routes/accessRequestSettings');
const entitlementRoutes = require('./routes/entitlements');
const certificationRoutes = require('./routes/certifications');
const policyRoutes = require('./routes/policies');
const auditRoutes = require('./routes/audit');
const connectorRoutes = require('./routes/connectors');
const pluginRoutes = require('./routes/plugins');
const cabRoutes = require('./routes/cab');
const dashboardRoutes = require('./routes/dashboard');
const scimRoutes = require('./routes/scim');
const notificationRoutes = require('./routes/notifications');
const logRoutes = require('./routes/logs');
const reportRoutes = require('./routes/reports');
const studioRoutes = require('./routes/studio');
const developerConsoleRoutes = require('./routes/developerConsole');
const lifecycleRoutes = require('./routes/lifecycle');
const aggregationRoutes = require('./routes/aggregations');
const capabilityRoutes = require('./routes/capabilities');
const provisioningRoutes = require('./routes/provisioning');
const provisioningPolicyRoutes = require('./routes/provisioningPolicies');
const workgroupRoutes = require('./routes/workgroups');
const identityMappingRoutes = require('./routes/identityMapping');
const lifecycleEventRoutes = require('./routes/lifecycleEvents');
const accountLinksRoutes = require('./routes/accountLinks');
const securityRoutes = require('./routes/security');
const samlRoutes = require('./routes/saml');
const { startScheduledJobs } = require('./services/ScheduledJobs');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy headers in Docker/dev so rate limiting and auth work correctly
const trustProxyValue = process.env.TRUST_PROXY;
if (trustProxyValue === 'true') {
  app.set('trust proxy', 1);
} else if (trustProxyValue === 'false') {
  app.set('trust proxy', false);
} else {
  app.set('trust proxy', 1);
}

// Prometheus metrics
collectDefaultMetrics();

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(compression());

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 500),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── HTTP request logging ─────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

// ─── Swagger docs ─────────────────────────────────────────────────────────────
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'NexusIAM API',
      version: '1.0.0',
      description: 'Complete IAM Platform API',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./routes/*.js'],
};
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── Prometheus metrics endpoint ──────────────────────────────────────────────
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: {
        database: 'connected',
        redis: redisClient.isOpen ? 'connected' : 'disconnected',
      },
    });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────
const V1 = '/api/v1';
app.use(`${V1}/auth`, authRoutes);
app.use(`${V1}/users`, userRoutes);
app.use(`${V1}/roles`, roleRoutes);
app.use(`${V1}/applications`, applicationRoutes);
app.use(`${V1}/access-requests`, accessRequestRoutes);
app.use(`${V1}/password-policy`, passwordPolicyRoutes);
app.use(`${V1}/access-request-settings`, accessRequestSettingsRoutes);
app.use(`${V1}/certifications`, certificationRoutes);
app.use(`${V1}/policies`, policyRoutes);
app.use(`${V1}/audit`, auditRoutes);
app.use(`${V1}/entitlements`, entitlementRoutes);
app.use(`${V1}/connectors`, connectorRoutes);
app.use(`${V1}/plugins`, pluginRoutes);
app.use(`${V1}/cab`, cabRoutes);
app.use(`${V1}/dashboard`, dashboardRoutes);
app.use(`${V1}/notifications`, notificationRoutes);
app.use(`${V1}/logs`, logRoutes);
app.use(`${V1}/reports`, reportRoutes);
app.use(`${V1}/studio`, studioRoutes);
app.use(`${V1}/developer-console`, developerConsoleRoutes);
app.use(`${V1}/lifecycle`, lifecycleRoutes);
app.use(`${V1}/aggregations`, aggregationRoutes);
app.use(`${V1}/capabilities`, capabilityRoutes);
app.use(`${V1}/provisioning`, provisioningRoutes);
app.use(`${V1}/provisioning-policies`, provisioningPolicyRoutes);
app.use(`${V1}/workgroups`, workgroupRoutes);
app.use(`${V1}/identity-mapping`, identityMappingRoutes);
app.use(`${V1}/lifecycle-events`, lifecycleEventRoutes);
app.use(`${V1}/account-links`, accountLinksRoutes);
app.use(`${V1}/security`, securityRoutes);
app.use(`${V1}/auth/saml`, samlRoutes);

// SCIM 2.0 endpoint (no version prefix, standard path)
app.use('/scim/v2', scimRoutes);

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', { error: err.message, stack: err.stack, path: req.path });
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    correlationId: req.headers['x-correlation-id'] || 'N/A',
  });
});


async function backfillPlatformData() {
  try {
    await db.query(`
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
        ('studio.manage','Platform Studio','studio','Manage workflows, forms, scripts')
      ) AS x(capability_key, display_name, category, description)
      WHERE NOT EXISTS (
        SELECT 1 FROM platform_capabilities pc WHERE pc.tenant_id='00000000-0000-0000-0000-000000000001' AND pc.capability_key=x.capability_key
      )
    `);
    await db.query(`
      UPDATE roles SET metadata = COALESCE(metadata, '{}'::jsonb) ||
        CASE name
          WHEN 'Super Admin' THEN '{"capabilities":["*"]}'::jsonb
          WHEN 'IAM Admin' THEN '{"capabilities":["dashboard.view","users.manage","applications.manage","connectors.manage","aggregations.run","lifecycle.manage","quicklinks.manage","approvals.work","reports.view","studio.manage","developer.console","admin.capabilities"]}'::jsonb
          WHEN 'Help Desk' THEN '{"capabilities":["dashboard.view","users.manage","approvals.work"]}'::jsonb
          WHEN 'Auditor' THEN '{"capabilities":["dashboard.view","reports.view"]}'::jsonb
          ELSE metadata
        END
      WHERE tenant_id='00000000-0000-0000-0000-000000000001'
    `);
    await db.query(`
      INSERT INTO quick_links (tenant_id, name, icon, route, action_type, enabled, sort_order, config, required_capabilities, created_by)
      SELECT '00000000-0000-0000-0000-000000000001', 'Request Access', 'Shield', '/access-requests', 'navigate', true, 10, '{}'::jsonb, '["approvals.work"]'::jsonb, '00000000-0000-0000-0000-000000000100'
      WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='quick_links')
        AND NOT EXISTS (SELECT 1 FROM quick_links WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND name='Request Access')
    `);
    await db.query(`
      INSERT INTO user_capabilities (tenant_id, user_id, capability_key, grant_type, granted_by)
      SELECT '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000100', '*', 'direct', '00000000-0000-0000-0000-000000000100'
      WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='user_capabilities')
        AND NOT EXISTS (SELECT 1 FROM user_capabilities WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND user_id='00000000-0000-0000-0000-000000000100' AND capability_key='*')
    `);
    if (process.env.SEED_DEMO_DATA === 'true') {
      logger.info('Demo seed flag enabled, but no demo connector/application data is auto-created by server backfill.');
    }
  } catch (err) {
    logger.warn('Platform backfill skipped', { error: err.message });
  }
}

// ─── V20.5 Migrations ─────────────────────────────────────────────────────────
async function migrateV205() {
  try {
    // Update roles type constraint
    await db.query(`ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_type_check`);
    await db.query(`ALTER TABLE roles ADD CONSTRAINT roles_type_check CHECK (type IN ('system','business','it','birthright'))`);

    // Create password_policies table
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
        min_length INTEGER DEFAULT 12, max_length INTEGER DEFAULT 128,
        min_letters INTEGER DEFAULT 1, min_digits INTEGER DEFAULT 1,
        min_uppercase INTEGER DEFAULT 1, min_lowercase INTEGER DEFAULT 1,
        min_special INTEGER DEFAULT 1, max_repeated INTEGER DEFAULT 3,
        history_length INTEGER DEFAULT 5, trivial_check BOOLEAN DEFAULT true,
        case_sensitive BOOLEAN DEFAULT true, days_until_expiry INTEGER DEFAULT 90,
        days_until_generated_expiry INTEGER DEFAULT 7, min_hours_between_changes INTEGER DEFAULT 24,
        check_dictionary BOOLEAN DEFAULT false, check_identity_attrs BOOLEAN DEFAULT true,
        min_attr_length INTEGER DEFAULT 3, require_current_password BOOLEAN DEFAULT true,
        enable_hashing BOOLEAN DEFAULT true, hashing_iterations INTEGER DEFAULT 10,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      INSERT INTO password_policies (tenant_id)
      SELECT id FROM tenants WHERE slug='demo'
      ON CONFLICT (tenant_id) DO NOTHING
    `);

    // Create access_request_settings table
    await db.query(`
      CREATE TABLE IF NOT EXISTS access_request_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
        require_manager_approval BOOLEAN DEFAULT true,
        require_entitlement_owner_approval BOOLEAN DEFAULT false,
        allow_self_approval BOOLEAN DEFAULT false,
        max_request_duration_days INTEGER DEFAULT 30,
        reminder_days INTEGER DEFAULT 2, escalation_days INTEGER DEFAULT 5,
        auto_expire_days INTEGER DEFAULT 7, notify_requester BOOLEAN DEFAULT true,
        notify_manager BOOLEAN DEFAULT true, notify_owner BOOLEAN DEFAULT false,
        fallback_approver_id UUID,
        fallback_approver_type VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`ALTER TABLE access_request_settings ADD COLUMN IF NOT EXISTS fallback_approver_id UUID`);
    await db.query(`ALTER TABLE access_request_settings ADD COLUMN IF NOT EXISTS fallback_approver_type VARCHAR(20) DEFAULT 'user'`);
    await db.query(`
      INSERT INTO access_request_settings (tenant_id)
      SELECT id FROM tenants WHERE slug='demo'
      ON CONFLICT (tenant_id) DO NOTHING
    `);

    // Role inheritance table (Business/Birthright can include IT roles)
    await db.query(`
      CREATE TABLE IF NOT EXISTS role_inheritance (
        parent_role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
        child_role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (parent_role_id, child_role_id)
      )
    `);

    // user_entitlements table for direct entitlement grants
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_entitlements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        entitlement_id UUID REFERENCES entitlements(id) ON DELETE CASCADE,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        granted_by UUID REFERENCES users(id),
        justification TEXT,
        expires_at TIMESTAMPTZ,
        granted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, entitlement_id)
      )
    `).catch(()=>{});

    // Add photo_url and theme columns if not exist
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(10) DEFAULT 'dark'`);

    logger.info('✅ V20.5 migrations complete');
  } catch (err) {
    logger.warn('V20.5 migration warning', { error: err.message });
  }
}

// ─── Start server ─────────────────────────────────────────────────────────────
async function start() {
  try {
    await db.connect();
    logger.info('✅ Database connected');
    if (!redisClient.isOpen) {
      await redisClient.connect();
      logger.info('✅ Redis connected');
    } else {
      logger.info('✅ Redis already connected');
    }
    await backfillPlatformData();
    await migrateV205();
    logger.info('✅ Platform data backfill checked');

    app.listen(PORT, () => {
      logger.info(`🚀 NexusIAM Backend running on port ${PORT}`);
      logger.info(`📚 API Docs: ${(process.env.API_DOCS_URL || `http://localhost:${PORT}/api/docs`)}`);
      // Start background scheduled jobs (reminders, expiry, cert alerts, sync)
      startScheduledJobs();
      logger.info('⏰ Scheduled jobs started');
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
