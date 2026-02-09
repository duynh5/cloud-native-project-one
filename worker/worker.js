/**
 * Component B: Data Processor (Worker)
 *
 * Role: Pulls telemetry from TelemetryQueue, evaluates business rules
 * using Redis-cached thresholds, checks temperature trends via
 * read-only PostgreSQL access, and publishes events to
 * the EventsQueue for Component C (Executor) to handle.
 *
 * Connections: SQS (read TelemetryQueue, write EventsQueue) + Redis
 * (to retrieve thresholds) + PostgreSQL (read-only, for trend analysis)
 */
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { createClient } from "redis";
import pkg from "pg";
import config from "../shared/config.js";

const { Pool } = pkg;

// Setup connections
const TELEMETRY_QUEUE_URL = config.sqs.telemetryQueueUrl;
const EVENTS_QUEUE_URL = config.sqs.eventsQueueUrl;

const sqsClient = new SQSClient({
  region: config.sqs.region,
  endpoint: config.sqs.endpoint,
  credentials: config.sqs.credentials,
});
const redis = createClient({ url: config.redis.url });
const db = new Pool({
  connectionString: config.postgres.connectionString,
  max: config.postgres.maximumPoolSizeWorker,
  idleTimeoutMillis: config.postgres.idleTimeoutMillis,
});

/**
 * Get thresholds for a ship from Redis cache.
 * Falls back to default values in config.js if not found in Redis.
 */
async function getThresholds(shipId) {
  const warning = await redis.get(`threshold:${shipId}:warning`);
  const critical = await redis.get(`threshold:${shipId}:critical`);
  const target = await redis.get(`threshold:${shipId}:target`);

  return {
    warning: parseFloat(warning || config.thresholds.default.warning),
    critical: parseFloat(critical || config.thresholds.default.critical),
    target: parseFloat(target || config.thresholds.default.target),
  };
}

/**
 * Determine alert type based on temperature and thresholds
 */
function determineAlertType(temp, thresholds) {
  if (temp > thresholds.critical) return config.alertTypes.CRITICAL;
  if (temp > thresholds.warning) return config.alertTypes.WARNING;
  return config.alertTypes.NORMAL;
}

/**
 * Determine what actions Component C should take based on the alert type
 */
function determineActions(alertType) {
  if (alertType === config.alertTypes.CRITICAL) {
    return [
      config.actionTypes.LOG,
      config.actionTypes.ADJUST_TEMPERATURE,
      config.actionTypes.NOTIFY_CRITICAL,
    ];
  }
  if (alertType === config.alertTypes.WARNING) {
    return [config.actionTypes.LOG, config.actionTypes.NOTIFY_WARNING];
  }
  return [config.actionTypes.LOG];
}

/**
 * Publish an event to the EventsQueue for Component C
 */
async function publishEvent(event) {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: EVENTS_QUEUE_URL,
      MessageBody: JSON.stringify(event),
    }),
  );
  console.log(
    `Event published: ${Object.values(event.evaluation).join(" | ")}`,
  );
}

/**
 * Check for rising temperature trends by querying recent readings from PostgreSQL.
 * If a trend is detected, publish a TREND_ANOMALY event to EventsQueue.
 */
async function checkTemperatureTrend(shipId) {
  const window = config.worker.trendWindowMinutes;
  const result = await db.query(
    `SELECT temperature FROM telemetry_readings
     WHERE ship_id = $1 AND timestamp > NOW() - INTERVAL '${window} minutes'
     ORDER BY timestamp DESC LIMIT ${config.worker.trendMaxReadings}`,
    [shipId],
  );

  if (result.rows.length < config.worker.trendMinReadings) return;

  const temps = result.rows.map((r) => parseFloat(r.temperature));
  let rising = 0;
  for (let i = 0; i < temps.length - 1; i++) {
    const newer = temps[i];
    const older = temps[i + 1];
    if (newer > older) rising++;
  }

  if (rising >= config.worker.trendMinRising) {
    const increase = temps[0] - temps[temps.length - 1];
    if (increase > config.worker.trendMinIncrease) {
      const event = {
        event_type: "TREND_ANOMALY",
        telemetry: {
          ship_id: shipId,
          temp: temps[0],
          timestamp: new Date().toISOString(),
        },
        evaluation: {
          alert_type: config.alertTypes.TREND_ANOMALY,
          actions: [config.actionTypes.TREND_ALERT],
          message: `Temperature rising: +${increase.toFixed(1)} in ${window} min`,
        },
        processed_at: new Date().toISOString(),
      };
      await publishEvent(event);
    }
  }
}

/**
 * Evaluate a single telemetry message and forward the result
 */
async function processTelemetry(telemetry) {
  const thresholds = await getThresholds(telemetry.ship_id);
  const alertType = determineAlertType(telemetry.temp, thresholds);
  const actions = determineActions(alertType);

  const event = {
    event_type: "TELEMETRY_PROCESSED",
    telemetry,
    evaluation: { alert_type: alertType, thresholds, actions },
    processed_at: new Date().toISOString(),
  };
  await publishEvent(event);
  await checkTemperatureTrend(telemetry.ship_id);
}

/**
 * Main worker loop, polls TelemetryQueue and forwards evaluated events
 */
async function startWorker() {
  await redis.connect();
  console.log("Starting Component B: Data Processor (Worker)...\n");
  console.log("Worker connected to Redis and PostgreSQL (read-only).");
  console.log(
    `Polling telemetry queue: ${TELEMETRY_QUEUE_URL} (${config.worker.pollInterval}-second interval)\n`,
  );
  console.log(`Publishing to: ${EVENTS_QUEUE_URL}`);

  let messageCount = 0;

  while (true) {
    try {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: TELEMETRY_QUEUE_URL,
          MaxNumberOfMessages: config.worker.maxMessages,
          WaitTimeSeconds: config.worker.pollInterval,
        }),
      );

      if (response.Messages && response.Messages.length > 0) {
        const processed = [];
        for (const msg of response.Messages) {
          messageCount++;
          try {
            const telemetry = JSON.parse(msg.Body);
            await processTelemetry(telemetry);

            processed.push({
              Id: msg.MessageId,
              ReceiptHandle: msg.ReceiptHandle,
            });

            console.log(
              `---- Message ${messageCount} processed and forwarded ----`,
            );
          } catch (err) {
            console.error(`Error processing message ${messageCount}:`, err);
          }
        }

        // Batch-delete all successfully processed messages (up to 10 per call)
        if (processed.length > 0) {
          await sqsClient.send(
            new DeleteMessageBatchCommand({
              QueueUrl: TELEMETRY_QUEUE_URL,
              Entries: processed,
            }),
          );
          console.log(
            `Batch-deleted ${processed.length} message(s) from TelemetryQueue\n`,
          );
        }
      } else {
        process.stdout.write(".");
      }
    } catch (err) {
      console.error("Error polling telemetry queue:", err);
      await new Promise((resolve) =>
        setTimeout(resolve, config.worker.errorRetryMs),
      );
    }
  }
}

// Graceful shutdown
async function shutdown() {
  console.log("\n\nShutting down worker...");
  await redis.quit();
  await db.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start
startWorker().catch(async (err) => {
  console.error("Fatal error:", err);
  await redis.quit();
  await db.end();
  process.exit(1);
});
