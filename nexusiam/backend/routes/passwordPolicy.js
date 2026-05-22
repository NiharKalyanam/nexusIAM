const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authenticate, auditLog } = require('../middleware/auth');

// GET /password-policy - get tenant password policy
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM password_policies WHERE tenant_id=$1',
      [req.tenantId]
    );
    if (!rows.length) {
      // Return defaults if not configured
      return res.json({
        min_length: 12, max_length: 128, min_letters: 1, min_digits: 1,
        min_uppercase: 1, min_lowercase: 1, min_special: 1, max_repeated: 3,
        history_length: 5, trivial_check: true, case_sensitive: true,
        days_until_expiry: 90, days_until_generated_expiry: 7,
        min_hours_between_changes: 24, check_dictionary: false,
        check_identity_attrs: true, min_attr_length: 3,
        require_current_password: true, enable_hashing: true, hashing_iterations: 10
      });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load password policy' });
  }
});

// PUT /password-policy - save tenant password policy
router.put('/', authenticate, auditLog('password_policy.update'), async (req, res) => {
  try {
    const {
      min_length, max_length, min_letters, min_digits, min_uppercase, min_lowercase,
      min_special, max_repeated, history_length, trivial_check, case_sensitive,
      days_until_expiry, days_until_generated_expiry, min_hours_between_changes,
      check_dictionary, check_identity_attrs, min_attr_length,
      require_current_password, enable_hashing, hashing_iterations
    } = req.body;

    await db.query(`
      INSERT INTO password_policies (
        tenant_id, min_length, max_length, min_letters, min_digits, min_uppercase,
        min_lowercase, min_special, max_repeated, history_length, trivial_check,
        case_sensitive, days_until_expiry, days_until_generated_expiry,
        min_hours_between_changes, check_dictionary, check_identity_attrs,
        min_attr_length, require_current_password, enable_hashing, hashing_iterations,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        min_length=$2, max_length=$3, min_letters=$4, min_digits=$5, min_uppercase=$6,
        min_lowercase=$7, min_special=$8, max_repeated=$9, history_length=$10,
        trivial_check=$11, case_sensitive=$12, days_until_expiry=$13,
        days_until_generated_expiry=$14, min_hours_between_changes=$15,
        check_dictionary=$16, check_identity_attrs=$17, min_attr_length=$18,
        require_current_password=$19, enable_hashing=$20, hashing_iterations=$21,
        updated_at=NOW()
    `, [req.tenantId, min_length||12, max_length||128, min_letters||1, min_digits||1,
        min_uppercase||1, min_lowercase||1, min_special||1, max_repeated||3,
        history_length||5, trivial_check!==false, case_sensitive!==false,
        days_until_expiry||90, days_until_generated_expiry||7,
        min_hours_between_changes||24, check_dictionary||false,
        check_identity_attrs!==false, min_attr_length||3,
        require_current_password!==false, enable_hashing!==false, hashing_iterations||10]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save password policy' });
  }
});

// POST /password-policy/validate - validate a password against policy
router.post('/validate', authenticate, async (req, res) => {
  try {
    const { password } = req.body;
    const { rows } = await db.query(
      'SELECT * FROM password_policies WHERE tenant_id=$1', [req.tenantId]
    );
    const policy = rows[0] || { min_length:12, min_digits:1, min_uppercase:1, min_lowercase:1, min_special:1, max_repeated:3 };
    const errors = validatePassword(password, policy);
    res.json({ valid: errors.length === 0, errors });
  } catch (err) {
    res.status(500).json({ error: 'Validation failed' });
  }
});

function validatePassword(password, policy) {
  const errors = [];
  if (!password) return ['Password is required'];
  if (password.length < (policy.min_length||12)) errors.push(`Minimum ${policy.min_length||12} characters required`);
  if (policy.max_length && password.length > policy.max_length) errors.push(`Maximum ${policy.max_length} characters allowed`);
  const digits   = (password.match(/\d/g) || []).length;
  const upper    = (password.match(/[A-Z]/g) || []).length;
  const lower    = (password.match(/[a-z]/g) || []).length;
  const special  = (password.match(/[^A-Za-z0-9]/g) || []).length;
  const letters  = upper + lower;
  if (letters < (policy.min_letters||1))   errors.push(`At least ${policy.min_letters||1} letter(s) required`);
  if (digits < (policy.min_digits||1))     errors.push(`At least ${policy.min_digits||1} digit(s) required`);
  if (upper < (policy.min_uppercase||1))   errors.push(`At least ${policy.min_uppercase||1} uppercase letter(s) required`);
  if (lower < (policy.min_lowercase||1))   errors.push(`At least ${policy.min_lowercase||1} lowercase letter(s) required`);
  if (special < (policy.min_special||1))   errors.push(`At least ${policy.min_special||1} special character(s) required`);
  // Check repeated characters
  if (policy.max_repeated) {
    const re = new RegExp(`(.)\\1{${policy.max_repeated},}`);
    if (re.test(password)) errors.push(`No more than ${policy.max_repeated} repeated characters allowed`);
  }
  return errors;
}

module.exports = router;
module.exports.validatePassword = validatePassword;
