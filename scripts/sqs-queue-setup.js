/**
 * SQS Queue Setup Script
 *
 * Creates (or confirms existence of) the two SQS queues:
 * - ShipTelemetryQueue: Component A (Ingestor) <-> Component B (Worker)
 * - AlertEventsQueue: Component B (Worker) <-> Component C (Executor)
 *
 * Outputs the queue URLs to add to .env
 * Runs once during deployment (both local and AWS)
 */

import {
  SQSClient,
  CreateQueueCommand,
  GetQueueUrlCommand,
} from "@aws-sdk/client-sqs";
import config from "../shared/config.js";

// When endpoint is undefined, the SDK connects to real AWS
const sqsClient = new SQSClient({
  region: config.sqs.region,
  endpoint: config.sqs.endpoint,
  credentials: config.sqs.credentials,
});

/**
 * Create a single SQS queue (or confirm it already exists)
 */
async function ensureQueue(queueName) {
  try {
    const getUrlCommand = new GetQueueUrlCommand({ QueueName: queueName });
    const urlResponse = await sqsClient.send(getUrlCommand);
    console.log(`${queueName} already exists at: ${urlResponse.QueueUrl}`);
    return urlResponse.QueueUrl;
  } catch (_err) {
    console.log(`${queueName} doesn't exist yet, creating...`);
  }

  const response = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: {
        VisibilityTimeout: config.sqs.visibilityTimeout,
        MessageRetentionPeriod: config.sqs.messageRetentionPeriod,
      },
    }),
  );
  console.log(`${queueName} created at: ${response.QueueUrl}`);
  return response.QueueUrl;
}

async function createQueues() {
  try {
    console.log("Setting up SQS queues...\n");

    // 1. Telemetry queue: Component A (Ingestor) → Component B (Processor)
    const telemetryUrl = await ensureQueue(config.sqs.telemetryQueueName);

    // 2. Events queue: Component B (Processor) → Component C (Executor)
    const eventsUrl = await ensureQueue(config.sqs.eventsQueueName);

    console.log("\nAdd these to your .env file:");
    console.log(`TELEMETRY_QUEUE_URL=${telemetryUrl}`);
    console.log(`EVENTS_QUEUE_URL=${eventsUrl}`);
    console.log("\nQueue setup complete!");
  } catch (err) {
    console.error("Error creating queues:", err);
    process.exit(1);
  }
}

createQueues();
