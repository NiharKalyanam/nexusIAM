const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' && process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  logger.error('Unexpected database error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

module.exports = {
  query: (text, params) => {
    const start = Date.now();
    return pool.query(text, params).then((res) => {
      const duration = Date.now() - start;
      if (duration > 1000) {
        logger.warn('Slow query detected', { text: text.substring(0, 100), duration });
      }
      return res;
    });
  },
  connect: () => pool.connect(),
  pool,
};
