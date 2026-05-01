import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { DataStack } from "./data-stack";

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dataStack: DataStack;
}

/**
 * ComputeStack provisions the ECS Fargate cluster and stub task definitions
 * for all four CodeCollab services. ALB, service definitions, and auto-scaling
 * are deferred to Week 2 once container images are published to ECR.
 */
export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { vpc, dataStack } = props;

    // ── ECS Cluster (Fargate only) ────────────────────────────────────────────

    this.cluster = new ecs.Cluster(this, "CodeCollabCluster", {
      clusterName: "codecollab",
      vpc,
      enableFargateCapacityProviders: true,
      containerInsights: true,
    });

    // ── Shared task execution role ────────────────────────────────────────────

    const executionRole = new iam.Role(this, "EcsTaskExecutionRole", {
      roleName: "codecollab-ecs-task-execution-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });

    // ── Helper to build a stub task definition ────────────────────────────────

    const stubTaskDef = (
      logicalId: string,
      family: string,
      taskRole: iam.Role
    ): ecs.FargateTaskDefinition => {
      const taskDef = new ecs.FargateTaskDefinition(this, logicalId, {
        family,
        cpu: 256,
        memoryLimitMiB: 512,
        executionRole,
        taskRole,
      });
      taskDef.addContainer(`${logicalId}Container`, {
        image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: family }),
      });
      return taskDef;
    };

    // ── Per-service task roles (least-privilege stubs) ────────────────────────

    const collabTaskRole = new iam.Role(this, "CollabTaskRole", {
      roleName: "codecollab-collab-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    // collab-server needs DynamoDB and ElastiCache — grant in Week 2 when table ARN is stable
    collabTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "DynamoSessionsReadWrite",
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ],
        resources: ["*"], // TODO Week 2: scope to sessionsTable.tableArn
      })
    );

    const executionApiTaskRole = new iam.Role(this, "ExecutionApiTaskRole", {
      roleName: "codecollab-execution-api-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    executionApiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3ExecStagingReadWrite",
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: ["*"], // TODO Week 2: scope to execStagingBucket.bucketArn/*
      })
    );

    const frontendTaskRole = new iam.Role(this, "FrontendTaskRole", {
      roleName: "codecollab-frontend-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    const translationTaskRole = new iam.Role(this, "TranslationTaskRole", {
      roleName: "codecollab-translation-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // ── Stub task definitions ─────────────────────────────────────────────────

    stubTaskDef("CollabServerTaskDef", "collab-server", collabTaskRole);
    stubTaskDef(
      "ExecutionApiTaskDef",
      "execution-api",
      executionApiTaskRole
    );
    stubTaskDef("FrontendTaskDef", "frontend", frontendTaskRole);
    stubTaskDef(
      "TranslationLambdaTaskDef",
      "translation-lambda",
      translationTaskRole
    );

    // ── Suppress unused-var warning for dataStack reference ───────────────────
    // dataStack is accepted as a prop to enforce stack dependency ordering in CDK.
    void dataStack;

    /*
     * TODO Week 2 — ALB with path-based routing:
     *   /ws/*         → collab-server target group
     *   /api/*        → execution-api target group
     *   /translate/*  → translation-lambda target group
     *   /             → frontend target group
     *
     * TODO Week 2 — Auto-scaling:
     *   All services: scale on CPU > 60%, min 1 task, max 4 tasks
     */
  }
}
