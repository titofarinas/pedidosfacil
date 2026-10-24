FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY server ./server
COPY assets ./assets
COPY index.html panel.html ./

RUN mkdir -p /app/server/data && chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/negocio').then(function (r) { process.exit(r.ok ? 0 : 1); }).catch(function () { process.exit(1); })"

CMD ["node", "server/server.js"]
