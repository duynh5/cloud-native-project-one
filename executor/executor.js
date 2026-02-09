/**
 * Component C: Event Executor
 *
 * Polls the EventsQueue for evaluated events from Component B,
 * then executes the corresponding actions: stores data in PostgreSQL
 * and sends notifications for warning/critical alerts.
 *
 * All business rule evaluation is done by Component B.
 * This service only executes the resulting events.
 *
 * Connections: SQS (read EventsQueue) + PostgreSQL (persistent storage)
 */
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
} from "@aws-sdk/client-sqs";
import pkg from "pg";
import config from "../shared/config.js";

const { Pool } = pkg;

const EVENTS_QUEUE_URL = config.sqs.eventsQueueUrl;
const sqsClient = new SQSClient({
  region: config.sqs.region,
  endpoint: config.sqs.endpoint,
  credentials: config.sqs.credentials,
});

const db = new Pool({
  connectionString: config.postgres.connectionString,
  max: config.postgres.maximumPoolSizeExecutor,
  idleTimeoutMillis: config.postgres.idleTimeoutMillis,
});

/** Store a telemetry reading in PostgreSQL */
async function storeTelemetry(telemetry) {
  const dbValues = [
    telemetry.ship_id,
    telemetry.sensor_id,
    telemetry.temp,
    telemetry.timestamp,
    new Date().toISOString(),
  ];
  await db.query(
    `INSERT INTO telemetry_readings (ship_id, sensor_id, temperature, timestamp, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    dbValues,
  );
  console.log(`Telemetry stored: ${dbValues}`);
}

/** Store an alert (WARNING, CRITICAL, or TREND_ANOMALY) in PostgreSQL */
async function storeAlert(telemetry, evaluation, action) {
  const threshold =
    evaluation.alert_type === config.alertTypes.CRITICAL
      ? evaluation.thresholds.critical
      : evaluation.alert_type === config.alertTypes.WARNING
        ? evaluation.thresholds.warning
        : 0;

  const message =
    evaluation.message ||
    `${evaluation.alert_type} | ${telemetry.ship_id}_${telemetry.sensor_id} | ${telemetry.temp} > ${threshold} degrees threshold`;

  const dbValues = [
    telemetry.ship_id,
    telemetry.temp,
    threshold,
    evaluation.alert_type,
    action,
    message,
    new Date().toISOString(),
  ];
  await db.query(
    `INSERT INTO alerts (ship_id, temperature, threshold, alert_type, action_taken, message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    dbValues,
  );
  console.log(`Alert stored: ${dbValues}`);
}

/** Store a temperature adjustment request in PostgreSQL */
async function storeTemperatureAction(telemetry, targetTemp) {
  const dbValues = [
    telemetry.ship_id,
    config.actionTypes.ADJUST_TEMPERATURE,
    telemetry.temp,
    targetTemp,
    "PENDING",
    new Date().toISOString(),
  ];
  await db.query(
    `INSERT INTO temperature_actions (ship_id, action_type, current_temp, target_temp, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    dbValues,
  );
  console.log(`Adjust temp stored: ${dbValues}`);
}

/** Send webhook notification for non-NORMAL alerts */
async function sendNotification(telemetry, evaluation) {
  if (
    !config.notifications.webhook.enabled ||
    !config.notifications.webhook.url
  )
    return;

  try {
    await fetch(config.notifications.webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alert_type: evaluation.alert_type,
        ship_id: telemetry.ship_id,
        temperature: telemetry.temp,
        timestamp: telemetry.timestamp,
        thresholds: evaluation.thresholds,
      }),
    });
  } catch (err) {
    console.error(`Webhook failed: ${err.message}`);
  }
}

/** Process a single event from EventsQueue */
async function processEvent(event) {
  const { telemetry, evaluation } = event;

  for (const action of evaluation.actions) {
    if (action === config.actionTypes.LOG) {
      await storeTelemetry(telemetry);
    }
    if (action === config.actionTypes.NOTIFY_WARNING) {
      await storeAlert(telemetry, evaluation, action);
      await sendNotification(telemetry, evaluation);
    }
    if (action === config.actionTypes.NOTIFY_CRITICAL) {
      await storeAlert(telemetry, evaluation, action);
      await sendNotification(telemetry, evaluation);
    }
    if (action === config.actionTypes.ADJUST_TEMPERATURE) {
      await storeAlert(telemetry, evaluation, action);
      await storeTemperatureAction(telemetry, evaluation.thresholds.target);
    }
    if (action === config.actionTypes.TREND_ALERT) {
      await storeAlert(telemetry, evaluation, action);
    }
  }
}

/** POLLING LOOP */
async function startExecutor() {
  console.log(
    `Starting Component C: Event Executor... Polling events queue: ${EVENTS_QUEUE_URL} (${config.executor.pollInterval}-second interval)\n`,
  );

  let eventCount = 0;

  while (true) {
    try {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: EVENTS_QUEUE_URL,
          MaxNumberOfMessages: config.executor.maxMessages,
          WaitTimeSeconds: config.executor.pollInterval,
        }),
      );

      if (response.Messages && response.Messages.length > 0) {
        const processed = [];
        for (const msg of response.Messages) {
          eventCount++;
          try {
            const event = JSON.parse(msg.Body);
            await processEvent(event);

            processed.push({
              Id: msg.MessageId,
              ReceiptHandle: msg.ReceiptHandle,
            });
            console.log(`---- Event ${eventCount} processed ----`);
          } catch (err) {
            console.error(`Error processing event ${eventCount}:`, err);
          }
        }

        // Batch-delete all successfully processed messages (up to 10 per call)
        if (processed.length > 0) {
          await sqsClient.send(
            new DeleteMessageBatchCommand({
              QueueUrl: EVENTS_QUEUE_URL,
              Entries: processed,
            }),
          );
          console.log(
            `Batch-deleted ${processed.length} event(s) from EventsQueue\n`,
          );
        }
      } else {
        process.stdout.write(".");
      }
    } catch (err) {
      console.error("Error polling events queue:", err);
      await new Promise((resolve) =>
        setTimeout(resolve, config.executor.errorRetryMs),
      );
    }
  }
}

// Graceful shutdown
async function shutdown() {
  console.log("\n\nShutting down executor...");
  await db.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start
startExecutor().catch(async (err) => {
  console.error("Fatal error:", err);
  await db.end();
  process.exit(1);
});
