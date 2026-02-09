/**
 * Shared Configuration for the IoT Temperature Monitoring System (TMS)
 *
 * This module centralizes all configuration to avoid hardcoded values
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

export const config = {
  sqs: {
    region: process.env.AWS_REGION, // required
    endpoint: process.env.SQS_ENDPOINT, // SDK resolves from region if undefined
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined, // use IAM role if running on EC2
    telemetryQueueName: "ShipTelemetryQueue",
    telemetryQueueUrl: process.env.TELEMETRY_QUEUE_URL, // required
    eventsQueueName: "AlertEventsQueue",
    eventsQueueUrl: process.env.EVENTS_QUEUE_URL, // required
    visibilityTimeout: "30", // 30 seconds before unprocessed message reappears
    messageRetentionPeriod: "86400", // 24 hours to keep messages
  },

  redis: {
    url: process.env.REDIS_URL, // required
  },

  postgres: {
    connectionString: process.env.DATABASE_URL, // required
    maximumPoolSizeExecutor: 5, // max connections for Executor
    maximumPoolSizeWorker: 3, // max connections for Worker
    idleTimeoutMillis: 30000, // 30 seconds before idle client is closed
  },

  simulator: {
    intervalMs: 10000, // how often to send readings (milliseconds)
  },

  ingestor: {
    port: process.env.INGESTOR_PORT, // required
    host: process.env.INGESTOR_HOST, // required
    url:
      process.env.INGESTOR_URL ||
      `${process.env.INGESTOR_HOST}:${process.env.INGESTOR_PORT}`, // required
  },

  worker: {
    pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL || "20"), // seconds
    maxMessages: parseInt(process.env.WORKER_MAX_MESSAGES || "10"),
    errorRetryMs: 5000, // retry delay after a polling error
    trendWindowMinutes: parseInt(process.env.TREND_WINDOW_MINUTES || "5"),
    trendMaxReadings: 5, // max recent readings to fetch for trend analysis
    trendMinReadings: 3, // minimum readings needed before trend analysis runs
    trendMinRising: 2, // how many consecutive rises count as a trend
    trendMinIncrease: 2, // minimum degree increase to trigger a trend alert
  },

  executor: {
    pollInterval: parseInt(process.env.EXECUTOR_POLL_INTERVAL || "20"), // seconds
    maxMessages: parseInt(process.env.EXECUTOR_MAX_MESSAGES || "10"),
    errorRetryMs: 5000, // retry delay after a polling error
  },

  // Default temperature thresholds (as fallback if not set by user in Redis)
  thresholds: {
    default: {
      warning: -10, // Warning if temp goes above -10
      critical: -5, // Critical if temp goes above -5
      target: -18, // Target temperature
    },
  },

  // Event Alert Types
  alertTypes: {
    NORMAL: "NORMAL",
    WARNING: "WARNING",
    CRITICAL: "CRITICAL",
    TREND_ANOMALY: "TREND_ANOMALY",
  },

  // Event Action Types
  actionTypes: {
    LOG: "LOG",
    NOTIFY_WARNING: "NOTIFY_WARNING",
    NOTIFY_CRITICAL: "NOTIFY_CRITICAL",
    ADJUST_TEMPERATURE: "ADJUST_TEMPERATURE",
    TREND_ALERT: "TREND_ALERT",
  },

  // Notification Configuration
  notifications: {
    email: {
      enabled: process.env.EMAIL_NOTIFICATIONS_ENABLED === "true", // required
      from: process.env.EMAIL_FROM, // required
      to: process.env.EMAIL_TO, // required
    },
    webhook: {
      enabled: process.env.WEBHOOK_ENABLED === "true", // required
      url: process.env.WEBHOOK_URL, // required
    },
  },
};

export default config;
