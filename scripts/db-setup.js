/**
 * Database Setup Script
 *
 * Creates PostgreSQL tables and indexes, then seeds ship configurations
 *
 * Tables:
 * - telemetry_readings: raw sensor data from Component A
 * - alerts: WARNING, CRITICAL, and TREND_ANOMALY alerts from Component C
 * - temperature_actions: temperature adjustment requests from Component C
 * - ship_configs: seeded per-ship threshold configurations
 *
 * Seed data loaded from seed/ship-thresholds.json
 * Runs once during deployment (both local and AWS)
 */

import pkg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import config from "../shared/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Client } = pkg;
const db = new Client({
  connectionString: config.postgres.connectionString,
});

async function initDB() {
  try {
    await db.connect();
    console.log("Connected to Postgres!");

    // Create telemetry table to store all telemetry readings
    // for audit and analyses
    const createTelemetryTable = `
      CREATE TABLE IF NOT EXISTS telemetry_readings (
        id SERIAL PRIMARY KEY,
        ship_id VARCHAR(50) NOT NULL,
        sensor_id VARCHAR(50),
        temperature DECIMAL(5,2) NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Create indexes for telemetry table
    const createTelemetryIndexes = `
      CREATE INDEX IF NOT EXISTS idx_ship_timestamp ON telemetry_readings(ship_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON telemetry_readings(timestamp);
    `;

    // Create alerts table to store all alerts and actions taken
    const createAlertsTable = `
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        ship_id VARCHAR(50) NOT NULL,
        temperature DECIMAL(5,2) NOT NULL,
        threshold DECIMAL(5,2) NOT NULL,
        alert_type VARCHAR(20) NOT NULL,
        action_taken VARCHAR(50),
        message TEXT,
        resolved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      );
    `;

    // Create indexes for alerts table
    const createAlertsIndexes = `
      CREATE INDEX IF NOT EXISTS idx_ship_created ON alerts(ship_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_alert_type ON alerts(alert_type);
      CREATE INDEX IF NOT EXISTS idx_resolved ON alerts(resolved);
    `;

    // Create temperature actions table to store all adjustment requests
    const createActionsTable = `
      CREATE TABLE IF NOT EXISTS temperature_actions (
        id SERIAL PRIMARY KEY,
        ship_id VARCHAR(50) NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        current_temp DECIMAL(5,2),
        target_temp DECIMAL(5,2),
        status VARCHAR(20) DEFAULT 'PENDING',
        executed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Create indexes for temperature actions table
    const createActionsIndexes = `
      CREATE INDEX IF NOT EXISTS idx_ship_status ON temperature_actions(ship_id, status);
    `;

    // Create ship configurations table to store all ship configurations
    const createShipConfigTable = `
      CREATE TABLE IF NOT EXISTS ship_configs (
        ship_id VARCHAR(50) PRIMARY KEY,
        warning_threshold DECIMAL(5,2) DEFAULT -10,
        critical_threshold DECIMAL(5,2) DEFAULT -5,
        target_temperature DECIMAL(5,2) DEFAULT -18,
        notification_email VARCHAR(255),
        active BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await db.query(createTelemetryTable);
    console.log("Table 'telemetry_readings' is ready.");
    await db.query(createTelemetryIndexes);
    console.log("Indexes for 'telemetry_readings' created.");

    await db.query(createAlertsTable);
    console.log("Table 'alerts' is ready.");
    await db.query(createAlertsIndexes);
    console.log("Indexes for 'alerts' created.");

    await db.query(createActionsTable);
    console.log("Table 'temperature_actions' is ready.");
    await db.query(createActionsIndexes);
    console.log("Indexes for 'temperature_actions' created.");

    await db.query(createShipConfigTable);
    console.log("Table 'ship_configs' is ready.");

    // Load ship configurations from seed file
    const configPath = join(__dirname, "..", "seed", "ship-thresholds.json");
    const thresholdsConfig = JSON.parse(readFileSync(configPath, "utf-8"));

    // Insert ship configurations from seed file
    for (const ship of thresholdsConfig.ships) {
      const insertConfig = `
        INSERT INTO ship_configs (ship_id, warning_threshold, critical_threshold, target_temperature)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (ship_id) DO NOTHING;
      `;

      await db.query(insertConfig, [
        ship.ship_id,
        ship.thresholds.warning,
        ship.thresholds.critical,
        ship.thresholds.target,
      ]);

      console.log(`${ship.ship_id} configured`);
    }

    console.log("Ship configurations inserted from seed file.");

    await db.end();
    console.log("Database setup complete!");
  } catch (err) {
    console.error("Database setup failed:", err);
    process.exit(1);
  }
}

initDB();
