// config/logger.js
const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || './logs';

const fileRotateTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, 'nexusiam-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '100m',
  maxFiles: '30d',
  zippedArchive: true,
});

const errorFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, 'nexusiam-error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: '50m',
  maxFiles: '90d',
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'nexusiam-backend' },
  transports: [
    fileRotateTransport,
    errorFileTransport,
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...rest }) => {
        const meta = Object.keys(rest).length ? JSON.stringify(rest) : '';
        return `${timestamp} [${level}]: ${message} ${meta}`;
      })
    ),
  }));
}

module.exports = logger;
