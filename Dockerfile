FROM node:22-slim

ENV NODE_ENV production
LABEL org.opencontainers.image.authors="Timo Kössler <info@timokoessler.de>"
LABEL org.opencontainers.image.title="SSL-Cert Updater (sslup)"
LABEL org.opencontainers.image.description="A tool to automatically deploy SSL certificates to multiple servers"

RUN echo "#!/bin/sh\nnode cli.js \$@" > /usr/local/bin/cli && \
    chmod +x /usr/local/bin/cli

USER node
WORKDIR /home/node
ENV NODE_ENV production

COPY --chown=node:node ./backend/dist/ ./

CMD ["node", "app"]