const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { authenticate } = require('../middleware/auth');
const logger = require('../config/logger');

const LOG_DIR = process.env.LOG_DIR || './logs';

// GET /api/v1/logs - list log files available to customer
router.get('/', authenticate, async (req, res) => {
  try {
    if (!fs.existsSync(LOG_DIR)) return res.json({ files: [] });
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log') || f.endsWith('.gz'))
      .map(f => {
        const stat = fs.statSync(path.join(LOG_DIR, f));
        return { name: f, size: stat.size, modified: stat.mtime };
      })
      .sort((a, b) => b.modified - a.modified);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list logs' });
  }
});

// GET /api/v1/logs/stream - tail latest log (last N lines)
router.get('/stream', authenticate, async (req, res) => {
  try {
    const { lines = 200, level, service } = req.query;
    if (!fs.existsSync(LOG_DIR)) return res.json({ entries: [], file: null });

    // Find all log files — sort by modified time descending, pick newest
    const allFiles = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log') && !f.includes('error'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (!allFiles.length) return res.json({ entries: [], file: null });

    // Read up to 2 newest files and merge (handles log rotation boundary)
    let rawLines = [];
    for (const f of allFiles.slice(0, 2)) {
      try {
        const text = fs.readFileSync(path.join(LOG_DIR, f.name), 'utf8');
        rawLines = rawLines.concat(text.split('\n').filter(l => l.trim()));
      } catch {}
    }

    let entries = rawLines
      .map(l => { try { return JSON.parse(l); } catch { return { message: l, level: 'info', timestamp: new Date().toISOString() }; } })
      .reverse()
      .slice(0, parseInt(lines));

    if (level) entries = entries.filter(e => e.level === level);
    if (service) entries = entries.filter(e => e.service === service || e.message?.includes(service));

    res.json({ entries, file: allFiles[0].name, total: rawLines.length });
  } catch (err) {
    logger.error('Log stream failed', { error: err.message });
    res.status(500).json({ error: 'Failed to stream logs' });
  }
});

// GET /api/v1/logs/:filename - download specific log
router.get('/:filename', authenticate, async (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const filePath = path.join(LOG_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Log file not found' });
    res.download(filePath);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download log' });
  }
});

// POST /api/v1/logs/validate - validate log entries
router.post('/validate', authenticate, async (req, res) => {
  try {
    const { entries } = req.body;
    const results = entries.map(entry => ({
      entry,
      valid: !!(entry.timestamp && entry.level && entry.message),
      issues: [
        !entry.timestamp && 'Missing timestamp',
        !entry.level && 'Missing level',
        !entry.message && 'Missing message',
      ].filter(Boolean),
    }));
    res.json({ results, totalValid: results.filter(r => r.valid).length });
  } catch (err) {
    res.status(500).json({ error: 'Validation failed' });
  }
});

module.exports = router;
