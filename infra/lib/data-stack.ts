import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface DataStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class DataStack extends cdk.Stack {
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly pythonRunnerRepo: ecr.Repository;
  public readonly nodejsRunnerRepo: ecr.Repository;
  public readonly sessionsTable: dynamodb.Table;
  public readonly editHistoryBucket: s3.Bucket;
  public readonly execStagingBucket: s3.Bucket;
  public readonly redisEndpointAddress: string;
  public readonly redisEndpointPort: string;
  public readonly translationFn: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { vpc } = props;

    // ── DynamoDB ─────────────────────────────────────────────────────────────

    this.sessionsTable = new dynamodb.Table(this, "SessionsTable", {
      tableName: "codecollab-sessions",
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, "SessionsTableName", {
      value: this.sessionsTable.tableName,
      exportName: "CodeCollab-SessionsTableName",
    });

    // ── S3 Buckets ───────────────────────────────────────────────────────────

    this.editHistoryBucket = new s3.Bucket(this, "EditHistoryBucket", {
      bucketName: `codecollab-edit-history-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
    });

    this.execStagingBucket = new s3.Bucket(this, "ExecStagingBucket", {
      bucketName: `codecollab-exec-staging-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    new cdk.CfnOutput(this, "EditHistoryBucketName", {
      value: this.editHistoryBucket.bucketName,
      exportName: "CodeCollab-EditHistoryBucketName",
    });

    new cdk.CfnOutput(this, "ExecStagingBucketName", {
      value: this.execStagingBucket.bucketName,
      exportName: "CodeCollab-ExecStagingBucketName",
    });

    // ── SQS Dead-Letter Queue ────────────────────────────────────────────────

    new sqs.Queue(this, "DeadLetterQueue", {
      queueName: "codecollab-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    // ── ECR Repositories ─────────────────────────────────────────────────────

    const ecrLifecycleRule: ecr.LifecycleRule = {
      rulePriority: 1,
      description: "Keep last 5 images",
      maxImageCount: 5,
      tagStatus: ecr.TagStatus.ANY,
    };

    this.pythonRunnerRepo = new ecr.Repository(this, "PythonRunnerRepo", {
      repositoryName: "codecollab/python-runner",
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });
    this.pythonRunnerRepo.addLifecycleRule(ecrLifecycleRule);

    this.nodejsRunnerRepo = new ecr.Repository(this, "NodejsRunnerRepo", {
      repositoryName: "codecollab/nodejs-runner",
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });
    this.nodejsRunnerRepo.addLifecycleRule(ecrLifecycleRule);

    new cdk.CfnOutput(this, "PythonRunnerRepoUri", {
      value: this.pythonRunnerRepo.repositoryUri,
      exportName: "CodeCollab-PythonRunnerRepoUri",
    });

    new cdk.CfnOutput(this, "NodejsRunnerRepoUri", {
      value: this.nodejsRunnerRepo.repositoryUri,
      exportName: "CodeCollab-NodejsRunnerRepoUri",
    });

    // ── Security Groups ──────────────────────────────────────────────────────

    this.ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc,
      description: "Security group for ECS Fargate tasks",
      allowAllOutbound: true,
    });

    const redisSg = new ec2.SecurityGroup(this, "RedisSecurityGroup", {
      vpc,
      description: "Allow Redis access from VPC private subnets",
      allowAllOutbound: false,
    });
    // Use VPC CIDR instead of a specific SG so ECS task SGs can live in
    // ComputeStack without creating a cross-stack dependency cycle.
    redisSg.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      "Redis from VPC"
    );

    new cdk.CfnOutput(this, "EcsSecurityGroupId", {
      value: this.ecsSecurityGroup.securityGroupId,
      exportName: "CodeCollab-EcsSecurityGroupId",
    });

    // ── ElastiCache Redis 7 ──────────────────────────────────────────────────

    const privateSubnetIds = vpc.privateSubnets.map((s) => s.subnetId);

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "RedisSubnetGroup",
      {
        description: "Private subnets for CodeCollab Redis",
        subnetIds: privateSubnetIds,
        cacheSubnetGroupName: "codecollab-redis-subnet-group",
      }
    );

    const redisCluster = new elasticache.CfnReplicationGroup(
      this,
      "RedisReplicationGroup",
      {
        replicationGroupDescription: "CodeCollab Redis 7 single-node cluster",
        engine: "redis",
        engineVersion: "7.0",
        cacheNodeType: "cache.t3.micro",
        numCacheClusters: 1,
        automaticFailoverEnabled: false,
        cacheSubnetGroupName: redisSubnetGroup.ref,
        securityGroupIds: [redisSg.securityGroupId],
        atRestEncryptionEnabled: true,
        transitEncryptionEnabled: true,
      }
    );
    redisCluster.addDependency(redisSubnetGroup);

    this.redisEndpointAddress = redisCluster.attrPrimaryEndPointAddress;
    this.redisEndpointPort = redisCluster.attrPrimaryEndPointPort;

    new cdk.CfnOutput(this, "RedisPrimaryEndpoint", {
      value: redisCluster.attrPrimaryEndPointAddress,
      exportName: "CodeCollab-RedisPrimaryEndpoint",
    });

    // ── Translation Lambda ────────────────────────────────────────────────────

    this.translationFn = new lambdaNodejs.NodejsFunction(
      this,
      "TranslationFunction",
      {
        functionName: "codecollab-translation",
        entry: path.join(__dirname, "../../translation/handler.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        bundling: {
          minify: false,
          sourceMap: true,
          externalModules: [],
        },
        environment: {
          NODE_OPTIONS: "--enable-source-maps",
        },
      }
    );

    new cdk.CfnOutput(this, "TranslationFunctionName", {
      value: this.translationFn.functionName,
      exportName: "CodeCollab-TranslationFunctionName",
    });

    new cdk.CfnOutput(this, "TranslationFunctionArn", {
      value: this.translationFn.functionArn,
      exportName: "CodeCollab-TranslationFunctionArn",
    });
  }
}
