FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node lib/ lib/
COPY --chown=node:node public/ public/
COPY --chown=node:node prompts/ prompts/
COPY --chown=node:node scripts/ scripts/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV WEBHOOK_HOST=0.0.0.0 PANEL_HOST=0.0.0.0 DB_PATH=/app/data/ig-automat.db
EXPOSE 8101 8102
CMD ["node", "server.js"]
