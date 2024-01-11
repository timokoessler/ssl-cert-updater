# SSL Cert Updater (next)

A tool to automatically deploy SSL certificates on multiple servers

The client is available for linux, windows and mac os. The server and client are built into a Docker image using Gitlab CI or GitHub Actions. The client can be downloaded from the server's web UI.

This repo contains an example config as well as a docker-compose.yml.

## Building

To build the complete project, run `npm ci && npm run build`.

## Deployment

In production, you should always use the automatically created Docker image. Use the `docker-compose.yml` file as an example.  
You can use the cli to setup the server (generate .env file and keys) and to manage the users.

```bash
docker compose run -it --rm ssl-cert-updater cli
```

The application requires a MongoDB instance.

## Development

Run the command `npm run dev` to start the backend, frontend and client in development mode.
On changes everything will be rebuild and restarted automatically.
In development mode (NODE_ENV=development), the frontend will **not** be served by the backend.
The frontend will be served by the Astro dev server on port 3001.
The backend port is configured in the .env file and defaults to 3000.

## Todos

-   Client (auto) updates + update notification
-   Improve dark mode
-   2FA App support?
-   Standalone DNS-Mode - acting as a DNS server to support every DNS provider and reduce delays
