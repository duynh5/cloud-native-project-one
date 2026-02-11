/**
 * PM2 Ecosystem Configuration
 *
 * This file is used by PM2 to manage the application processes,
 *
 * Usage:
 *   pm2 start deploy/pm2-ecosystem.config.cjs  -> start all 3 services
 *   pm2 start deploy/pm2-ecosystem.config.cjs --only ingestor  -> start only ingestor
 *   pm2 start deploy/pm2-ecosystem.config.cjs --only worker  -> start only worker
 *   pm2 start deploy/pm2-ecosystem.config.cjs --only executor  -> start only executor
 *
 *   pm2 restart deploy/pm2-ecosystem.config.cjs  -> restart all 3 services
 *   pm2 stop deploy/pm2-ecosystem.config.cjs  -> stop all 3 services
 *   pm2 delete deploy/pm2-ecosystem.config.cjs  -> delete all 3 services
 */

module.exports = {
  apps: [
    {
      name: "ingestor",
      script: "./ingestor/ingestor.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/ingestor-error.log",
      out_file: "./logs/ingestor-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
    {
      name: "worker",
      script: "./worker/worker.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/worker-error.log",
      out_file: "./logs/worker-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
    {
      name: "executor",
      script: "./executor/executor.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/executor-error.log",
      out_file: "./logs/executor-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
