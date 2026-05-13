const express = require('express');
const r = express.Router();
const { authenticate, auditLog } = require('../middleware/auth');
const ProvisioningEngine = require('../services/provisioning/ProvisioningEngine');

r.get('/transactions', authenticate, async (req, res) => {
  try {
    const rows = await ProvisioningEngine.listTransactions(req.tenantId, {
      status: req.query.status,
      connectorId: req.query.connectorId,
      limit: req.query.limit || 50,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

r.post('/transactions', authenticate, auditLog('provisioning.transaction.create'), async (req, res) => {
  try {
    const txn = await ProvisioningEngine.queueManualProvisioning({
      tenantId: req.tenantId,
      actorUserId: req.user?.id || null,
      connectorId: req.body.connectorId,
      operation: req.body.operation,
      payload: req.body.payload || {},
      requestId: req.body.requestId || null,
    });
    res.status(201).json(txn);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

r.post('/transactions/:id/execute', authenticate, auditLog('provisioning.transaction.execute'), async (req, res) => {
  try {
    const result = await ProvisioningEngine.executeTransaction(req.params.id, req.tenantId, req.user?.id || null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

r.post('/transactions/:id/retry', authenticate, auditLog('provisioning.transaction.retry'), async (req, res) => {
  try {
    const result = await ProvisioningEngine.retryTransaction(req.params.id, req.tenantId, req.user?.id || null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = r;
