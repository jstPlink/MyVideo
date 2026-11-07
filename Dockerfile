# --- 1) build dell'interfaccia web ---
FROM node:24-alpine AS web
WORKDIR /build
COPY VERSION ./VERSION
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY web web
RUN cd web && npm run build

# --- 2) immagine finale ---
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data WEB_DIR=/app/web VERSION_FILE=/app/VERSION
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY server/src server/src
COPY VERSION VERSION
COPY --from=web /build/web/dist /app/web
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/status >/dev/null || exit 1
CMD ["node", "--no-warnings", "server/src/index.js"]
