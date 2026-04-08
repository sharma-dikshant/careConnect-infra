# CareConnect Infrastructure Spec

## 1. Overview

| Field          | Value            |
| -------------- | ---------------- |
| Project        | CareConnect      |
| Cloud Provider | AWS              |
| IaC Framework  | AWS CDK          |
| Language       | TypeScript       |
| Stack Count    | 1 (single stack) |
| Environment    | Development      |

**Resources deployed:** 3 EC2 instances (frontend, backend, RAG server), 1 RDS PostgreSQL, 1 S3 bucket, 1 Lambda function.

> **Note:** This spec targets a simple, public, beginner-friendly setup for fast development. It is **not production-safe**. A production hardening section is included at the end.

---

## 2. Architecture Summary

```
                    ┌──────────────────────────────────────┐
                    │             VPC (Public Only)        │
                    │                                      │
                    │  ┌────────────┐  ┌────────────┐      │
  Internet ────────►│  │  Frontend  │  │  Backend   │      │
                    │  │  EC2 :80   │─►│  EC2 :3000 │──┐   │
                    │  └────────────┘  └────────────┘  │   │
                    │                       │          │   │
                    │                       ▼          │   │
                    │                  ┌────────────┐  │   │
                    │                  │ RAG Server │  │   │
                    │                  │ EC2 :8000  │  │   │
                    │                  └────────────┘  │   │
                    │                                  │   │
                    │                  ┌────────────┐  │   │
                    │                  │    RDS     │◄─┘   |
                    │                  │ PG :5432   │      │
                    │                  └────────────┘      │
                    └──────────────────────────────────────┘

        ┌────────────┐          ┌────────────┐
        │  S3 Bucket │          │   Lambda   │
        └────────────┘          └────────────┘
```

**Simplified design choices:**

- Single VPC with **public subnets only** (no private/isolated subnets)
- All EC2 instances have **public IPs**
- RDS is **publicly accessible**
- No NAT Gateway, no complex routing
- Communication between services uses **public IPs**

---

## 3. Network

### 3.1 VPC

- Name: `careconnect-vpc`
- One VPC for the entire project
- Public subnets only (avoid NAT Gateway costs and complexity)

### 3.2 Connectivity

| Source   | Target     | Method              |
| -------- | ---------- | ------------------- |
| Frontend | Backend    | Backend public IP   |
| Backend  | RAG Server | RAG public IP       |
| Backend  | RDS        | RDS public endpoint |
| Backend  | S3         | AWS SDK + IAM role  |
| Lambda   | S3         | AWS SDK + IAM role  |

---

## 4. Compute - EC2 Instances

All three EC2 instances share this common configuration:

| Setting          | Value                   |
| ---------------- | ----------------------- |
| Instance type    | `t2.micro` / `t3.micro` |
| OS               | Amazon Linux 2          |
| Assign public IP | Yes                     |
| Subnet           | Public                  |
| Management       | AWS SSM Session Manager |

> **SSH:** Avoid opening port 22. Use SSM Session Manager instead.

### 4.1 Frontend EC2

- **Name:** `careconnect-frontend`
- **Purpose:** Hosts the user-facing UI
- **Port:** 80 (HTTP), 443 (HTTPS if enabled)
- **User data:** Install runtime, pull code, start service

### 4.2 Backend EC2

- **Name:** `careconnect-backend`
- **Purpose:** Hosts the API server; connects to RDS, RAG server, and S3
- **Port:** 3000
- **User data:** Install runtime, pull code, start service

### 4.3 RAG Server EC2

- **Name:** `careconnect-rag-server`
- **Purpose:** Hosts the AI/retrieval service; called by backend only
- **Port:** 8000
- **User data:** Install runtime, pull code, start service

---

## 5. Database - RDS PostgreSQL

| Setting             | Value                     |
| ------------------- | ------------------------- |
| Name                | `careconnect-db`          |
| Engine              | PostgreSQL                |
| Port                | 5432                      |
| Publicly accessible | Yes (dev only)            |
| Storage             | 20 GB                     |
| Storage encryption  | Enabled                   |
| Backups             | Enabled                   |
| Deletion protection | Enabled (production-like) |
| Credentials         | Defined via CDK           |

---

## 6. Storage - S3 Bucket

| Setting             | Value                        |
| ------------------- | ---------------------------- |
| Name                | `careconnect-storage-bucket` |
| Block public access | Enabled                      |
| Bucket encryption   | Enabled                      |
| Versioning          | Enabled                      |
| Public read/write   | Disabled                     |

**Access:** Backend EC2 and Lambda via IAM roles only. Frontend should **not** have unrestricted bucket access.

---

## 7. Lambda Function

| Setting | Value                         |
| ------- | ----------------------------- |
| Name    | `careconnect-worker-function` |
| Runtime | Node.js                       |
| VPC     | Not attached (simpler)        |

