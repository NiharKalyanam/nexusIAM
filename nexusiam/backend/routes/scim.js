const express = require('express');
const router = express.Router();
const db = require('../config/database');
const bcrypt = require('bcrypt');

// SCIM Bearer token auth
const scimAuth = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'Unauthorized', status: 401 });
  const token = auth.split(' ')[1];
  const hash = require('crypto').createHash('sha256').update(token).digest('hex');
  const { rows } = await db.query(`SELECT * FROM scim_tokens WHERE token_hash=$1 AND (expires_at IS NULL OR expires_at > NOW())`, [hash]);
  if (!rows.length) return res.status(401).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'Invalid token', status: 401 });
  req.scimToken = rows[0];
  req.tenantId = rows[0].tenant_id;
  next();
};

// SCIM User schema mapping
const toSCIMUser = (u) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  id: u.id,
  externalId: u.external_id,
  userName: u.username,
  name: { givenName: u.first_name, familyName: u.last_name, formatted: u.display_name },
  emails: [{ value: u.email, primary: true }],
  phoneNumbers: u.phone ? [{ value: u.phone }] : [],
  active: u.status === 'active',
  title: u.title,
  department: u.department,
  meta: { resourceType: 'User', created: u.created_at, lastModified: u.updated_at },
});

// GET /scim/v2/Users
router.get('/Users', scimAuth, async (req, res) => {
  const { startIndex = 1, count = 100, filter } = req.query;
  let where = 'WHERE tenant_id=$1';
  const params = [req.tenantId];
  if (filter && filter.includes('userName eq')) {
    const match = filter.match(/userName eq "(.+?)"/);
    if (match) { where += ' AND username=$2'; params.push(match[1]); }
  }
  const offset = parseInt(startIndex) - 1;
  const { rows } = await db.query(`SELECT * FROM users ${where} LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, count, offset]);
  const total = await db.query(`SELECT COUNT(*) FROM users ${where}`, params);
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: parseInt(total.rows[0].count),
    startIndex: parseInt(startIndex),
    itemsPerPage: parseInt(count),
    Resources: rows.map(toSCIMUser),
  });
});

// POST /scim/v2/Users
router.post('/Users', scimAuth, async (req, res) => {
  const { userName, name, emails, active, externalId } = req.body;
  const email = emails?.[0]?.value;
  const hash = await bcrypt.hash('NexusSCIM@Temp2024!', 10);
  const { rows } = await db.query(
    `INSERT INTO users (tenant_id, username, email, password_hash, first_name, last_name, display_name, status, external_id, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scim') RETURNING *`,
    [req.tenantId, userName, email, hash, name?.givenName, name?.familyName, name?.formatted, active !== false ? 'active' : 'inactive', externalId]
  );
  res.status(201).json(toSCIMUser(rows[0]));
});

// PATCH /scim/v2/Users/:id
router.patch('/Users/:id', scimAuth, async (req, res) => {
  const { Operations } = req.body;
  for (const op of Operations) {
    if (op.op === 'replace') {
      if (op.value?.active !== undefined) {
        await db.query(`UPDATE users SET status=$1 WHERE id=$2 AND tenant_id=$3`, [op.value.active ? 'active' : 'inactive', req.params.id, req.tenantId]);
      }
    }
  }
  const { rows } = await db.query(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
  res.json(toSCIMUser(rows[0]));
});

// DELETE /scim/v2/Users/:id
router.delete('/Users/:id', scimAuth, async (req, res) => {
  await db.query(`UPDATE users SET status='inactive' WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenantId]);
  res.status(204).send();
});

module.exports = router;
