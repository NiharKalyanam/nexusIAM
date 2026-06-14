const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: process.env.PLUGIN_DIR || '/app/plugins',
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/', authenticate, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM plugins WHERE tenant_id=$1 ORDER BY name`, [req.tenantId]);
  res.json(rows);
});

router.post('/upload', authenticate, upload.single('plugin'), async (req, res) => {
  try {
    const { name, type, entry_class, config } = req.body;
    const { rows } = await db.query(
      `INSERT INTO plugins (tenant_id,name,type,file_path,entry_class,config,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.tenantId, name, type, req.file?.path, entry_class, JSON.stringify(JSON.parse(config||'{}')), '1.0.0']
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to upload plugin' }); }
});

router.post('/:id/toggle', authenticate, async (req, res) => {
  const { rows } = await db.query(
    `UPDATE plugins SET status=CASE WHEN status='active' THEN 'disabled' ELSE 'active' END WHERE id=$1 RETURNING *`,
    [req.params.id]
  );
  res.json(rows[0]);
});

router.get('/loggers', authenticate, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM custom_loggers WHERE tenant_id=$1`, [req.tenantId]);
  res.json(rows);
});

router.post('/loggers', authenticate, async (req, res) => {
  const { name, logger_class, log_level, config } = req.body;
  const { rows } = await db.query(
    `INSERT INTO custom_loggers (tenant_id,name,logger_class,log_level,config) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.tenantId, name, logger_class, log_level||'INFO', JSON.stringify(config||{})]
  );
  res.status(201).json(rows[0]);
});

module.exports = router;
