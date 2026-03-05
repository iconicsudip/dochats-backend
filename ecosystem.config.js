module.exports = {
  apps: [
    {
      name: "dochats-server",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      error_file: "/dev/null",
      out_file: "/dev/null",
      log_file: "/dev/null",
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      listen_timeout: 3000,
      kill_timeout: 5000,
    },
  ],
};
