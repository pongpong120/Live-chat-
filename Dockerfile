FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p data logs public/uploads uploads \
    && chown -R node:node /app/data /app/logs /app/uploads
USER node
EXPOSE 3000
CMD ["node", "scripts/start-production.js"]
