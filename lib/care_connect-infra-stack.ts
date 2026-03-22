import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";

export class CareConnectInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * VPC SETUP
     */

    const vpc = new ec2.Vpc(this, "careconnect-vpc", {
      maxAzs: 2,
    });

    const backend = new ec2.Instance(this, "careconnect-backend", {
      vpc,
      instanceType: new ec2.InstanceType("t2.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
    });
    const frontend = new ec2.Instance(this, "careconnect-frontend", {
      vpc,
      instanceType: new ec2.InstanceType("t2.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
    });
    const rag = new ec2.Instance(this, "careconnect-rag", {
      vpc,
      instanceType: new ec2.InstanceType("t2.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
    });

    // RDS Database
    const db = new rds.DatabaseInstance(this, "MyRDS", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MICRO,
      ),
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      allocatedStorage: 20,
      multiAz: false,
    });

    // Allow EC2 → RDS connection
    db.connections.allowDefaultPortFrom(backend);
  }
}
