import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";

export class CareConnectInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ──────────────────────────────────────────────
    // VPC
    // ──────────────────────────────────────────────
    // Public subnets only — avoids NAT Gateway (~$30/mo) since all
    // resources need public IPs in this dev setup anyway.
    const vpc = new ec2.Vpc(this, "careconnect-vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    // ──────────────────────────────────────────────
    // EC2 Instances
    // ──────────────────────────────────────────────
    // FREE TIER: 750 hrs/mo of t3.micro shared across ALL instances.
    // 3 instances × 24/7 = 2,190 hrs → ~1,440 hrs over the limit (~$13/mo).
    // To stay free: stop instances when not in use, or run only 1 at a time.
    //
    // PUBLIC IPv4: AWS charges $3.65/mo per public IP (no free tier).
    // 3 EC2s + 1 RDS = ~$14.60/mo. Unavoidable in this public architecture.
    // ──────────────────────────────────────────────

    // ── Frontend ──
    const frontendSg = new ec2.SecurityGroup(this, "careconnect-frontend-sg", {
      vpc,
      description: "Allow HTTP and HTTPS traffic to frontend",
      allowAllOutbound: true,
    });
    frontendSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP");
    frontendSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");

    // SSM role eliminates the need to open port 22 for SSH
    const frontendRole = new iam.Role(this, "careconnect-frontend-role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
      ],
    });

    const frontend = new ec2.Instance(this, "careconnect-frontend", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      securityGroup: frontendSg,
      role: frontendRole,
      associatePublicIpAddress: true,
    });

    // ── Backend ──
    // Dev: port 3000 open to 0.0.0.0/0.
    // Prod: restrict to frontend SG only.
    const backendSg = new ec2.SecurityGroup(this, "careconnect-backend-sg", {
      vpc,
      description: "Allow traffic to backend API on port 3000",
      allowAllOutbound: true,
    });
    backendSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3000),
      "Backend API",
    );

    // Backend role gets S3 grants below (after bucket creation)
    const backendRole = new iam.Role(this, "careconnect-backend-role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
      ],
    });

    const backend = new ec2.Instance(this, "careconnect-backend", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      securityGroup: backendSg,
      role: backendRole,
      associatePublicIpAddress: true,
    });

    // ── RAG Server ──
    // Dev: port 8000 open to 0.0.0.0/0.
    // Prod: restrict to backend SG only.
    const ragSg = new ec2.SecurityGroup(this, "careconnect-rag-sg", {
      vpc,
      description: "Allow traffic to RAG server on port 8000",
      allowAllOutbound: true,
    });
    ragSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8000), "RAG Server");

    const ragRole = new iam.Role(this, "careconnect-rag-role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
      ],
    });

    const rag = new ec2.Instance(this, "careconnect-rag", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      securityGroup: ragSg,
      role: ragRole,
      associatePublicIpAddress: true,
    });

    // ──────────────────────────────────────────────
    // RDS PostgreSQL
    // ──────────────────────────────────────────────
    // Dev: publicly accessible + open to 0.0.0.0/0 for easy local tooling access.
    // Prod: move to isolated subnet, restrict to backend SG only.
    const dbSg = new ec2.SecurityGroup(this, "careconnect-db-sg", {
      vpc,
      description: "Allow PostgreSQL traffic on port 5432",
      allowAllOutbound: true,
    });
    dbSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      "PostgreSQL (dev)",
    );
    dbSg.addIngressRule(
      ec2.Peer.securityGroupId(backendSg.securityGroupId),
      ec2.Port.tcp(5432),
      "Backend EC2",
    );

    const db = new rds.DatabaseInstance(this, "careconnect-db", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),

      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),

      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [dbSg],
      publiclyAccessible: true, // dev only
      allocatedStorage: 20, // keep <= 20GB for free tier
      maxAllocatedStorage: 20, // prevent autoscaling cost
      multiAz: false, // IMPORTANT: multi-AZ costs money
      deletionProtection: false, // dev only
      removalPolicy: cdk.RemovalPolicy.DESTROY, // dev safe
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      databaseName: "careconnect",
    });
    // ──────────────────────────────────────────────
    // S3 Bucket
    // ──────────────────────────────────────────────
    // Kept locked down even in dev — no reason to expose file storage publicly.
    // autoDeleteObjects deploys a CDK-managed Lambda to empty the bucket before deletion.
    const bucket = new s3.Bucket(this, "careconnect-storage-bucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Least-privilege S3 grants — scoped to this bucket only
    bucket.grantRead(backendRole);
    bucket.grantPut(backendRole);

    // ──────────────────────────────────────────────
    // Lambda
    // ──────────────────────────────────────────────
    // Outside VPC — no cold-start penalty, and it only needs S3 + CloudWatch.
    // CDK auto-attaches AWSLambdaBasicExecutionRole for CloudWatch Logs.
    // Inline handler is a placeholder — replace with Code.fromAsset() for real logic.
    const workerFn = new lambda.Function(this, "careconnect-worker-function", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(
        'exports.handler = async () => ({ statusCode: 200, body: "ok" });',
      ),
      environment: {
        S3_BUCKET_NAME: bucket.bucketName,
      },
    });

    bucket.grantRead(workerFn);
    bucket.grantPut(workerFn);

    // ──────────────────────────────────────────────
    // Stack Outputs
    // ──────────────────────────────────────────────
    // Printed after `cdk deploy`. Note: EC2 public IPs change on stop/start
    // (use Elastic IPs for stability). RDS endpoint is a stable DNS name.
    new cdk.CfnOutput(this, "VpcId", {
      value: vpc.vpcId,
      description: "VPC ID",
    });

    new cdk.CfnOutput(this, "FrontendPublicIp", {
      value: frontend.instancePublicIp,
      description: "Frontend EC2 public IP",
    });

    new cdk.CfnOutput(this, "FrontendPublicDns", {
      value: frontend.instancePublicDnsName,
      description: "Frontend EC2 public DNS",
    });

    new cdk.CfnOutput(this, "BackendPublicIp", {
      value: backend.instancePublicIp,
      description: "Backend EC2 public IP",
    });

    new cdk.CfnOutput(this, "RagServerPublicIp", {
      value: rag.instancePublicIp,
      description: "RAG Server EC2 public IP",
    });

    new cdk.CfnOutput(this, "RdsEndpoint", {
      value: db.dbInstanceEndpointAddress,
      description: "RDS PostgreSQL endpoint",
    });

    new cdk.CfnOutput(this, "RdsPort", {
      value: db.dbInstanceEndpointPort,
      description: "RDS PostgreSQL port",
    });

    new cdk.CfnOutput(this, "S3BucketName", {
      value: bucket.bucketName,
      description: "S3 storage bucket name",
    });

    new cdk.CfnOutput(this, "LambdaFunctionName", {
      value: workerFn.functionName,
      description: "Worker Lambda function name",
    });
  }
}
