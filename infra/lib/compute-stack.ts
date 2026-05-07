import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { DataStack } from "./data-stack";

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dataStack: DataStack;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly albDnsName: string;
  public readonly albFullName: string;
  public readonly collabServiceName: string;
  public readonly executionApiServiceName: string;

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

    // Single SG for all ECS Fargate tasks. allowAllOutbound lets tasks reach
    // Redis, DynamoDB/S3, ECR. Inbound is restricted to ALB on service ports.
    const ecsSg = new ec2.SecurityGroup(this, "EcsTaskSg", {
      vpc,
      description: "ECS Fargate tasks: outbound unrestricted, inbound from ALB only",
      allowAllOutbound: true,
    });
    ecsSg.addIngressRule(albSg, ec2.Port.tcp(8000), "collab-server from ALB");
    ecsSg.addIngressRule(albSg, ec2.Port.tcp(8001), "execution-api from ALB");

    // Runner SG: outbound only to S3/CloudWatch endpoints (already covered by VPC
    // endpoints); we don't allow public ingress on runners.
    const runnerSg = new ec2.SecurityGroup(this, "RunnerTaskSg", {
      vpc,
      description: "Code-runner Fargate tasks: outbound only",
      allowAllOutbound: true,
    });

    // ── ALB ──────────────────────────────────────────────────────────────────

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      loadBalancerName: "codecollab-alb",
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSg,
    });
    this.albDnsName = alb.loadBalancerDnsName;
    this.albFullName = alb.loadBalancerFullName;

    // ── Per-service task roles ────────────────────────────────────────────────

    // Runner task roles defined first — executionApiTaskRole PassRole policy references them.
    const pythonRunnerTaskRole = new iam.Role(this, "PythonRunnerTaskRole", {
      roleName: "python-runner-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    const nodejsRunnerTaskRole = new iam.Role(this, "NodejsRunnerTaskRole", {
      roleName: "nodejs-runner-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Runners need to read large code payloads from the exec-staging bucket.
    for (const role of [pythonRunnerTaskRole, nodejsRunnerTaskRole]) {
      role.addToPolicy(
        new iam.PolicyStatement({
          sid: "S3ExecStagingRead",
          actions: ["s3:GetObject"],
          resources: [`${dataStack.execStagingBucket.bucketArn}/*`],
        })
      );
    }

    const collabTaskRole = new iam.Role(this, "CollabTaskRole", {
      roleName: "collab-server-task-role",
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
        sid: "S3EditHistoryObjects",
        actions: ["s3:PutObject", "s3:GetObject"],
        resources: [`${dataStack.editHistoryBucket.bucketArn}/*`],
      })
    );
    collabTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3EditHistoryList",
        actions: ["s3:ListBucket"],
        resources: [dataStack.editHistoryBucket.bucketArn],
      })
    );

    const executionApiTaskRole = new iam.Role(this, "ExecutionApiTaskRole", {
      roleName: "execution-api-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    executionApiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3ExecStagingReadWrite",
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [`${dataStack.execStagingBucket.bucketArn}/*`],
      })
    );
    executionApiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "EcsRunnerLaunch",
        actions: ["ecs:RunTask", "ecs:StopTask"],
        resources: [
          `arn:aws:ecs:${this.region}:${this.account}:task-definition/python-runner:*`,
          `arn:aws:ecs:${this.region}:${this.account}:task-definition/nodejs-runner:*`,
        ],
        conditions: {
          ArnEquals: { "ecs:cluster": this.cluster.clusterArn },
        },
      })
    );
    executionApiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "EcsRunnerMonitor",
        actions: ["ecs:DescribeTasks"],
        resources: [
          `arn:aws:ecs:${this.region}:${this.account}:task/${this.cluster.clusterName}/*`,
        ],
        conditions: {
          ArnEquals: { "ecs:cluster": this.cluster.clusterArn },
        },
      })
    );
    executionApiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "StsCallerIdentity",
        actions: ["sts:GetCallerIdentity"],
        resources: ["*"],
      })
    );
    executionApiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "RunnerLogsRead",
        actions: ["logs:GetLogEvents", "logs:FilterLogEvents", "logs:DescribeLogStreams"],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/python-runner:*`,
          `arn:aws:logs:${this.region}:${this.account}:log-group:/ecs/nodejs-runner:*`,
        ],
      })
    );
    executionApiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "PassRunnerRoles",
        actions: ["iam:PassRole"],
        resources: [
          executionRole.roleArn,
          pythonRunnerTaskRole.roleArn,
          nodejsRunnerTaskRole.roleArn,
        ],
      })
    );

    // ── Runner log groups (named so execution-api can target them) ──────────

    const pythonRunnerLogGroup = new logs.LogGroup(this, "PythonRunnerLogGroup", {
      logGroupName: "/ecs/python-runner",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const nodejsRunnerLogGroup = new logs.LogGroup(this, "NodejsRunnerLogGroup", {
      logGroupName: "/ecs/nodejs-runner",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Runner Fargate task definitions ─────────────────────────────────────

    const pythonRunnerTaskDef = new ecs.FargateTaskDefinition(
      this,
      "PythonRunnerTaskDef",
      {
        family: "python-runner",
        cpu: 512,
        memoryLimitMiB: 1024,
        executionRole,
        taskRole: pythonRunnerTaskRole,
      }
    );
    pythonRunnerTaskDef.addContainer("python-runner", {
      containerName: "python-runner",
      image: ecs.ContainerImage.fromEcrRepository(
        dataStack.pythonRunnerRepo,
        "latest"
      ),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "python-runner",
        logGroup: pythonRunnerLogGroup,
      }),
    });

    const nodejsRunnerTaskDef = new ecs.FargateTaskDefinition(
      this,
      "NodejsRunnerTaskDef",
      {
        family: "nodejs-runner",
        cpu: 512,
        memoryLimitMiB: 1024,
        executionRole,
        taskRole: nodejsRunnerTaskRole,
      }
    );
    nodejsRunnerTaskDef.addContainer("nodejs-runner", {
      containerName: "nodejs-runner",
      image: ecs.ContainerImage.fromEcrRepository(
        dataStack.nodejsRunnerRepo,
        "latest"
      ),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "nodejs-runner",
        logGroup: nodejsRunnerLogGroup,
      }),
    });

    const translationTaskRole = new iam.Role(this, "TranslationTaskRole", {
      roleName: "codecollab-translation-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // ── collab-server ─────────────────────────────────────────────────────────

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
      image: ecs.ContainerImage.fromEcrRepository(
        dataStack.collabServerRepo,
        "latest"
      ),
      portMappings: [{ containerPort: 8000 }],
      environment: {
        PORT: "8000",
        NODE_ENV: "production",
        AWS_REGION: this.region,
        REDIS_URL: `rediss://${dataStack.redisEndpointAddress}:${dataStack.redisEndpointPort}`,
        DYNAMODB_TABLE_SESSIONS: dataStack.sessionsTable.tableName,
        S3_BUCKET_LOGS: dataStack.editHistoryBucket.bucketName,
        // Allow all origins behind ALB/CloudFront — the only public ingress is
        // CloudFront, so origin restriction would not add real defense here.
        CORS_ORIGINS: "",
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "collab-server" }),
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
        path: "/healthz",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      // WS connections benefit from longer idle than the default; ALB stickiness
      // is unnecessary because Yjs cross-task sync goes through Redis pub/sub.
      stickinessCookieDuration: cdk.Duration.minutes(5),
      deregistrationDelay: cdk.Duration.seconds(30),
    });
    collabTg.addTarget(
      collabService.loadBalancerTarget({
        containerName: "CollabServerContainer",
        containerPort: 8000,
      })
    );

    const collabScaling = collabService.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 6,
    });
    collabScaling.scaleOnCpuUtilization("CollabCpuScaling", {
      targetUtilizationPercent: 60,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // ── execution-api ─────────────────────────────────────────────────────────

    const runnerSubnetIds = vpc.privateSubnets.map((s) => s.subnetId).join(",");

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
      image: ecs.ContainerImage.fromEcrRepository(
        dataStack.executionApiRepo,
        "latest"
      ),
      portMappings: [{ containerPort: 8001 }],
      environment: {
        PORT: "8001",
        STAGE: "prod",
        NODE_ENV: "production",
        AWS_REGION: this.region,
        EXECUTION_MODE: "ecs",
        EXPECTED_AWS_ACCOUNT_ID: this.account,
        ECS_CLUSTER: this.cluster.clusterName,
        ECS_PYTHON_TASK_DEFINITION: pythonRunnerTaskDef.taskDefinitionArn,
        ECS_NODEJS_TASK_DEFINITION: nodejsRunnerTaskDef.taskDefinitionArn,
        ECS_PYTHON_CONTAINER_NAME: "python-runner",
        ECS_NODEJS_CONTAINER_NAME: "nodejs-runner",
        ECS_PYTHON_LOG_GROUP: pythonRunnerLogGroup.logGroupName,
        ECS_NODEJS_LOG_GROUP: nodejsRunnerLogGroup.logGroupName,
        ECS_PYTHON_LOG_STREAM_PREFIX: "python-runner",
        ECS_NODEJS_LOG_STREAM_PREFIX: "nodejs-runner",
        ECS_SUBNET_IDS: runnerSubnetIds,
        ECS_SECURITY_GROUP_IDS: runnerSg.securityGroupId,
        ECS_ASSIGN_PUBLIC_IP: "DISABLED",
        PYTHON_RUNNER_IMAGE: dataStack.pythonRunnerRepo.repositoryUri,
        NODEJS_RUNNER_IMAGE: dataStack.nodejsRunnerRepo.repositoryUri,
        EXEC_STAGING_BUCKET: dataStack.execStagingBucket.bucketName,
        S3_EXEC_STAGING_BUCKET: dataStack.execStagingBucket.bucketName,
        RUNNER_TIMEOUT_SECONDS: "30",
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
          path: "/healthz",
          healthyHttpCodes: "200",
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
        deregistrationDelay: cdk.Duration.seconds(30),
      }
    );
    executionApiTg.addTarget(
      executionApiService.loadBalancerTarget({
        containerName: "ExecutionApiContainer",
        containerPort: 8001,
      })
    );

    const executionApiScaling = executionApiService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 4,
    });
    executionApiScaling.scaleOnCpuUtilization("ExecutionApiCpuScaling", {
      targetUtilizationPercent: 60,
      scaleInCooldown: cdk.Duration.seconds(300),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // ── translation Lambda target ─────────────────────────────────────────────
    //
    // We avoid LambdaTarget.bind() because it adds a Lambda::Permission to
    // DataStack with sourceArn pointing back to a resource in ComputeStack,
    // which creates a DataStack→ComputeStack reference that cycles back via the
    // existing ComputeStack→DataStack dependency. Instead we create the
    // permission with no sourceArn restriction (only ELB principal) and inject
    // the function ARN via the L1 escape hatch.

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
    translationTg.node.addDependency(translationPermission);

    // Anchor the unused translationTaskRole so role lifecycle attaches
    // cleanly even if no service references it directly.
    cdk.Tags.of(translationTaskRole).add("codecollab-role-anchor", "translation");

    // ── HTTP Listener with path-based routing ─────────────────────────────────
    //
    // Default action returns 404 — the frontend SPA is served by CloudFront
    // straight from S3, so the ALB never needs to satisfy "/".

    const httpListener = alb.addListener("HttpListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: "application/json",
        messageBody: JSON.stringify({
          success: false,
          error: "No matching route",
          statusCode: 404,
        }),
      }),
    });

    // /ws and /ws/* → collab-server (Yjs WebSocket)
    httpListener.addTargetGroups("CollabWs", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/ws", "/ws/*"])],
      targetGroups: [collabTg],
    });

    // /api/sessions, /api/sessions/* → collab-server
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

    // /api/run, /api/run/* → execution-api
    httpListener.addTargetGroups("ExecutionApi", {
      priority: 30,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/api/run", "/api/run/*"]),
      ],
      targetGroups: [executionApiTg],
    });

    // /api/translate, /api/translate/* → translation Lambda
    httpListener.addTargetGroups("Translation", {
      priority: 40,
      conditions: [
        elbv2.ListenerCondition.pathPatterns([
          "/api/translate",
          "/api/translate/*",
        ]),
      ],
      targetGroups: [translationTg],
    });

    this.collabServiceName = collabService.serviceName;
    this.executionApiServiceName = executionApiService.serviceName;

    // ── Outputs ───────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      exportName: "CodeCollab-AlbDnsName",
    });

    new cdk.CfnOutput(this, "AlbArn", {
      value: alb.loadBalancerArn,
      exportName: "CodeCollab-AlbArn",
    });

    new cdk.CfnOutput(this, "PythonRunnerTaskDefArn", {
      value: pythonRunnerTaskDef.taskDefinitionArn,
      exportName: "CodeCollab-PythonRunnerTaskDefArn",
    });

    new cdk.CfnOutput(this, "NodejsRunnerTaskDefArn", {
      value: nodejsRunnerTaskDef.taskDefinitionArn,
      exportName: "CodeCollab-NodejsRunnerTaskDefArn",
    });
  }
}
