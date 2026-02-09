# AWS Migration Guide

This guide covers migrating the IoT Temperature Monitoring System from local Docker-based development to AWS. No code changes are needed — the application reads all endpoints from environment variables.

---

## Prerequisites

- AWS account with billing enabled and billing alerts configured ($10, $25, $50)
- AWS CLI installed and configured: `aws configure`
- EC2 key pair created in your region
- Local setup tested and working (`npm run docker:up && npm run setup`)

---

## Local vs AWS

| Component | Local | AWS |
| --------- | ----- | --- |
| Queues (×2) | LocalStack SQS (`localhost:4566`) | Amazon SQS |
| Cache | Docker Redis (`localhost:6379`) | Amazon ElastiCache |
| Database | Docker PostgreSQL (`localhost:5432`) | Amazon RDS |
| App processes | `node` / `npm run start:*` | EC2 + PM2 |

**What changes**: Only the `.env` file (endpoints). All application code stays the same.

---

## Step 1: Create AWS Infrastructure

### 1.1 SQS Queues

Create **two** standard queues in the AWS Console:

| Queue | Route | Settings |
| ----- | ----- | -------- |
| `ShipTelemetryQueue` | Ingestor → Worker | Visibility: 30s, Retention: 1 day, Long poll: 20s |
| `AlertEventsQueue` | Worker → Executor | Visibility: 30s, Retention: 1 day, Long poll: 20s |

Save both queue URLs for the `.env` file.

### 1.2 RDS PostgreSQL

- Engine: PostgreSQL 15.x
- Instance: `db.t4g.micro` (free tier eligible)
- Storage: 20 GB gp3
- Database name: `ship_db`, Username: `postgres`
- Public access: No (EC2 only)
- Security group: Allow port 5432 from EC2 security group

### 1.3 ElastiCache Redis

- Engine: Redis 7.x
- Node type: `cache.t3.micro`
- Replicas: 0 (single node)
- Security group: Allow port 6379 from EC2 security group

### 1.4 IAM Role

Create an IAM role for EC2 with `AmazonSQSFullAccess`. Attach it to your instance(s) so you don't need AWS credentials in `.env`.

---

## Step 2: Deploy to EC2

### Option A: Monolithic (Single Instance)

All three processes run on one EC2 via PM2.

```text
┌───────────────────────────────────────────────────┐
│              Single EC2 Instance                  │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Ingestor  │  │  Worker  │  │   Executor   │  │
│  │(Port 3000)│  │(Bg Poll) │  │  (Bg Poll)   │  │
│  └─────┬─────┘  └────┬─────┘  └──────┬───────┘  │
└────────┼─────────────┼────────────────┼───────────┘
         ▼             ▼                ▼
    ┌──────────┐  ┌──────────┐    ┌─────────┐
    │ AWS SQS  │  │ElastiCache│   │ AWS RDS │
    │ (×2 Qs)  │  │  (Redis)  │   │(Postgres)│
    └──────────┘  └──────────┘    └─────────┘
```

**Launch EC2:**

- AMI: Amazon Linux 2023 or Ubuntu 22.04 LTS
- Instance type: `t3.micro` (1 GB RAM — free tier eligible)
- Security group: SSH (22) from your IP, HTTP (3000) from anywhere
- IAM role: the SQS role from Step 1.4
- Storage: 20 GB gp3

**Install dependencies and deploy:**

```bash
ssh -i your-key.pem ec2-user@YOUR_EC2_IP

# System + Node.js + PM2
sudo yum update -y
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs git
sudo npm install -g pm2

# Clone and install
cd /home/ec2-user
git clone https://github.com/duynh5/cloud-native-project-one.git
cd cloud-native-project-one
npm install
cd ingestor && npm install && cd ..
cd worker && npm install && cd ..
cd executor && npm install && cd ..
```

**Configure environment:**

```bash
cp .env.aws.example .env
nano .env
```

```bash
AWS_REGION=us-east-1
SQS_ENDPOINT=                    # leave empty for real AWS
TELEMETRY_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/YOUR_ACCOUNT_ID/ShipTelemetryQueue
EVENTS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/YOUR_ACCOUNT_ID/AlertEventsQueue
REDIS_URL=redis://YOUR_ELASTICACHE_ENDPOINT:6379
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@YOUR_RDS_ENDPOINT:5432/ship_db
INGESTOR_PORT=3000
INGESTOR_HOST=0.0.0.0
WORKER_POLL_INTERVAL=20
WORKER_MAX_MESSAGES=10
EXECUTOR_POLL_INTERVAL=20
EXECUTOR_MAX_MESSAGES=10
TREND_WINDOW_MINUTES=5
```

**Initialize and start:**

```bash
npm run setup:db
npm run setup:cache
pm2 start deploy/pm2-ecosystem.config.js
pm2 save
pm2 startup   # follow printed instructions
```

