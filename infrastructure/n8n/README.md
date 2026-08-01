# n8n infrastructure

This directory is the production-shaped stack for both Rake environments. Each
host runs an isolated n8n instance, its own Postgres database, and Caddy for
automatic HTTPS. Never share the Postgres volume or n8n encryption key between
staging and production.

## Deploy one environment

1. Point the environment hostname at the Droplet's public IPv4 address and open
   inbound TCP 22, 80, and 443 only.
2. Copy this directory to `/opt/rake-n8n` on the host.
3. Copy `.env.example` to `.env`, replace every placeholder, and set the host's
   environment-specific domain.
4. Generate secrets independently with `openssl rand -hex 32`. Before starting
   the stack, save the encryption key and Postgres password in the team's
   password manager under `Rake n8n / <environment>`. That password-manager
   record is the required backup outside the server.
5. Restrict the file and start the stack:

   ```bash
   chmod 600 /opt/rake-n8n/.env
   docker compose --env-file /opt/rake-n8n/.env up -d
   docker compose ps
   curl --fail --silent --show-error https://your-domain.example/healthz
   ```

DigitalOcean automated backups must be enabled at Droplet creation. After the
setup screen is verified, import workflows from `../../n8n/workflows` and set
the global error workflow to `slack-execution-failure.json`.

## Promotion

Workflow changes are exported from staging into `n8n/workflows`, reviewed in a
PR, merged to `main`, then imported into production. Credential records and
environment variables stay outside Git.
