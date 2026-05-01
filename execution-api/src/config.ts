const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: parseNumber(process.env.PORT, 8001),
  stage: process.env.STAGE ?? "dev",
  logLevel: process.env.LOG_LEVEL ?? "debug",
  awsRegion: process.env.AWS_REGION ?? "us-east-1",
  ecsCluster: process.env.ECS_CLUSTER ?? "codecollab-cluster-dev",
  ecsTaskDefinition: process.env.ECS_TASK_DEFINITION ?? "codecollab-runner-dev",
  pythonRunnerImage:
    process.env.PYTHON_RUNNER_IMAGE ?? "codecollab-python-runner:local",
  runnerTimeoutSeconds: parseNumber(process.env.RUNNER_TIMEOUT_SECONDS, 30),
  runnerMemoryLimit: process.env.RUNNER_MEMORY_LIMIT ?? "256m",
};
