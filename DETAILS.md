# CareConnect Infrastructure — Implementation Details

---

### VPC (Virtual Private Cloud)

- **What was built:** A VPC (`careconnect-vpc`) with 2 Availability Zones and public subnets only. NAT Gateway count is set to 0.
- **Why it was needed:** Every AWS resource (EC2, RDS) needs a network to live in. A VPC is that private network. We use public subnets so all resources get public IPs and can be reached directly — simplest setup for development.
- **Key concepts:**
  - **VPC** — an isolated virtual network inside AWS. Think of it as your own private data center.
  - **Subnet** — a subdivision of the VPC. "Public" means it has a route to the internet via an Internet Gateway.
  - **Availability Zone (AZ)** — a physically separate data center within an AWS region. Using 2 AZs means if one goes down, the other still works.
  - **NAT Gateway** — lets private subnets reach the internet. We don't need it since we only have public subnets. Setting `natGateways: 0` avoids an ~$30/month charge.
- **Notes / Gotchas:**
  - CDK's default VPC creates both public and private subnets with a NAT Gateway. We override this with explicit `subnetConfiguration` to keep it public-only.
  - `cidrMask: 24` gives each subnet 256 IP addresses — more than enough for dev.

---

### Frontend EC2

- **What was built:** An EC2 instance (`careconnect-frontend`) running Amazon Linux 2 on t2.micro, placed in a public subnet with a public IP. It has its own security group and IAM role.
- **Why it was needed:** This hosts the user-facing UI. It needs to be publicly accessible so users can reach it over the internet.
- **Key concepts:**
  - **EC2** — a virtual server in AWS. `t2.micro` is the smallest (free-tier eligible) instance type.
  - **Security Group** — a firewall around the instance. `careconnect-frontend-sg` allows inbound HTTP (port 80) and HTTPS (port 443) from anywhere (`0.0.0.0/0`).
  - **IAM Role** — grants the instance permissions to use AWS services. We attach `AmazonSSMManagedInstanceCore` so we can connect via Session Manager instead of SSH.
  - **SSM Session Manager** — a browser-based shell to connect to EC2 without opening port 22 (SSH). Safer and simpler.
- **Notes / Gotchas:**
  - `associatePublicIpAddress: true` is required for the instance to be reachable from the internet.
  - The IAM role is separate from the security group — the role controls what AWS services the instance can call, while the SG controls network traffic.

---

### Backend EC2

- **What was built:** An EC2 instance (`careconnect-backend`) with security group allowing port 3000 from anywhere, and an IAM role with SSM access.
- **Why it was needed:** Hosts the API server. The frontend calls the backend on port 3000. The backend connects to RDS and S3.
- **Key concepts:**
  - Same EC2/SG/IAM pattern as frontend, but the security group opens port 3000 instead of 80/443.
  - The backend role also gets scoped S3 permissions (added later with the S3 bucket via `grantRead`/`grantPut`).
- **Notes / Gotchas:**
  - In production, port 3000 should only be open to the frontend security group, not `0.0.0.0/0`. This is a dev simplification.

---

### RAG Server EC2

- **What was built:** An EC2 instance (`careconnect-rag`) with security group allowing port 8000 from anywhere, and an IAM role with SSM access.
- **Why it was needed:** Hosts the AI/retrieval-augmented-generation service. The backend calls it on port 8000 to get AI-powered responses.
- **Key concepts:**
  - Same pattern as frontend and backend EC2. Only the port differs (8000).
  - "RAG" stands for Retrieval-Augmented Generation — a technique where an AI model retrieves relevant documents before generating a response.
- **Notes / Gotchas:**
  - In production, only the backend should be able to reach the RAG server. For dev, it's open to all.

---

### RDS PostgreSQL

- **What was built:** A PostgreSQL 15 database (`careconnect-db`) on a `db.t3.micro` instance with 20 GB storage, publicly accessible, with auto-generated credentials stored in AWS Secrets Manager.
- **Why it was needed:** The backend needs a relational database to store application data (users, records, etc.).
- **Key concepts:**
  - **RDS** — AWS's managed database service. It handles backups, patching, and failover so you don't have to.
  - **`fromGeneratedSecret("postgres")`** — CDK creates a random password and stores it in AWS Secrets Manager automatically. No hardcoded passwords in code.
  - **Security Group** — `careconnect-db-sg` has two inbound rules: one from `0.0.0.0/0` (dev access) and one explicitly from the backend security group on port 5432.
  - **`removalPolicy: DESTROY`** — allows `cdk destroy` to delete the database. Without this, CDK would refuse to delete it (safety default).
