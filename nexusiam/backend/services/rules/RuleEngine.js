/**
 * NexusIAM Rule Engine
 *
 * Executes provisioning field value rules in a sandboxed JS context.
 * Equivalent to SailPoint IIQ BeanShell field value rules — but in JS.
 *
 * Context injected into every rule:
 *   identity   — the NexusIAM user object
 *   account    — the existing account link (may be null for Create)
 *   application — the application object
 *   connector  — the connector object
 *   operation  — 'Create' | 'Update' | 'Enable' | 'Disable' | 'Delete'
 *   attributes — object being built (all fields resolved so far)
 *   field      — name of the field currently being resolved
 */

const vm = require('vm');
const logger = require('../../config/logger');

const RULE_TIMEOUT_MS = 3000;

class RuleEngine {

  /**
   * Execute a JS rule script and return the result value.
   * @param {string} script       — JS code; should set `result = <value>`
   * @param {object} context      — { identity, account, application, connector, operation, attributes, field }
   * @returns {*}                 — whatever `result` was set to, or null
   */
  executeRule(script, context = {}) {
    if (!script || !script.trim()) return null;

    const sandbox = {
      // Context objects (read-only in practice)
      identity:    context.identity    || {},
      account:     context.account     || {},
      application: context.application || {},
      connector:   context.connector   || {},
      operation:   context.operation   || 'Create',
      attributes:  context.attributes  || {},
      field:       context.field       || '',
      // Built-in helpers
      log:    (msg) => logger.info(`[Rule:${context.field}] ${msg}`),
      void:   undefined,
      result: null,
      // Common JS globals safe to expose
      JSON, String, Number, Boolean, Array, Object, Math, Date, parseInt, parseFloat, isNaN,
    };

    try {
      const code = new vm.Script(script, { timeout: RULE_TIMEOUT_MS, filename: `rule:${context.field}` });
      const ctx = vm.createContext(sandbox);
      code.runInContext(ctx, { timeout: RULE_TIMEOUT_MS });
      return sandbox.result;
    } catch (err) {
      logger.warn(`[RuleEngine] Rule execution failed for field "${context.field}"`, {
        error: err.message,
        script: script.slice(0, 200),
      });
      throw new Error(`Rule error on field "${context.field}": ${err.message}`);
    }
  }

  /**
   * Apply built-in transforms to a value (no-code path).
   */
  applyTransform(value, transform, transformConfig = {}) {
    if (!transform || value == null) return value;
    const str = String(value);

    switch (transform) {
      case 'upper':       return str.toUpperCase();
      case 'lower':       return str.toLowerCase();
      case 'trim':        return str.trim();
      case 'concat': {
        const parts = (transformConfig.parts || []).map(p =>
          p.type === 'static' ? p.value : (this._nestedGet(transformConfig.identity || {}, p.field) || '')
        );
        return parts.join(transformConfig.separator || '');
      }
      case 'split': {
        const delimiter = transformConfig.delimiter || ',';
        const index     = transformConfig.index ?? null;
        const parts2 = str.split(delimiter);
        return index !== null ? (parts2[index] || '') : parts2;
      }
      case 'regex': {
        const match = str.match(new RegExp(transformConfig.pattern || '(.*)'));
        const group = transformConfig.group ?? 0;
        return match ? (match[group] || '') : '';
      }
      case 'date_format': {
        const d = new Date(value);
        if (isNaN(d)) return str;
        const fmt = transformConfig.format || 'YYYY-MM-DD';
        return fmt
          .replace('YYYY', d.getFullYear())
          .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
          .replace('DD', String(d.getDate()).padStart(2, '0'));
      }
      case 'lookup': {
        const table = transformConfig.table || {};
        return table[str] ?? (transformConfig.default || str);
      }
      case 'conditional': {
        // { ifField, ifValue, thenValue, elseValue }
        const lhs = this._nestedGet(transformConfig.identity || {}, transformConfig.ifField || '');
        return String(lhs) === String(transformConfig.ifValue || '')
          ? transformConfig.thenValue
          : (transformConfig.elseValue || value);
      }
      case 'username_gen': {
        // Generate username: first initial + last name, lowercase, max length
        const first = (transformConfig.firstName || '').trim();
        const last  = (transformConfig.lastName  || '').trim();
        const max   = transformConfig.maxLength || 20;
        return (first.charAt(0) + last).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, max);
      }
      default:
        return value;
    }
  }

  /**
   * Resolve all fields in a provisioning policy for a given identity + context.
   * Returns { fieldName: resolvedValue, ... }
   */
  resolveFields(policyFields = [], context = {}) {
    const attributes = {};

    for (const field of policyFields) {
      if (!field.name) continue;
      try {
        let value = null;

        switch (field.source) {
          case 'identity':
            value = this._nestedGet(context.identity || {}, field.value || field.name);
            break;
          case 'static':
            value = field.value;
            break;
          case 'rule':
            value = this.executeRule(field.rule_script, { ...context, attributes, field: field.name });
            break;
          case 'generator':
            value = this._runGenerator(field.generator, context);
            break;
          case 'account':
            value = this._nestedGet(context.account || {}, field.value || field.name);
            break;
          default:
            value = field.value ?? null;
        }

        // Apply transform on top
        if (field.transform && field.transform !== 'none') {
          value = this.applyTransform(value, field.transform, {
            ...field.transform_config,
            identity: context.identity,
          });
        }

        if (value !== null && value !== undefined) {
          attributes[field.name] = value;
        } else if (field.required) {
          throw new Error(`Required field "${field.name}" resolved to null`);
        }
      } catch (err) {
        if (field.required) throw err;
        logger.warn(`[RuleEngine] Non-required field "${field.name}" failed: ${err.message}`);
      }
    }

    return attributes;
  }

  _nestedGet(obj, path) {
    if (!path || !obj) return null;
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
  }

  _runGenerator(generator, context) {
    const identity = context.identity || {};
    switch (generator) {
      case 'email':
        return identity.email || null;
      case 'username':
        return identity.username || null;
      case 'display_name':
        return [identity.first_name, identity.last_name].filter(Boolean).join(' ') || identity.username || null;
      case 'first_name':
        return identity.first_name || null;
      case 'last_name':
        return identity.last_name || null;
      case 'employee_id':
        return identity.employee_id || null;
      case 'phone':
        return identity.phone || null;
      case 'department':
        return identity.department || null;
      case 'title':
        return identity.title || null;
      case 'uuid':
        return require('crypto').randomUUID();
      default:
        return null;
    }
  }
}

module.exports = new RuleEngine();
