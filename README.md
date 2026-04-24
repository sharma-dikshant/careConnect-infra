# CareConnect Infrastructure

AWS CDK (TypeScript) stack that provisions a dev-grade environment for
CareConnect: three EC2 instances (frontend, backend, RAG), RDS Postgres, an
S3 bucket, and a helper Lambda — all inside a single VPC with public
subnets only.

See the top-level [`DEVELOPER_GUIDE.md`](../DEVELOPER_GUIDE.md) for how this
infrastructure is used by the rest of the project.

> This stack targets speed of iteration, not production readiness. Everything
> is public, security groups are wide open by design, and access to EC2 is via
> AWS Systems Manager Session Manager (port 22 is closed).

---

## Resources

| Resource           | Type / Size                    | Access              |
|--------------------|--------------------------------|---------------------|
| VPC                | 2 AZs, public subnets only     | —                   |
| Frontend EC2       | t3.micro, ports 80/443         | Public              |
| Backend EC2        | t3.micro, port 3000            | Public              |
| RAG server EC2     | t3.micro, port 8000            | Public              |
| RDS PostgreSQL 15  | db.t3.micro, 20 GB             | Public (dev only)   |
| S3 bucket          | SSE + versioned                | IAM only            |
| Lambda             | Node.js 22, outside VPC        | IAM only            |

Resource names use the `careconnect-*` prefix. EC2 instances are reachable
through SSM Session Manager (`aws ssm start-session --target <instance-id>`).

---

## Prerequisites

- Node.js 18+ (22 recommended)
- AWS CLI configured: `aws configure`
- AWS CDK CLI: `npm install -g aws-cdk`
- One-time bootstrap per account/region: `npx cdk bootstrap`

---

## Project structure

```
careConnect-infra/
├── bin/
│   └── care_connect-infra.ts        # CDK app entry; instantiates the stack
├── lib/
│   └── care_connect-infra-stack.ts  # CareConnectInfraStack — all resources
├── test/
│   └── care_connect-infra.test.ts   # Jest assertions via aws-cdk-lib/assertions
├── .env                             # Flat config consumed by the stack
├── cdk.json
├── package.json
└── tsconfig.json
```

Supporting docs:

- [`SPEC.md`](./SPEC.md) — full architecture specification
- [`DETAILS.md`](./DETAILS.md) — beginner-friendly walkthrough of each resource
- [`CLAUDE.md`](./CLAUDE.md) — engineering conventions for this repo

---

## Setup

```bash
npm install
cp .env.example .env   # if provided; otherwise create one — see below
```

