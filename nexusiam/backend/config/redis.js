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

client.on('error', (err) => logger.error('Redis client error', { error: err.message }));
client.on('connect', () => logger.info('Redis client connected'));
client.on('reconnecting', () => logger.warn('Redis client reconnecting'));

module.exports = client;
