FROM node:20-slim as builder
ENV NODE_ENV build

USER node
WORKDIR /home/node

COPY --chown=node:node . .
RUN npm ci
RUN npm run build

# -----

FROM node:20-slim

ENV NODE_ENV production
LABEL org.opencontainers.image.authors="Timo Kössler <info@timokoessler.de>"
LABEL org.opencontainers.image.title="SSL-Cert Updater (sslup)"
LABEL org.opencontainers.image.description="A tool to automatically deploy SSL certificates on multiple servers"

USER node
WORKDIR /home/node

COPY --from=builder --chown=node:node /home/node/backend/dist/ ./

CMD ["node", "app"]