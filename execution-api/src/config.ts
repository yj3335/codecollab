const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const config = {
  port: parseNumber(process.env.PORT, 8001),
  stage: process.env.STAGE ?? "dev",
  logLevel: process.env.LOG_LEVEL ?? "debug",
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
  expectedAwsAccountId:
    process.env.EXPECTED_AWS_ACCOUNT_ID ?? "212208751162",
  executionMode: process.env.EXECUTION_MODE ?? "ecs",
  ecsCluster: process.env.ECS_CLUSTER ?? "codecollab",
  ecsTaskDefinition: process.env.ECS_TASK_DEFINITION ?? "python-runner",
  ecsRunnerContainerName:
    process.env.ECS_RUNNER_CONTAINER_NAME ?? "python-runner",
  ecsSubnetIds: parseList(process.env.ECS_SUBNET_IDS),
  ecsSecurityGroupIds: parseList(process.env.ECS_SECURITY_GROUP_IDS),
  ecsAssignPublicIp: process.env.ECS_ASSIGN_PUBLIC_IP ?? "DISABLED",
  ecsLogGroup: process.env.ECS_LOG_GROUP ?? "/ecs/python-runner",
  ecsLogStreamPrefix: process.env.ECS_LOG_STREAM_PREFIX ?? "python-runner",
  execStagingBucket:
    process.env.EXEC_STAGING_BUCKET ??
    process.env.S3_EXEC_STAGING_BUCKET ??
    "codecollab-exec-staging-212208751162",
  pythonRunnerImage:
    process.env.PYTHON_RUNNER_IMAGE ?? "codecollab-python-runner:local",
  runnerTimeoutSeconds: parseNumber(process.env.RUNNER_TIMEOUT_SECONDS, 30),
  runnerMemoryLimit: process.env.RUNNER_MEMORY_LIMIT ?? "256m",
  inlineCodeThresholdBytes: parseNumber(
    process.env.INLINE_CODE_THRESHOLD_BYTES,
    4096,
  ),
  cloudWatchPollIntervalMs: parseNumber(
    process.env.CLOUDWATCH_POLL_INTERVAL_MS,
    1000,
  ),
};
