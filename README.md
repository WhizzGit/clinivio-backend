# MediFlow Backend

NestJS microservices monorepo for MediFlow Hospital Management System.

**Frontend repo:** [mediflow-frontend](https://github.com/YOUR_ORG/mediflow-frontend)

## Architecture

| Service | Port | Responsibility |
|---|---|---|
| `iam-service` | 3001 | Auth, JWT, tenant onboarding |
| `patient-service` | 3002 | Patient registration & records |
| `appointment-service` | 3003 | OPD, IPD, Lab, Pharmacy, Stats |
| `whatsapp-engine` | 3004 | WhatsApp Business API webhooks |
| `notification-service` | 3005 | SMS/email delivery |
| `billing-service` | 3006 | Invoices & Razorpay payments |

**Infrastructure:**
- **Database**: [Neon](https://neon.tech) PostgreSQL (serverless)
- **Redis**: Render managed Redis (prod) / Docker (dev)
- **Kafka**: [Upstash Kafka](https://upstash.com/kafka) (prod) / Docker (dev)

---

## Local Development

### Prerequisites
- Node.js 20+
- pnpm 8+
- Docker (for Redis + Kafka)

```bash
# 1. Install dependencies
pnpm install

# 2. Start infrastructure (Redis + Kafka)
docker-compose up -d

# 3. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL to your Neon pooler URL

# 4. Push schema to DB (first time only)
#    Use DIRECT endpoint (no -pooler) for migrations:
DATABASE_URL="postgresql://...@ep-xxxx.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require" \
  pnpm db:push

# 5. Seed demo data
pnpm db:seed

# 6. Start all services
pnpm dev
```

Services start at: `localhost:3001` through `localhost:3006`

---

## Deploy to Render

### One-click via Blueprint
1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New → Blueprint**
3. Connect the `mediflow-backend` GitHub repo
4. Render reads `render.yaml` and provisions all 6 services + Redis automatically
5. After first deploy, set these **secret** env vars in each service's dashboard:

**All services need:**
- `DATABASE_URL` → your Neon pooler URL
- `KAFKA_BROKERS` → Upstash Kafka bootstrap (e.g. `your-cluster.upstash.io:9092`)
- `KAFKA_SASL_USERNAME` → Upstash username
- `KAFKA_SASL_PASSWORD` → Upstash password
- `KAFKA_SSL` → `true`
- `JWT_SECRET` → same 64-char hex across all services
- `JWT_REFRESH_SECRET` → same 64-char hex across all services

**billing-service additionally:**
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`

**whatsapp-engine additionally:**
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`

### Upstash Kafka Setup
1. Go to [console.upstash.com](https://console.upstash.com) → **Kafka** → **Create Cluster**
2. Region: **AWS ap-south-1** (Mumbai)
3. Copy **Bootstrap Server**, **Username**, **Password** from cluster details
4. Set them as env vars on each Render service

### Neon Database Setup
1. Go to [console.neon.tech](https://console.neon.tech)
2. Create project → copy the **Pooler** connection string
3. Use pooler URL as `DATABASE_URL` in Render
4. Use **direct** URL (without `-pooler`) only for `prisma migrate deploy`

---

## Database Migrations (Production)

```bash
# Run migrations against production DB (use direct endpoint):
DATABASE_URL="postgresql://...@ep-xxxx.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require" \
  pnpm db:migrate
```

---

## Tech Stack

- **Runtime**: Node.js 20 + NestJS 10
- **ORM**: Prisma 5 (schema: `libs/database/prisma/schema.prisma`)
- **Auth**: Passport.js + JWT
- **Queue**: KafkaJS + Bull/Redis
- **Validation**: class-validator + class-transformer
- **Docs**: Swagger (auto-generated at `/api`)