Fill in your `.env` (see [Environment](#environment)). The stack uses these
values both to shape resources and to render per-service env files that are
copied onto each EC2 instance as user-data.

---

## Commands

| Command                  | What it does                                        |
|--------------------------|-----------------------------------------------------|
| `npm run build`          | Compile TypeScript                                  |
| `npm run watch`          | Watch-mode compilation                              |
| `npm run test`           | Jest tests (CDK assertions)                         |
| `npm run deploy`         | `cdk deploy --outputs-file INFRA_DETAILS.txt`       |
| `npx cdk synth`          | Generate CloudFormation template                    |
| `npx cdk diff`           | Diff against deployed stack                         |
| `npx cdk destroy`        | Tear down all resources                             |
| `npx cdk bootstrap`      | One-time setup per account/region                   |

---

## Environment

The stack reads a flat `.env` with prefixes that map onto the three services.
Keys are forwarded — minus the prefix — into per-instance env files at deploy
time.

### Backend — `SERVER_*`

| Variable                        | Maps to backend env           |
|---------------------------------|-------------------------------|
| `SERVER_DB_HOST`                | `DB_HOST`                     |
| `SERVER_DB_PORT`                | `DB_PORT`                     |
| `SERVER_DB_USERNAME`            | `DB_USERNAME`                 |
| `SERVER_DB_PASSWORD`            | `DB_PASSWORD`                 |
| `SERVER_DB_NAME`                | `DB_NAME`                     |
| `SERVER_JWT_SECRET`             | `JWT_SECRET`                  |
| `SERVER_JWT_EXPIRES_IN`         | `JWT_EXPIRES_IN`              |
| `SERVER_PORT`                   | `PORT`                        |
| `SERVER_AWS_REGION`             | `AWS_REGION`                  |
| `SERVER_AWS_ACCESS_KEY_ID`      | `AWS_ACCESS_KEY_ID`           |
| `SERVER_AWS_SECRET_ACCESS_KEY`  | `AWS_SECRET_ACCESS_KEY`       |
| `SERVER_AWS_S3_BUCKET_NAME`     | `AWS_S3_BUCKET_NAME`          |
| `SERVER_BOT_SERVER_BASE_URL`    | `BOT_SERVER_BASE_URL`         |
| `SERVER_SMTP_USER`              | `SMTP_USER`                   |
| `SERVER_SMTP_PASS`              | `SMTP_PASS`                   |

### RAG server — `RAG_*`

| Variable                     | Maps to RAG env          |
|------------------------------|--------------------------|
| `RAG_POSTGRES_DB`            | `POSTGRES_DB`            |
| `RAG_POSTGRES_USER`          | `POSTGRES_USER`          |
| `RAG_POSTGRES_PASSWORD`      | `POSTGRES_PASSWORD`      |
| `RAG_DATABASE_HOST`          | `DATABASE_HOST`          |
| `RAG_DATABASE_PORT`          | `DATABASE_PORT`          |
| `RAG_AWS_ACCESS_KEY_ID`      | `AWS_ACCESS_KEY_ID`      |
| `RAG_AWS_SECRET_ACCESS_KEY`  | `AWS_SECRET_ACCESS_KEY`  |
| `RAG_AWS_REGION`             | `AWS_REGION`             |
| `RAG_GEMINI_API_KEY`         | `GEMINI_API_KEY`         |

### Frontend — `FRONTEND_*`

| Variable                       | Maps to frontend env    |
|--------------------------------|-------------------------|
| `FRONTEND_VITE_API_BASE_URL`   | `VITE_API_BASE_URL`     |

---

## Deploy flow

```bash
npm run build
npm run deploy
```

On success, stack outputs are written to `INFRA_DETAILS.txt`:

- Frontend public IP / DNS
- Backend public IP
- RAG server public IP
- RDS endpoint and port
- S3 bucket name
- Lambda function name

Feed those values back into your `.env` files so the frontend's
`VITE_API_BASE_URL` and backend's `BOT_SERVER_BASE_URL` point at the new
instances.

---

## Design decisions

- **Single stack.** All resources live in `CareConnectInfraStack`. Simpler
  to reason about, simpler to tear down.
- **All public subnets.** No NAT Gateway, no private subnets, no ALB. Cheap
  and small. Not appropriate for production.
- **SSM Session Manager, not SSH.** No port 22, no key pair to manage.
- **Security groups 0.0.0.0/0.** Convenient for dev; tighten before anything
  real.
- **L2 CDK constructs by default.** Only reach for L1 when the L2 can't do
  what you need.

---

## Cost notes

AWS Free Tier covers most of this, but a few items leak:

| Item                       | Estimate       | Why                                            |
|----------------------------|----------------|------------------------------------------------|
| EC2 (3× t3.micro, 24/7)    | ~$13/mo over   | Free tier = 750 instance-hours shared          |
| Public IPv4 (4 addresses)  | ~$14.60/mo     | $3.65/IP/mo, no free tier                      |
| Secrets Manager            | ~$0.40/mo      | RDS auto-generated secret                      |
| RDS, S3, Lambda            | Free           | Within free-tier limits                        |

Stopping instances does not stop the IPv4 charge. Destroy the stack when
you're not using it.

---

## Testing

```bash
npm test
```

Tests use `aws-cdk-lib/assertions` to snapshot-check the synthesized template.
Update assertions alongside stack changes.

---

## Tearing down

```bash
npx cdk destroy
```

RDS snapshots and S3 object versions may incur tiny ongoing charges if
retained; delete them manually if you want a clean slate.
