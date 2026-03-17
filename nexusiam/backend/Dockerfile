FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Create directories for plugins, jars, logs
RUN mkdir -p /app/plugins /app/external-jars /app/logs

# Non-root user for security
RUN addgroup -S nexus && adduser -S nexus -G nexus
RUN chown -R nexus:nexus /app
USER nexus

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "server.js"]
