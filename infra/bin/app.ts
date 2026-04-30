import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { DataStack } from "../lib/data-stack";
import { ComputeStack } from "../lib/compute-stack";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const tags = {
  project: "codecollab",
  owner: "binti",
};

const networkStack = new NetworkStack(app, "CodeCollab-NetworkStack", {
  env,
  description: "VPC, subnets, NAT gateways, and VPC endpoints for CodeCollab",
  tags,
});

const dataStack = new DataStack(app, "CodeCollab-DataStack", {
  env,
  vpc: networkStack.vpc,
  description:
    "DynamoDB, ElastiCache Redis, S3, SQS DLQ, and ECR repos for CodeCollab",
  tags,
});
dataStack.addDependency(networkStack);

const computeStack = new ComputeStack(app, "CodeCollab-ComputeStack", {
  env,
  vpc: networkStack.vpc,
  dataStack,
  description: "ECS Fargate cluster and stub task definitions for CodeCollab",
  tags,
});
computeStack.addDependency(dataStack);
