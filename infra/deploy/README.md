# Deployment

## First-time setup (one VPS, Ubuntu 24.04)

1. Create a VPS (Hetzner CX22 = 4GB / 2 vCPU is plenty).
2. Point your DNS A record `agency.example.com` at the VPS IP.
3. SSH in as root.
4. `curl -fsSL https://raw.githubusercontent.com/<you>/paperclip/main/infra/deploy/bootstrap.sh | bash`
5. As `paperclip` user: `git clone <repo> /opt/paperclip`
6. Copy `.env.example` to `/opt/paperclip/.env`. Fill in every value (see below).
7. `sudo systemctl start paperclip`
8. `curl -fsS https://agency.example.com/api/health` should return `{"ok":true}` after Caddy provisions a cert (~30s).

## Required secrets in `.env`

- `DATABASE_URL`, `POSTGRES_PASSWORD`
- `TOKEN_ENC_KEY` (`base64:<32 bytes>`)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_ADMIN_KEY` (admin API for cost-watchdog)
- `MONTHLY_LLM_CAP_USD` (default 180), `WATCHDOG_NOTIFY_URL`
- X creds: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`
- `ATTRIBUTION_WEBHOOK_SECRET`
- `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID`
- `NEWSLETTER_ORIGIN`
- B2: `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`
- `LOGS_TOKEN` (BetterStack)
- `NOTIFIER_TRANSPORT=email`, `SMTP_*`, `NOTIFY_TO`
- `LOG_FILE_DIR=/var/log/paperclip`

## Deploy a new version

```bash
ssh paperclip@agency.example.com
cd /opt/paperclip
git pull
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml pull
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build
```