**Permissions:** CloudWatch Logs write + S3 access (scoped to the CareConnect bucket only, specific actions only).

> Attach to VPC later only if it needs to access private resources.

---

## 8. Security Groups

Each resource gets its own security group. In this simplified setup, inbound is open by port from `0.0.0.0/0`.

### 8.1 Frontend SG (`careconnect-frontend-sg`)

| Direction | Port | Source      |
| --------- | ---- | ----------- |
| Inbound   | 80   | `0.0.0.0/0` |
| Inbound   | 443  | `0.0.0.0/0` |
| Outbound  | All  | All         |

### 8.2 Backend SG (`careconnect-backend-sg`)

| Direction | Port | Source      |
| --------- | ---- | ----------- |
| Inbound   | 3000 | `0.0.0.0/0` |
| Outbound  | All  | All         |

### 8.3 RAG Server SG (`careconnect-rag-sg`)

| Direction | Port | Source      |
| --------- | ---- | ----------- |
| Inbound   | 8000 | `0.0.0.0/0` |
| Outbound  | All  | All         |

### 8.4 RDS SG (`careconnect-db-sg`)

| Direction | Port | Source      |
| --------- | ---- | ----------- |
| Inbound   | 5432 | `0.0.0.0/0` |
| Outbound  | All  | All         |

---

## 9. IAM Roles

### 9.1 EC2 Instance Roles

**All EC2 instances** get:

- `AmazonSSMManagedInstanceCore` (SSM access, no SSH needed)

**Backend EC2** additionally gets scoped S3 permissions:

- `s3:GetObject`, `s3:PutObject`, `s3:ListBucket`
- Scoped to the CareConnect bucket only (preferably specific prefixes)

**RAG Server EC2:** Add extra permissions only if the RAG service explicitly needs them.

### 9.2 Lambda Execution Role

- `AWSLambdaBasicExecutionRole` (CloudWatch Logs)
- S3 access scoped to CareConnect bucket and required actions only

> **Rule:** No full admin permissions on any role. Least privilege always.

---

## 10. Environment Variables

### Frontend EC2

```
BACKEND_URL=http://<backend-public-ip>:3000
```

Plus any frontend-specific public config values.

### Backend EC2

```
DB_HOST=<rds-endpoint>
DB_PORT=5432
DB_NAME=<database-name>
DB_USER=<username>
DB_PASSWORD=<password>
RAG_SERVER_URL=http://<rag-public-ip>:8000
S3_BUCKET_NAME=<bucket-name>
```

### RAG Server EC2

```
S3_BUCKET_NAME=<bucket-name>  # if it reads documents from S3
```

Plus any model or storage config it needs.

### Lambda

```
S3_BUCKET_NAME=<bucket-name>
```

Plus any event processing config.

---

## 11. CDK Stack Outputs

The stack must output:

| Output                 | Description              |
| ---------------------- | ------------------------ |
| VPC ID                 | VPC identifier           |
| Frontend Public IP/DNS | User-facing endpoint     |
| Backend Public IP      | API endpoint             |
| RAG Server Public IP   | RAG service endpoint     |
| RDS Endpoint           | Database connection host |
| S3 Bucket Name         | Storage bucket name      |
| Lambda Function Name   | Worker function name     |

---

## 12. Implementation Order

1. VPC and subnets
2. Security groups
3. IAM roles
4. S3 bucket
5. RDS PostgreSQL
6. EC2 instances (frontend, backend, RAG)
7. Lambda function
8. Stack outputs

---

## 13. CDK Guidelines

- Use **L2 CDK constructs** (higher-level, less boilerplate)
- Keep everything in **one stack**
- Use **clear naming** (`careconnect-*` prefix)
- Prefer CDK **defaults** wherever possible
- Make ports configurable via CDK context or environment variables
- User data scripts should be **minimal and readable**
- Avoid advanced constructs, complex patterns, or over-engineering

---

## 14. Production Hardening (Future)

When moving to production, apply these changes:

| Change               | Detail                                             |
| -------------------- | -------------------------------------------------- |
| Private subnets      | Move backend + RAG to private subnets              |
| Isolated subnet      | Move RDS to isolated subnet, disable public access |
| SG tightening        | Backend SG: allow 3000 from frontend SG only       |
|                      | RAG SG: allow 8000 from backend SG only            |
|                      | RDS SG: allow 5432 from backend SG only            |
| NAT Gateway          | Add for private subnet outbound internet access    |
| Load balancer        | Add ALB in front of frontend                       |
| HTTPS                | Enable TLS with ACM certificates                   |
| SSH lockdown         | Ensure port 22 is never opened                     |
| RDS hardening        | Enable deletion protection, disable public access  |
| Outbound restriction | Tighten outbound rules per service                 |
