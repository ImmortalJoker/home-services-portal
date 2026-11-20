FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
COPY deploy/authentik/portal/launch.mjs ./deploy/authentik/portal/launch.mjs
COPY deploy/authentik/portal/guides.mjs ./deploy/authentik/portal/guides.mjs
COPY deploy/authentik/portal/urls.mjs ./deploy/authentik/portal/urls.mjs
ENV VITE_BASE_PATH=/ VITE_PORTAL_PUBLIC_DEMO=false
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 PORTAL_CONFIG_PATH=/app/config/portal-services.json PORTAL_DIST_DIR=/app/dist
COPY --from=build --chown=node:node /src/dist ./dist
COPY --chown=node:node deploy/authentik/portal/server.mjs ./server.mjs
COPY --chown=node:node deploy/authentik/portal/launch.mjs ./launch.mjs
COPY --chown=node:node deploy/authentik/portal/transmission.mjs ./transmission.mjs
COPY --chown=node:node deploy/authentik/portal/guides.mjs ./guides.mjs
COPY --chown=node:node deploy/authentik/portal/urls.mjs ./urls.mjs
COPY --chown=node:node deploy/authentik/portal/http.mjs ./http.mjs
COPY --chown=node:node deploy/authentik/portal/peer-trust.mjs ./peer-trust.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
