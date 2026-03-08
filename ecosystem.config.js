module.exports = {
  apps: [
    {
      name: "dochats-server",
      script: "./dist/index.js",
      instances: 1, // Change to "max" or any number > 1 if using Redis adapter for socket.io
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 5001
      },
      // Note: If you increase instances > 1, you must use 
      // @socket.io/redis-adapter or ensure sticky sessions 
      // on your load balancer (e.g. Nginx ip_hash)
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      combine_logs: true,
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s"
    },
  ],
};
