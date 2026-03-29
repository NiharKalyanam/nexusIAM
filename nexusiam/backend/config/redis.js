const { createClient } = require('redis');
const logger = require('./logger');

const client = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) return new Error('Too many Redis reconnection attempts');
      return Math.min(retries * 100, 3000);
    },
  },
});

client.on('error',       (err) => logger.error('[REDIS] Client error',       { error: err.message }));
client.on('connect',     ()    => logger.info ('[REDIS] Client connected'));
client.on('reconnecting',()    => logger.warn ('[REDIS] Client reconnecting'));
client.on('ready',       ()    => logger.info ('[REDIS] Client ready — cache layer active'));
client.on('end',         ()    => logger.warn ('[REDIS] Client connection closed'));

// ─────────────────────────────────────────────────────────────────────────────
// Safe cache helpers
// All methods are wrapped in try/catch.
// If Redis is down or throws, they return null/false — the caller falls back to DB.
// Redis failure NEVER crashes the application.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a cached value by key.
 * Returns parsed JSON if found, null if missing or on any error.
 */
async function cacheGet(key) {
  try {
    const raw = await client.get(key);
    if (raw === null || raw === undefined) {
      logger.debug('[REDIS] Cache MISS', { key });
      return null;
    }
    logger.debug('[REDIS] Cache HIT', { key });
    return JSON.parse(raw);
  } catch (err) {
    logger.warn('[REDIS] cacheGet failed — falling back to DB', { key, error: err.message });
    return null;
  }
}

/**
 * Set a value in cache with a TTL in seconds.
 * Silently logs and returns false on any error — never throws.
 */
async function cacheSet(key, value, ttlSeconds = 300) {
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    logger.debug('[REDIS] Cache SET', { key, ttlSeconds });
    return true;
  } catch (err) {
    logger.warn('[REDIS] cacheSet failed — data will not be cached', { key, error: err.message });
    return false;
  }
}

/**
 * Delete one or more cache keys (e.g. after a write operation).
 * Accepts a single key string or an array of keys.
 * Silently logs and returns false on any error — never throws.
 */
async function cacheDel(keys) {
  try {
    const keyList = Array.isArray(keys) ? keys : [keys];
    if (keyList.length === 0) return true;
    await client.del(keyList);
    logger.debug('[REDIS] Cache DEL', { keys: keyList });
    return true;
  } catch (err) {
    logger.warn('[REDIS] cacheDel failed — stale cache may persist until TTL', { keys, error: err.message });
    return false;
  }
}

/**
 * Delete all cache keys matching a pattern (e.g. 'dashboard:*').
 * Used for tenant-wide invalidation.
 * Silently logs and returns false on any error — never throws.
 */
async function cacheDelPattern(pattern) {
  try {
    const keys = await client.keys(pattern);
    if (keys.length === 0) {
      logger.debug('[REDIS] cacheDelPattern — no keys matched', { pattern });
      return true;
    }
    await client.del(keys);
    logger.info('[REDIS] cacheDelPattern — invalidated keys', { pattern, count: keys.length });
    return true;
  } catch (err) {
    logger.warn('[REDIS] cacheDelPattern failed — stale cache may persist until TTL', { pattern, error: err.message });
    return false;
  }
}

module.exports = client;
module.exports.cacheGet        = cacheGet;
module.exports.cacheSet        = cacheSet;
module.exports.cacheDel        = cacheDel;
module.exports.cacheDelPattern = cacheDelPattern;