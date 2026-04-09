# CareConnect Infrastructure

AWS infrastructure for CareConnect, defined with AWS CDK in TypeScript. Deploys a full dev environment in a single stack.

## Resources

| Resource | Type | Access |
|---|---|---|
| VPC | Public subnets only, 2 AZs | — |
| Frontend EC2 | t3.micro, port 80/443 | Public |
| Backend EC2 | t3.micro, port 3000 | Public |
| RAG Server EC2 | t3.micro, port 8000 | Public |
| RDS PostgreSQL 15 | db.t3.micro, 20 GB | Public (dev) |
| S3 Bucket | Encrypted, versioned | IAM only |
| Lambda | Node.js 22, outside VPC | IAM only |

## Prerequisites

- Node.js (v18+)
- AWS CLI configured (`aws configure`)
- AWS CDK CLI (`npm install -g aws-cdk`)
- CDK bootstrapped in your account (`npx cdk bootstrap`)

## Setup

```bash
npm install
```

## Commands

```bash
npm run build          # Compile TypeScript
npm run watch          # Watch mode compilation
npm run test           # Run Jest tests
npx cdk synth          # Generate CloudFormation template
npx cdk diff           # Diff against deployed stack
npx cdk deploy         # Deploy stack to AWS
npx cdk destroy        # Tear down all resources
```

## Project Structure

```
bin/
  care_connect-infra.ts        # CDK app entry point
lib/
  care_connect-infra-stack.ts  # All infrastructure (single stack)
test/
  care_connect-infra.test.ts   # Jest tests
```

## Stack Outputs

After `cdk deploy`, these values are printed:

- Frontend public IP and DNS
- Backend public IP
- RAG Server public IP
- RDS endpoint and port
- S3 bucket name
- Lambda function name

## Cost Notes

This setup targets the AWS Free Tier but some charges are unavoidable:

| Item | Estimate | Notes |
|---|---|---|
| EC2 (3 instances 24/7) | ~$13/mo overage | Free tier = 750 hrs shared. Stop when not in use. |
| Public IPv4 (4 addresses) | ~$14.60/mo | $3.65/IP/mo. No free tier. |
| Secrets Manager | ~$0.40/mo | RDS auto-generated secret |
| RDS, S3, Lambda | Free | Within free tier limits |

## Documentation

- **SPEC.md** — Full architecture specification
- **DETAILS.md** — Beginner-friendly explanation of each resource
- **CLAUDE.md** — AI assistant guidance for this repo
