# Deployment (server)

Files: `ecosystem.config.cjs` (PM2, backend), `systemd/` (hourly monitor, daily backup), `nginx/up-cie-link.conf`.
Replace every `CHANGE_ME` (user, repository path, node binary, port).

## Dedicated user and file permissions (audit UCL-08)

The backend holds the attester key, `UNIQ_PEPPER`, `CERT_REF_KEY` and the database: run it as its own system user,
never as root or as a user shared with other services.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin up-cie-link
sudo -u up-cie-link git clone https://github.com/ChainIntegrate/up-cie-link.git /home/up-cie-link/up-cie-link
sudo install -d -m 700 -o up-cie-link -g up-cie-link /var/lib/up-cie-link /var/backups/up-cie-link
# backend/.env and backend/monitor.env: mode 600, owned by up-cie-link (the backend refuses a readable .env)
sudo -u up-cie-link chmod 600 /home/up-cie-link/up-cie-link/backend/.env /home/up-cie-link/up-cie-link/backend/monitor.env
```

- The backend sets `umask 077` and keeps the database at mode 600.
- PM2 runs under that user (`sudo -u up-cie-link pm2 start deploy/ecosystem.config.cjs`, then
  `pm2 startup` for that user); the systemd units use `User=up-cie-link`.
- Keep the attester balance low (a few LYX): if the key leaks, the owner stops it with `setAttester(0)`.
- Not done yet (planned for mainnet): HMAC and signing in a separate process/user.

## Checks after installing

```bash
sudo nginx -t
curl -s http://127.0.0.1:<PORT>/api/health          # details, local only
curl -s https://up-cie-link.chainintegrate.it/api/health  # 404 from outside
sudo -u up-cie-link npm --prefix backend run monitor -- --dry-run
grep -A3 '/var/log/nginx' /etc/logrotate.d/nginx    # daily + rotate 14 (privacy notice: 14 days)
```
