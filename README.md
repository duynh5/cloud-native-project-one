# Cloud-Native IoT Temperature Monitoring System

A distributed cloud-native application that monitors temperature in refrigerated seafood cargo ships using **SQS** (queuing), **Redis** (caching), and **PostgreSQL** (database). See the [Project Report](docs/PROJECT_REPORT.md) for more details.

## System Architecture

```text
IoT Sensors ──HTTP POST──▶ Ingestor ──SQS──▶ Worker ──SQS──▶ Executor
                          (Component A)    (Component B)    (Component C)
                                            ├─ Redis         ├─ PostgreSQL
                                            └─ PostgreSQL    └─ Notifications
```

| Component | Technology | Purpose |
| --------- | ---------- | ------- |
| **Queuing** | AWS SQS (LocalStack locally) | Decouples ingestion from processing |
| **Caching** | Redis | Fast threshold lookups |
| **Database** | PostgreSQL | Persistent storage for telemetry & alerts |

## Local Development Prerequisites

- Node.js v18+ and npm
- Docker and Docker Compose

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install
cd ingestor && npm install && cd ..
cd worker && npm install && cd ..
cd executor && npm install && cd ..

# 2. Start infrastructure (LocalStack, PostgreSQL, Redis)
npm run docker:up

# 3. Initialize queues, database tables, and cache
npm run setup

# 4. Run each in a separate terminal:
npm run start:ingestor    # Terminal 1 — HTTP server on port 3000
npm run start:worker      # Terminal 2 — Polls SQS, evaluates business rules
npm run start:executor    # Terminal 3 — Stores data, sends notifications

# 5. Start the IoT simulator
npm run start:simulator   # Sends fake sensor data every 10 seconds
```

To stop:

```bash
# Ctrl+C in each terminal, then:
npm run docker:down
```

## Project File Structure

```text
cloud-native-project-one/
├── ingestor/              # Component A: HTTP ingestion → SQS
├── worker/                # Component B: Business rules, Redis, trend detection
├── executor/              # Component C: Storage, alerts, notifications
├── shared/config.js       # Centralized environment-based configuration
├── seed/                  # Seed data for setup scripts (ship-thresholds.json)
├── scripts/               # Setup scripts (db-setup, cache-setup, sqs-queue-setup)
├── deploy/                # PM2 ecosystem config for AWS
├── simulator/             # Local dev tools (simulator, docker-compose)
└── docs/                  # Documentation
```

## AWS Migration Guide

The application does not require any code changes to run on AWS, only the `.env` file changes. See the [AWS Migration Guide](docs/AWS_MIGRATION_GUIDE.md) for step-by-step instructions.

## Other Documentation

- See [PROJECT_REPORT.md](docs/PROJECT_REPORT.md) for full project report (problem statement, architecture, design decisions)