### Option B: Distributed (Three Instances)

Each component runs on its own EC2 for independent scaling and fault isolation.

```text
┌──────────────┐
│EC2: Ingestor │
│  Port 3000   │
└──────┬───────┘
       ▼
  ┌──────────┐       ┌──────────┐
  │ SQS:     │       │ElastiCache│
  │Telemetry │       │  (Redis)  │
  └────┬─────┘       └─────┬─────┘
       ▼                   │
┌──────────────┐◄──────────┘
│EC2: Worker   │
│ Rules+Trends │
└──────┬───────┘
       ▼
  ┌──────────┐
  │ SQS:     │
  │ Events   │
  └────┬─────┘
       ▼
┌──────────────┐       ┌─────────┐
│EC2: Executor │──────►│ AWS RDS │
│ Store+Notify │       │(Postgres)│
└──────────────┘       └─────────┘
```

| Instance | Type | Security Group | IAM Permissions |
| -------- | ---- | -------------- | --------------- |
| Ingestor | `t3.micro` | SSH + port 3000 inbound | SQS write |
| Worker | `t3.micro` | SSH only (no public inbound) | SQS read/write |
| Executor | `t3.micro` | SSH only (no public inbound) | SQS read |

On each instance: follow the same install steps as Option A, but start only the relevant process:

```bash
# Ingestor instance
pm2 start ingestor/ingestor.js --name ingestor

# Worker instance
pm2 start worker/worker.js --name worker

# Executor instance (run setup:db and setup:cache here first)
pm2 start executor/executor.js --name executor
```

Run `pm2 save && pm2 startup` on each instance.

Optional: Add an Application Load Balancer in front of the ingestor (target group port 3000, health check `GET /health`).

---

## Step 3: Verify

```bash
# Health check
curl http://YOUR_EC2_IP:3000/health

# Send test telemetry
curl -X POST http://YOUR_EC2_IP:3000/telemetry \
  -H "Content-Type: application/json" \
  -d '{"ship_id":"ship_1","temp":-12.5,"timestamp":"2026-02-10T10:00:00Z"}'

# Check data reached the database
psql $DATABASE_URL -c "SELECT * FROM telemetry_readings ORDER BY created_at DESC LIMIT 5;"

# Check PM2 logs
pm2 logs
```

To run the simulator against AWS, set `INGESTOR_URL=http://YOUR_EC2_IP:3000` locally and run `npm run start:simulator`.

---

## Updating the Application

```bash
cd /home/ec2-user/cloud-native-project-one
git pull
npm install
cd ingestor && npm install && cd ..
cd worker && npm install && cd ..
cd executor && npm install && cd ..
pm2 restart all
```

---

## Cost Estimation

### Monolithic (1 EC2)

| Service | Monthly Cost |
| ------- | ------------ |
| EC2 t3.micro (1 GB RAM, 24/7) | ~$8.50 |
| RDS db.t4g.micro (PostgreSQL, 20 GB) | ~$12.50 |
| ElastiCache cache.t3.micro | ~$12.00 |
| SQS (~100K batch-optimized requests) | ~$0.04 |
| Data transfer (10 GB outbound) | ~$0.90 |
| **Total** | **~$34/month** |

### Distributed (3 EC2s)

| Service | Monthly Cost |
| ------- | ------------ |
| EC2 t3.micro × 3 | ~$25.50 |
| RDS db.t4g.micro | ~$12.50 |
| ElastiCache cache.t3.micro | ~$12.00 |
| SQS (~200K batch-optimized requests) | ~$0.08 |
| Data transfer (10 GB outbound) | ~$0.90 |
| **Total** | **~$52/month** |

**Free tier** (first 12 months): EC2 t3.micro 750 hrs + RDS db.t4g.micro 750 hrs + 1M SQS requests free. Monolithic drops to ~$12/month.

---

## Security

- **IAM roles** on EC2 instead of hardcoded credentials
- **Security groups**: Ingestor allows port 3000; Worker/Executor have no public inbound; RDS and ElastiCache only accept traffic from EC2 security group
- **VPC**: RDS and ElastiCache in private subnets, EC2 in public subnet
- **Secrets**: Use AWS Secrets Manager for database passwords; never commit credentials to Git

---

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| Cannot connect to RDS | Security group must allow port 5432 from EC2 SG |
| Cannot connect to ElastiCache | Must be in same VPC as EC2; check port 6379 in SG |
| SQS permissions denied | Verify IAM role with SQS access is attached to EC2 |
| Worker not processing | `pm2 logs worker` — check queue URL in `.env` |
| Executor not processing | `pm2 logs executor` — check `EVENTS_QUEUE_URL` in `.env` |

---

## Cleanup

```bash
pm2 stop all && pm2 delete all
```

Delete AWS resources in reverse order: EC2 → ElastiCache → RDS → SQS → Security Groups → IAM Roles.
