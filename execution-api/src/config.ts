const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export type SupportedLanguage = "python" | "javascript";

export interface RunnerConfig {
  taskDefinition: string;
  containerName: string;
  image: string;
  runFile: string;
  stdinFile: string;
  logGroup: string;
  logStreamPrefix: string;
}

export const config = {
  port: parseNumber(process.env.PORT, 8001),
  stage: process.env.STAGE ?? "dev",
  logLevel: process.env.LOG_LEVEL ?? "debug",
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
  expectedAwsAccountId: process.env.EXPECTED_AWS_ACCOUNT_ID ?? "212208751162",
  executionMode: process.env.EXECUTION_MODE ?? "ecs",

  ecsCluster: process.env.ECS_CLUSTER ?? "codecollab",
  ecsSubnetIds: parseList(process.env.ECS_SUBNET_IDS),
  ecsSecurityGroupIds: parseList(process.env.ECS_SECURITY_GROUP_IDS),
  ecsAssignPublicIp: process.env.ECS_ASSIGN_PUBLIC_IP ?? "DISABLED",

  // Language-specific runner configuration. Defaults work for local development;
  // CDK injects the real values at deploy time.
  runners: {
    python: {
      taskDefinition:
        process.env.ECS_PYTHON_TASK_DEFINITION ??
        process.env.ECS_TASK_DEFINITION ??
        "python-runner",
      containerName:
        process.env.ECS_PYTHON_CONTAINER_NAME ??
        process.env.ECS_RUNNER_CONTAINER_NAME ??
        "python-runner",
      image:
        process.env.PYTHON_RUNNER_IMAGE ?? "codecollab-python-runner:local",
      runFile: "/tmp/main.py",
      stdinFile: "/tmp/stdin.txt",
      logGroup:
        process.env.ECS_PYTHON_LOG_GROUP ??
        process.env.ECS_LOG_GROUP ??
        "/ecs/python-runner",
      logStreamPrefix:
        process.env.ECS_PYTHON_LOG_STREAM_PREFIX ??
        process.env.ECS_LOG_STREAM_PREFIX ??
        "python-runner",
    },
    javascript: {
      taskDefinition:
        process.env.ECS_NODEJS_TASK_DEFINITION ?? "nodejs-runner",
      containerName: process.env.ECS_NODEJS_CONTAINER_NAME ?? "nodejs-runner",
      image:
        process.env.NODEJS_RUNNER_IMAGE ??
        process.env.JAVASCRIPT_RUNNER_IMAGE ??
        "codecollab-nodejs-runner:local",
      runFile: "/tmp/main.js",
      stdinFile: "/tmp/stdin.txt",
      logGroup: process.env.ECS_NODEJS_LOG_GROUP ?? "/ecs/nodejs-runner",
      logStreamPrefix:
        process.env.ECS_NODEJS_LOG_STREAM_PREFIX ?? "nodejs-runner",
    },
  } satisfies Record<SupportedLanguage, RunnerConfig>,

  execStagingBucket:
    process.env.EXEC_STAGING_BUCKET ??
    process.env.S3_EXEC_STAGING_BUCKET ??
    "codecollab-exec-staging-212208751162",
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

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["python", "javascript"];

export const normalizeLanguage = (
  raw: string,
): SupportedLanguage | undefined => {
  const lower = raw.toLowerCase();
  if (lower === "python" || lower === "py") return "python";
  if (lower === "javascript" || lower === "js" || lower === "nodejs") {
    return "javascript";
  }
  return undefined;
};

export const getRunnerConfig = (language: SupportedLanguage): RunnerConfig =>
  config.runners[language];