- **Notes / Gotchas:**
  - `publiclyAccessible: true` means the RDS endpoint is reachable from the internet. This is a dev-only setting — in production, RDS should be in a private/isolated subnet with `publiclyAccessible: false`.
  - The database must be placed in a subnet group. CDK handles this automatically via `vpcSubnets`.
  - `multiAz: false` keeps costs low. In production, enable it for automatic failover.

---

### S3 Bucket

- **What was built:** An S3 bucket (`careconnect-storage-bucket`) with server-side encryption, versioning enabled, and all public access blocked. The backend IAM role gets read/put permissions.
- **Why it was needed:** Stores files like uploads, assets, and documents used by the backend and Lambda.
- **Key concepts:**
  - **S3** — AWS's object storage service. Files are stored as "objects" in "buckets."
  - **`BLOCK_ALL` public access** — even if someone misconfigures a bucket policy, this setting prevents any public access. This is the one resource we keep locked down even in dev.
  - **`S3_MANAGED` encryption** — AWS encrypts all objects at rest using S3-managed keys. No extra cost or setup.
  - **Versioning** — S3 keeps every version of every file. If you overwrite or delete a file, the old version is still recoverable.
  - **`grantRead` / `grantPut`** — CDK's least-privilege helpers. Instead of writing raw IAM policies, these methods grant exactly the needed S3 actions (`GetObject`, `PutObject`, `ListBucket`, etc.) scoped to this specific bucket.
  - **`autoDeleteObjects: true`** — CDK deploys a custom Lambda behind the scenes to empty the bucket before deletion. Without this, `cdk destroy` would fail because S3 won't delete non-empty buckets.
- **Notes / Gotchas:**
  - Only the backend role and Lambda function have S3 access. Frontend and RAG server do not.
  - `removalPolicy: DESTROY` + `autoDeleteObjects: true` work together — one allows deletion, the other empties the bucket first.

---

### Lambda Function

- **What was built:** A Lambda function (`careconnect-worker-function`) with Node.js 22 runtime, an inline placeholder handler, the `S3_BUCKET_NAME` environment variable, and scoped S3 read/put permissions.
- **Why it was needed:** A utility function for background or event-driven tasks (e.g., processing uploads, sending notifications). It runs on-demand without a dedicated server.
- **Key concepts:**
  - **Lambda** — AWS's serverless compute service. You upload code, and AWS runs it only when triggered. You pay only for execution time.
  - **Outside VPC** — the function is not attached to the VPC. This is simpler and faster (no cold-start penalty from VPC networking). It only needs S3 and CloudWatch, both reachable without VPC.
  - **`AWSLambdaBasicExecutionRole`** — CDK auto-attaches this managed policy. It grants permission to write logs to CloudWatch.
  - **Inline code** — `Code.fromInline(...)` embeds the handler directly in the CloudFormation template. Good for placeholder/simple functions. For real code, switch to `Code.fromAsset("path/to/dir")`.
  - **`bucket.grantRead` / `bucket.grantPut`** — same least-privilege pattern as the backend. CDK generates a scoped IAM policy automatically.
- **Notes / Gotchas:**
  - The inline handler is a placeholder (`exports.handler = async () => ...`). Replace it with real logic or switch to `fromAsset` when actual code is ready.
  - If the Lambda later needs to access RDS or other VPC resources, it must be attached to the VPC — but that adds cold-start latency and requires a NAT Gateway for internet access.

---

### Stack Outputs

- **What was built:** `CfnOutput` entries for: VPC ID, Frontend public IP, Frontend public DNS, Backend public IP, RAG Server public IP, RDS endpoint, RDS port, S3 bucket name, Lambda function name.
- **Why it was needed:** After `cdk deploy`, these values are printed to the terminal so you know the IPs and endpoints to connect to without logging into the AWS console.
- **Key concepts:**
  - **`CfnOutput`** — adds an "Outputs" section to the CloudFormation template. CDK prints these after deployment.
  - These outputs can also be imported by other stacks if you later split the infrastructure.
- **Notes / Gotchas:**
  - EC2 public IPs change if the instance is stopped and restarted. For stable IPs, use Elastic IPs (not included in this dev setup).
  - The RDS endpoint is a DNS name (not an IP) and stays stable across restarts.
