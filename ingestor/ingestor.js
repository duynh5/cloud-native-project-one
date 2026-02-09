/**
 * Component A: Telemetry Ingestor (Ingestor)
 *
 * Receives telemetry data from IoT sensors and queues it to TelemetryQueue
 *
 * Connections: HTTP (receive telemetry) + SQS (write TelemetryQueue)
 */

import express from "express";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import config from "../shared/config.js";

const app = express();
app.use(express.json());

// Setup connections
const TELEMETRY_QUEUE_URL = config.sqs.telemetryQueueUrl;
const sqsClient = new SQSClient({
  region: config.sqs.region,
  endpoint: config.sqs.endpoint,
  credentials: config.sqs.credentials,
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "healthy", service: "ingestor" });
});

// Main telemetry ingestion endpoint
app.post("/telemetry", async (req, res) => {
  const { ship_id, temp, timestamp, sensor_id } = req.body;

  // Validate ship ID and timestamp
  if (!ship_id || !timestamp) {
    return res.status(400).json({
      error: "Missing required field(s): ship_id, timestamp",
    });
  }

  // Validate temperature
  if (
    temp === undefined ||
    temp === null ||
    (typeof temp !== "number" && isNaN(parseFloat(temp)))
  ) {
    return res.status(400).json({
      error: "Invalid temperature reading",
    });
  }

  const message = {
    ship_id,
    sensor_id: sensor_id || `${ship_id}_default_sensor`,
    temp: parseFloat(temp),
    timestamp,
  };

  // Send telemetry data to SQS queue
  try {
    const data = await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: TELEMETRY_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      }),
    );
    const successMessage = `Queued: ${Object.values(message).join(" | ")}`;
    res
      .status(200)
      .json({ message: successMessage, messageId: data.MessageId });
    console.log(successMessage);
  } catch (err) {
    const error = `Sending telemetry to queue failed: ${err.message}`;
    res.status(500).json({ error });
    console.error(error);
  }
});

app.listen(config.ingestor.port, config.ingestor.host, () => {
  console.log(
    `Ingestor service running on ${config.ingestor.host}:${config.ingestor.port}. Queue URL: ${TELEMETRY_QUEUE_URL}`,
  );
  console.log(`Ready to receive telemetry data at POST /telemetry`);
});
