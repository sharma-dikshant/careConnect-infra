# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CareConnect AWS infrastructure using CDK (TypeScript). Single-stack deployment targeting a simplified, all-public dev environment. See `SPEC.md` for the full architecture spec.

## Engineering Standards

- Simple approach prioritizing speed and clarity over production-grade robustness
- Prefer clarity over cleverness
- Handle edge cases explicitly
- Avoid assumptions — verify with code

## Information Strategy

- Keep responses concise by default
- Expand only when necessary
- Prefer step-by-step guidance over long explanations

## Commands

```bash
npm run build          # Compile TypeScript
npm run watch          # Watch mode compilation
npm run test           # Run Jest tests
npx cdk synth          # Generate CloudFormation template
npx cdk diff           # Diff against deployed stack
npx cdk deploy         # Deploy to AWS
npx cdk destroy        # Tear down stack
npx cdk bootstrap      # One-time CDK setup per account/region
```

## Architecture

- **Entry point:** `bin/care_connect-infra.ts` — creates the CDK App and instantiates the single stack
- **Stack:** `lib/care_connect-infra-stack.ts` — `CareConnectInfraStack` defines all infrastructure
- **Tests:** `test/care_connect-infra.test.ts` — Jest with `aws-cdk-lib/assertions`

### Resources (per SPEC.md)

| Resource       | Name prefix                   | Notes                                          |
| -------------- | ----------------------------- | ---------------------------------------------- |
| VPC            | `careconnect-vpc`             | Public subnets only, 2 AZs                     |
| Frontend EC2   | `careconnect-frontend`        | t2.micro, port 80                              |
| Backend EC2    | `careconnect-backend`         | t2.micro, port 3000                            |
| RAG Server EC2 | `careconnect-rag`             | t2.micro, port 8000                            |
| RDS PostgreSQL | `careconnect-db`              | PostgreSQL 15, 20GB, publicly accessible (dev) |
| S3 Bucket      | `careconnect-storage-bucket`  | Encrypted, versioned, no public access         |
| Lambda         | `careconnect-worker-function` | Node.js, outside VPC                           |

### Key design decisions

- Everything public for dev simplicity — no private subnets, no NAT Gateway
- SSM Session Manager for instance access (no SSH/port 22)
- L2 CDK constructs preferred over L1
- Security groups are port-based with `0.0.0.0/0` inbound (dev only)
- IAM follows least-privilege: `AmazonSSMManagedInstanceCore` for EC2, `AWSLambdaBasicExecutionRole` for Lambda, scoped S3 permissions

## CDK conventions

- Use `careconnect-*` naming for all resources
- Keep all resources in the single stack (`CareConnectInfraStack`)
- Prefer CDK defaults; only configure what the spec requires
- Ports should be configurable via CDK context or env vars

## Documentation Rules

- Maintain a file named `DETAILS.md`
- After every meaningful change:
  - Add a short summary of what was implemented
  - Explain why it was added
  - List key AWS/CDK concepts used
  - Keep explanations beginner-friendly

## Documentation Format

Each entry in DETAILS.md should follow:

### [Feature Name]

- What was built:
- Why it was needed:
- Key concepts:
- Notes / Gotchas:
