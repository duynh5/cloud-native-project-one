/**
 * Cache Setup Script
 *
 * Initializes Redis cache with ship-specific temperature thresholds.
 *
 * DESIGN NOTE:
 * - Thresholds are loaded from seed/ship-thresholds.json
 * - This separates business rules (data) from infrastructure code
 * - Allows non-technical users to update thresholds without code changes
 * - Runs once during deployment (both local and AWS)
 *
 * Format in Redis:
 * - threshold:{ship_id}:warning
 * - threshold:{ship_id}:critical
 * - threshold:{ship_id}:target
 */

import { createClient } from "redis";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import config from "../shared/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = createClient({ url: config.redis.url });

async function initCache() {
  try {
    await client.connect();
    console.log("Connected to Redis!");

    // Load business rules from seed file
    const configPath = join(__dirname, "..", "seed", "ship-thresholds.json");
    const thresholdsConfig = JSON.parse(readFileSync(configPath, "utf-8"));

    console.log(
      `Loading thresholds for ${thresholdsConfig.ships.length} ships from seed file...\n`,
    );

    // Set thresholds for each ship
    for (const ship of thresholdsConfig.ships) {
      await client.set(
        `threshold:${ship.ship_id}:warning`,
        ship.thresholds.warning.toString(),
      );
      await client.set(
        `threshold:${ship.ship_id}:critical`,
        ship.thresholds.critical.toString(),
      );
      await client.set(
        `threshold:${ship.ship_id}:target`,
        ship.thresholds.target.toString(),
      );

      console.log(
        `${ship.ship_id}: Warning ${ship.thresholds.warning}, Critical ${ship.thresholds.critical}, Target ${ship.thresholds.target}`,
      );
    }

    // Set default thresholds (used if ship-specific not found)
    await client.set(
      "threshold:default:warning",
      thresholdsConfig.defaults.warning.toString(),
    );
    await client.set(
      "threshold:default:critical",
      thresholdsConfig.defaults.critical.toString(),
    );
    await client.set(
      "threshold:default:target",
      thresholdsConfig.defaults.target.toString(),
    );

    console.log(
      `\nDefault thresholds: Warning ${thresholdsConfig.defaults.warning}, Critical ${thresholdsConfig.defaults.critical}, Target ${thresholdsConfig.defaults.target}`,
    );
    console.log("\nBusiness rules and thresholds configured in Redis.");

    await client.quit();
  } catch (err) {
    console.error("Redis setup failed:", err);
    process.exit(1);
  }
}

initCache();
