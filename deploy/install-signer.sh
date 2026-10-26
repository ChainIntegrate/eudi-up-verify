#!/usr/bin/env bash
# Installs or updates the signer (audit UCL-08) in /opt/up-cie-link-signer, owned by root and read-only for
# everyone else, plus its system user and systemd unit. Run it as root FROM A FRESH CLONE, never from
# /var/www/up-cie-link (writable by the backend's user: a compromised backend could change what root runs):
#
#   sudo bash -c 'd=$(mktemp -d) && git clone --depth 1 https://github.com/ChainIntegrate/up-cie-link "$d" \
#     && bash "$d/deploy/install-signer.sh" && rm -rf "$d"'
#
# It does not touch /etc/up-cie-link/signer.env (the secrets) nor start the service: see docs/operations.md.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
case "$REPO" in /var/www/*) echo "refusing to install from $REPO: use a fresh clone (see the header)"; exit 1 ;; esac
DEST=/opt/up-cie-link-signer

id -u up-cie-link >/dev/null 2>&1 || { echo "user up-cie-link (the backend's) missing"; exit 1; }
id -u up-cie-link-signer >/dev/null 2>&1 ||
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin up-cie-link-signer

rm -rf "$DEST.new"
install -d -m 755 -o root -g root "$DEST.new" "$DEST.new/src"
install -m 644 -o root -g root "$REPO/signer/package.json" "$REPO/signer/package-lock.json" "$DEST.new/"
install -m 644 -o root -g root "$REPO"/signer/src/*.js "$DEST.new/src/"
(cd "$DEST.new" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
chown -R root:root "$DEST.new"
chmod -R u=rwX,go=rX "$DEST.new"
rm -rf "$DEST.old"
[ -d "$DEST" ] && mv "$DEST" "$DEST.old"
mv "$DEST.new" "$DEST"
rm -rf "$DEST.old"
git -C "$REPO" rev-parse HEAD > "$DEST/COMMIT" 2>/dev/null || true

install -m 644 -o root -g root "$REPO/deploy/systemd/up-cie-link-signer.service" /etc/systemd/system/
install -d -m 700 -o root -g root /etc/up-cie-link
systemctl daemon-reload
echo "signer installed in $DEST (commit $(cat "$DEST/COMMIT" 2>/dev/null || echo '?'))"
[ -f /etc/up-cie-link/signer.env ] || echo "next: create /etc/up-cie-link/signer.env (root, 600): see docs/operations.md"
echo "then: sudo systemctl enable --now up-cie-link-signer   (or restart, after an update)"
