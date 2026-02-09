/**
 * IoT Temperature Monitoring System - Temperature Simulator
 *
 * Simulates temperature readings from multiple ships with multiple sensors each.
 * Sends readings to the ingestor service
 */

import config from "../shared/config.js";

const INGESTOR_URL = config.ingestor.url;

// Simulate 3 ships, with various number of sensors
const ships = [
  {
    id: "ship_1",
    name: "Salmon Carrier",
    baseTemp: -18,
    variance: 8,
    sensors: 2,
  },
  {
    id: "ship_2",
    name: "Tuna Carrier",
    baseTemp: -15,
    variance: 7,
    sensors: 3,
  },
  {
    id: "ship_3",
    name: "Lobster Carrier",
    baseTemp: -20,
    variance: 6,
    sensors: 1,
  },
];

let readingCount = 0;

/**
 * Generate a temperature reading for the entire ship.
 * Represents the actual cargo hold temperature.
 * Generates anomalies to trigger alerts (critical, warning, normal)
 */
function generateShipTemperature(ship) {
  // The chance of an anomaly is 5% for critical and 10% for warning
  const roll = Math.random();

  if (roll < 0.05) {
    // Critical anomaly (5%): guaranteed 5-10 degrees beyond variance
    const anomaly = 5 + Math.random() * 5;
    return ship.baseTemp + ship.variance + anomaly;
  }

  if (roll < 0.15) {
    // Warning anomaly (10%): guaranteed 1-5 degrees beyond variance
    const anomaly = 1 + Math.random() * 4;
    return ship.baseTemp + ship.variance + anomaly;
  }

  // Normal fluctuation (85%): temperature within +/- variance range
  const fluctuation = (Math.random() * 2 - 1) * ship.variance;
  return ship.baseTemp + fluctuation;
}

/**
 * Generate sensor reading from ship reading. Sensors in the same cargo
 * hold should provide similar temperature readings, but within small
 * 0.5 variations from the actual ship temperature to reflect real-world
 * sensor inaccuracy/noise
 */
function generateSensorReading(shipTemp) {
  const sensorVariation = Math.random() - 0.5;
  return shipTemp + sensorVariation;
}

/**
 * Send a single reading to the ingestor service
 */
async function sendReadingToIngestor(ship, sensorId, shipTemp) {
  const temp = generateSensorReading(shipTemp);
  const reading = {
    ship_id: ship.id,
    sensor_id: sensorId,
    temp: parseFloat(temp.toFixed(2)),
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(`${INGESTOR_URL}/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reading),
    });

    if (response.ok) {
      readingCount++;
      console.log(`${readingCount} | ${Object.values(reading).join(" | ")}`);
    } else {
      console.error(
        `[ERROR] ${response.status}, Failed to send reading for ${Object.values(reading).join(" | ")}`,
      );
    }
  } catch (err) {
    console.error(
      `[ERROR] Error sending data for ${ship.id} | ${reading.sensor_id}`,
      err.message,
    );
  }
}

/**
 * Send all readings for all ships to the ingestor service
 */
async function sendAllShipsReadingsToIngestor() {
  for (const ship of ships) {
    const shipTemp = generateShipTemperature(ship);

    for (let i = 0; i < ship.sensors; i++) {
      const sensorId = `${ship.id}_sensor_${i + 1}`;
      await sendReadingToIngestor(ship, sensorId, shipTemp);
    }
  }
}

/**
 * Ingestor health check
 */
async function checkIngestor() {
  try {
    const response = await fetch(`${INGESTOR_URL}/health`);
    if (response.ok) {
      console.log("Ingestor service is healthy!");
      return true;
    }
  } catch (err) {
    console.error(`[ERROR] Cannot connect to ingestor at ${INGESTOR_URL}`);
    return false;
  }
}

/**
 * Send readings on interval
 */
console.log(
  `Sending ship temperature telemetry data every ${config.simulator.intervalMs / 1000} seconds to: ${INGESTOR_URL}`,
);
console.log(
  `Simulating ${ships.length} ships, with a total of ${ships.reduce((acc, ship) => acc + ship.sensors, 0)} sensors`,
);
checkIngestor().then((healthy) => {
  if (healthy) {
    sendAllShipsReadingsToIngestor();
    setInterval(sendAllShipsReadingsToIngestor, config.simulator.intervalMs);
  } else {
    process.exit(1);
  }
});
