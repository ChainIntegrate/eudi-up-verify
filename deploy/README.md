# Deployment files

- `ecosystem.config.cjs`: PM2, backend (one instance, run by the `up-cie-link` user)
- `systemd/`: hourly monitor and daily encrypted backup (timers)
- `nginx/up-cie-link.conf`: site for `up-cie-link.chainintegrate.it` (CSP, HSTS, rate limit, minimal access log)

They already contain the values agreed for the server (port 3015, `/var/www/up-cie-link`, user `up-cie-link`).
Installation, updates and day-to-day operations: [`../docs/operations.md`](../docs/operations.md) (Italian).
