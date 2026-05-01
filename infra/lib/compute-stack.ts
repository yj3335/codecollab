import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { DataStack } from "./data-stack";

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dataStack: DataStack;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { vpc, dataStack } = props;

    // ── ECS Cluster ──────────────────────────────────────────────────────────

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

    // ── Security Groups ───────────────────────────────────────────────────────

    const albSg = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc,
      description: "Internet-facing ALB: allow HTTP inbound",
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP from internet");

    // Single SG for all ECS Fargate tasks — lives in ComputeStack so CDK's
    // connections system never tries to modify the DataStack ECS SG, which
    // would create a cross-stack dependency cycle.
    // allowAllOutbound lets tasks reach Redis (VPC), DynamoDB/S3 (endpoints), ECR.
    const ecsSg = new ec2.SecurityGroup(this, "EcsTaskSg", {
      vpc,
      description: "ECS Fargate tasks: outbound unrestricted, inbound from ALB only",
      allowAllOutbound: true,
    });
    ecsSg.addIngressRule(albSg, ec2.Port.tcp(8000), "collab-server from ALB");
    ecsSg.addIngressRule(albSg, ec2.Port.tcp(8001), "execution-api from ALB");
    ecsSg.addIngressRule(albSg, ec2.Port.tcp(3000), "frontend from ALB");

    // ── ALB ──────────────────────────────────────────────────────────────────

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      loadBalancerName: "codecollab-alb",
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSg,
    });

    // ── Per-service task roles ────────────────────────────────────────────────

    const collabTaskRole = new iam.Role(this, "CollabTaskRole", {
      roleName: "codecollab-collab-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    collabTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "DynamoSessionsCRUD",
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ],
        resources: [dataStack.sessionsTable.tableArn],
      })
    );
    collabTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3EditHistoryWrite",
        actions: ["s3:PutObject", "s3:GetObject"],
        resources: [`${dataStack.editHistoryBucket.bucketArn}/*`],
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
        resources: [`${dataStack.execStagingBucket.bucketArn}/*`],
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

    // ── collab-server ─────────────────────────────────────────────────────────

    const collabServerRepo = ecr.Repository.fromRepositoryName(
      this,
      "CollabServerRepo",
      "codecollab/collab-server"
    );

    const collabTaskDef = new ecs.FargateTaskDefinition(
      this,
      "CollabServerTaskDef",
      {
        family: "collab-server",
        cpu: 512,
        memoryLimitMiB: 1024,
        executionRole,
        taskRole: collabTaskRole,
      }
    );
    collabTaskDef.addContainer("CollabServerContainer", {
      image: ecs.ContainerImage.fromEcrRepository(collabServerRepo, "latest"),
      portMappings: [{ containerPort: 8000 }],
      environment: {
        PORT: "8000",
        NODE_ENV: "production",
        AWS_REGION: this.region,
        REDIS_URL: `rediss://${dataStack.redisEndpointAddress}:${dataStack.redisEndpointPort}`,
        DYNAMODB_TABLE_SESSIONS: dataStack.sessionsTable.tableName,
        S3_BUCKET_LOGS: dataStack.editHistoryBucket.bucketName,
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "collab-server" }),
      healthCheck: {
        command: [
          "CMD-SHELL",
          "curl -sf http://localhost:8000/health || exit 1",
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    const collabService = new ecs.FargateService(this, "CollabServerService", {
      cluster: this.cluster,
      taskDefinition: collabTaskDef,
      desiredCount: 2,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    const collabTg = new elbv2.ApplicationTargetGroup(this, "CollabServerTG", {
      vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });
    collabTg.addTarget(
      collabService.loadBalancerTarget({
        containerName: "CollabServerContainer",
        containerPort: 8000,
      })
    );

    // ── execution-api ─────────────────────────────────────────────────────────

    const executionApiTaskDef = new ecs.FargateTaskDefinition(
      this,
      "ExecutionApiTaskDef",
      {
        family: "execution-api",
        cpu: 512,
        memoryLimitMiB: 1024,
        executionRole,
        taskRole: executionApiTaskRole,
      }
    );
    executionApiTaskDef.addContainer("ExecutionApiContainer", {
      // ECR repo not yet available — replaced when execution-api image is pushed
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [{ containerPort: 8001 }],
      environment: {
        PORT: "8001",
        NODE_ENV: "production",
        AWS_REGION: this.region,
        ECS_CLUSTER: this.cluster.clusterName,
        PYTHON_RUNNER_IMAGE: dataStack.pythonRunnerRepo.repositoryUri,
        S3_EXEC_STAGING_BUCKET: dataStack.execStagingBucket.bucketName,
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "execution-api" }),
    });

    const executionApiService = new ecs.FargateService(
      this,
      "ExecutionApiService",
      {
        cluster: this.cluster,
        taskDefinition: executionApiTaskDef,
        desiredCount: 1,
        securityGroups: [ecsSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assignPublicIp: false,
      }
    );

    const executionApiTg = new elbv2.ApplicationTargetGroup(
      this,
      "ExecutionApiTG",
      {
        vpc,
        port: 8001,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        healthCheck: {
          path: "/health",
          healthyHttpCodes: "200",
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
        deregistrationDelay: cdk.Duration.seconds(30),
      }
    );
    // Placeholder image does not serve on 8001 — registering causes ALB health
    // check failures that prevent CloudFormation from stabilizing. Wire up once
    // the real execution-api ECR image is pushed.
    void executionApiService;

    // ── frontend ──────────────────────────────────────────────────────────────

    const frontendTaskDef = new ecs.FargateTaskDefinition(
      this,
      "FrontendTaskDef",
      {
        family: "frontend",
        cpu: 256,
        memoryLimitMiB: 512,
        executionRole,
        taskRole: frontendTaskRole,
      }
    );
    frontendTaskDef.addContainer("FrontendContainer", {
      // ECR repo not yet available — replaced when frontend image is pushed
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        PORT: "3000",
        NODE_ENV: "production",
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "frontend" }),
    });

    const frontendService = new ecs.FargateService(this, "FrontendService", {
      cluster: this.cluster,
      taskDefinition: frontendTaskDef,
      desiredCount: 1,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    const frontendTg = new elbv2.ApplicationTargetGroup(this, "FrontendTG", {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });
    // Placeholder image does not serve on 3000 — same reason as execution-api.
    void frontendService;

    // ── translation Lambda target ─────────────────────────────────────────────
    //
    // We avoid LambdaTarget.bind() because it adds a Lambda::Permission to
    // DataStack with sourceArn pointing back to a resource in ComputeStack,
    // which creates a DataStack→ComputeStack reference that cycles back via the
    // existing ComputeStack→DataStack dependency. Instead we:
    //  1. Create the target group with LAMBDA type but no targets yet.
    //  2. Inject the function ARN directly via L1 escape hatch.
    //  3. Add the Lambda::Permission in ComputeStack scope only.

    // Create permission first with no sourceArn restriction.
    // Using sourceArn: tg.targetGroupArn would be circular — the TG validates
    // the permission exists at create time, but the TG ARN only exists after
    // the TG is created. Omitting sourceArn lets us enforce the DependsOn order
    // without a circular reference; any ELB in this account can invoke.
    const translationPermission = new lambda.CfnPermission(
      this,
      "TranslationAlbPermission",
      {
        functionName: dataStack.translationFn.functionArn,
        action: "lambda:InvokeFunction",
        principal: "elasticloadbalancing.amazonaws.com",
      }
    );

    const translationTg = new elbv2.ApplicationTargetGroup(
      this,
      "TranslationTG",
      { targetType: elbv2.TargetType.LAMBDA }
    );
    (translationTg.node.defaultChild as elbv2.CfnTargetGroup).targets = [
      { id: dataStack.translationFn.functionArn },
    ];
    // TG must be created after the permission or its creation-time validation fails.
    translationTg.node.addDependency(translationPermission);

    // ── stub task def for translation-lambda (not deployed as ECS service) ────

    const translationLambdaTaskDef = new ecs.FargateTaskDefinition(
      this,
      "TranslationLambdaTaskDef",
      {
        family: "translation-lambda",
        cpu: 256,
        memoryLimitMiB: 512,
        executionRole,
        taskRole: translationTaskRole,
      }
    );
    translationLambdaTaskDef.addContainer("TranslationLambdaContainer", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "translation-lambda" }),
    });

    // ── HTTP Listener with path-based routing ─────────────────────────────────

    const httpListener = alb.addListener("HttpListener", {
      port: 80,
      defaultTargetGroups: [frontendTg],
    });

    // /ws/* and /api/sessions/* → collab-server
    httpListener.addTargetGroups("CollabWs", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/ws", "/ws/*"])],
      targetGroups: [collabTg],
    });
    httpListener.addTargetGroups("CollabSessions", {
      priority: 20,
      conditions: [
        elbv2.ListenerCondition.pathPatterns([
          "/api/sessions",
          "/api/sessions/*",
        ]),
      ],
      targetGroups: [collabTg],
    });

    // /api/run/* → execution-api
    httpListener.addTargetGroups("ExecutionApi", {
      priority: 30,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/api/run", "/api/run/*"]),
      ],
      targetGroups: [executionApiTg],
    });

    // /translate/* → translation Lambda
    httpListener.addTargetGroups("Translation", {
      priority: 40,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/translate", "/translate/*"]),
      ],
      targetGroups: [translationTg],
    });

    // ── Outputs ───────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      exportName: "CodeCollab-AlbDnsName",
    });

    new cdk.CfnOutput(this, "AlbArn", {
      value: alb.loadBalancerArn,
      exportName: "CodeCollab-AlbArn",
    });
  }
}
