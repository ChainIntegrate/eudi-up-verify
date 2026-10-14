// PM2: the backend only (the monitor runs from a systemd timer, so it also notices PM2 being down).
//   cd <repo> && pm2 start deploy/ecosystem.config.cjs && pm2 save
// One instance in fork mode: the serial queue (uniqueness + minting) must never run twice.
// Configuration comes from backend/.env.
module.exports = {
  apps: [
    {
      name: "up-cie-link",
      cwd: `${__dirname}/../backend`,
      script: "src/server.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 5000,
      kill_timeout: 10000,
      max_memory_restart: "300M",
      time: true,
    },
  ],
};
