FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
ENV VITE_BASE_PATH=/ VITE_PORTAL_PUBLIC_DEMO=false
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 PORTAL_CONFIG_PATH=/app/config/portal-services.json PORTAL_DIST_DIR=/app/dist
COPY --from=build --chown=node:node /src/dist ./dist
COPY --chown=node:node deploy/authentik/portal/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
