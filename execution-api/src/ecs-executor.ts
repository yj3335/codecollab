import { randomUUID } from "node:crypto";

import AWS from "aws-sdk";

import type { RunRequest, RunResult, StreamEvent } from "../../shared/types.js";
import {
  config,
  getRunnerConfig,
  normalizeLanguage,
  type SupportedLanguage,
} from "./config.js";

const ecs = new AWS.ECS({ region: config.awsRegion });
const logs = new AWS.CloudWatchLogs({ region: config.awsRegion });
const s3 = new AWS.S3({ region: config.awsRegion });
const sts = new AWS.STS({ region: config.awsRegion });

const STDOUT_PREFIX = "CODECOLLAB_STDOUT:";
const STDERR_PREFIX = "CODECOLLAB_STDERR:";
const IMAGE_PREFIX = "CODECOLLAB_IMAGE:";

export interface ExecutionEventSink {
  emit: (event: StreamEvent) => void;
}

interface UploadedPayload {
  bucket: string;
  key: string;
}

interface ParsedLogState {
  stdout: string;
  stderr: string;
  seenEventIds: Set<string>;
}

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let accountValidationPromise: Promise<void> | undefined;

const ensureConfiguredForEcs = (): void => {
  if (!config.ecsSubnetIds.length) {
    throw new Error("ECS_SUBNET_IDS must be configured.");
  }

  if (!config.ecsSecurityGroupIds.length) {
    throw new Error("ECS_SECURITY_GROUP_IDS must be configured.");
  }
};

const ensureExpectedAwsAccount = async (): Promise<void> => {
  if (!config.expectedAwsAccountId) {
    return;
  }

  if (!accountValidationPromise) {
    accountValidationPromise = sts
      .getCallerIdentity({})
      .promise()
      .then((identity) => {
        const currentAccount = identity.Account;
        if (currentAccount !== config.expectedAwsAccountId) {
          throw new Error(
            `AWS account mismatch: expected ${config.expectedAwsAccountId}, got ${currentAccount ?? "unknown"}.`,
          );
        }
      })
      .catch((error) => {
        accountValidationPromise = undefined;
        throw error;
      });
  }

  await accountValidationPromise;
};

const uploadPayloadIfNeeded = async (
  runId: string,
  request: RunRequest,
): Promise<UploadedPayload | undefined> => {
  if (Buffer.byteLength(request.code, "utf8") < config.inlineCodeThresholdBytes) {
    return undefined;
  }

  if (!config.execStagingBucket) {
    throw new Error(
      "EXEC_STAGING_BUCKET must be set when code exceeds the inline threshold.",
    );
  }

  const key = `${config.stage}/runs/${runId}/${randomUUID()}.json`;
  await s3
    .putObject({
      Bucket: config.execStagingBucket,
      Key: key,
      Body: JSON.stringify({
        code: request.code,
        stdin: request.stdin ?? "",
      }),
      ContentType: "application/json",
    })
    .promise();

  return { bucket: config.execStagingBucket, key };
};

const getInlinePayloadEnv = (request: RunRequest): AWS.ECS.KeyValuePair => ({
  name: "CODECOLLAB_INLINE_PAYLOAD_B64",
  value: Buffer.from(
    JSON.stringify({
      code: request.code,
      stdin: request.stdin ?? "",
    }),
    "utf8",
  ).toString("base64"),
});

const parseLogMessage = (
  message: string,
  state: ParsedLogState,
): StreamEvent[] => {
  const timestamp = new Date().toISOString();

  if (message.startsWith(STDOUT_PREFIX)) {
    const chunk = Buffer.from(message.slice(STDOUT_PREFIX.length), "base64").toString(
      "utf8",
    );
    state.stdout += chunk;
    return [{ type: "stdout", data: chunk, timestamp }];
  }

  if (message.startsWith(STDERR_PREFIX)) {
    const chunk = Buffer.from(message.slice(STDERR_PREFIX.length), "base64").toString(
      "utf8",
    );
    state.stderr += chunk;
    return [{ type: "stderr", data: chunk, timestamp }];
  }

  if (message.startsWith(IMAGE_PREFIX)) {
    state.stdout += `${message}\n`;
    return [{ type: "stdout", data: `${message}\n`, timestamp }];
  }

  state.stdout += `${message}\n`;
  return [{ type: "stdout", data: `${message}\n`, timestamp }];
};

const logEventKey = (event: AWS.CloudWatchLogs.OutputLogEvent): string =>
  `${event.timestamp ?? "unknown"}:${event.ingestionTime ?? "unknown"}:${event.message ?? ""}`;

const drainLogsForGroup = async (
  sink: ExecutionEventSink,
  logGroupName: string,
  logStreamName: string,
  state: ParsedLogState,
  nextToken?: string,
): Promise<string | undefined> => {
  try {
    const response = await logs
      .getLogEvents({
        logGroupName,
        logStreamName,
        nextToken,
        startFromHead: !nextToken,
      })
      .promise();

    for (const event of response.events ?? []) {
      if (!event.message) continue;
      const key = logEventKey(event);
      if (state.seenEventIds.has(key)) continue;
      state.seenEventIds.add(key);

      for (const parsedEvent of parseLogMessage(event.message, state)) {
        sink.emit(parsedEvent);
      }
    }

    return response.nextForwardToken ?? nextToken;
  } catch (error) {
    const awsError = error as AWS.AWSError;
    if (awsError.code === "ResourceNotFoundException") {
      return nextToken;
    }
    throw error;
  }
};

const replayLogsFromStart = async (
  sink: ExecutionEventSink,
  logGroupName: string,
  logStreamName: string,
  state: ParsedLogState,
): Promise<void> => {
  await drainLogsForGroup(sink, logGroupName, logStreamName, state);
};

export const executeViaEcs = async (
  runId: string,
  request: RunRequest,
  sink: ExecutionEventSink,
): Promise<RunResult> => {
  ensureConfiguredForEcs();
  await ensureExpectedAwsAccount();

  const language: SupportedLanguage =
    normalizeLanguage(request.language) ?? "python";
  const runner = getRunnerConfig(language);

  const startedAt = Date.now();
  const uploadedPayload = await uploadPayloadIfNeeded(runId, request);
  const timeoutSeconds = request.timeout ?? config.runnerTimeoutSeconds;

  sink.emit({
    type: "start",
    data: `Launching ${language} ECS task for run ${runId}`,
    timestamp: new Date().toISOString(),
  });

  try {
    const environment: AWS.ECS.KeyValuePair[] = [
      { name: "RUN_FILE", value: runner.runFile },
      { name: "STDIN_FILE", value: runner.stdinFile },
      { name: "RUN_TIMEOUT_SECONDS", value: String(timeoutSeconds) },
      { name: "CODECOLLAB_LOG_FORMAT", value: "framed" },
    ];

    if (uploadedPayload) {
      environment.push(
        { name: "CODECOLLAB_S3_BUCKET", value: uploadedPayload.bucket },
        { name: "CODECOLLAB_S3_KEY", value: uploadedPayload.key },
      );
    } else {
      environment.push(getInlinePayloadEnv(request));
    }

    const runTaskResponse = await ecs
      .runTask({
        cluster: config.ecsCluster,
        taskDefinition: runner.taskDefinition,
        launchType: "FARGATE",
        count: 1,
        startedBy: `codecollab-${runId}`,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.ecsSubnetIds,
            securityGroups: config.ecsSecurityGroupIds,
            assignPublicIp: config.ecsAssignPublicIp as "DISABLED" | "ENABLED",
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: runner.containerName,
              environment,
            },
          ],
        },
      })
      .promise();

    if (runTaskResponse.failures?.length) {
      throw new Error(
        `ECS RunTask failed: ${runTaskResponse.failures
          .map((failure) => `${failure.arn ?? "unknown"} ${failure.reason ?? ""}`.trim())
          .join(", ")}`,
      );
    }

    const taskArn = runTaskResponse.tasks?.[0]?.taskArn;
    if (!taskArn) {
      throw new Error("ECS RunTask did not return a task ARN.");
    }

    const taskId = taskArn.split("/").pop();
    if (!taskId) {
      throw new Error("Unable to derive ECS task id.");
    }

    const logStreamName = `${runner.logStreamPrefix}/${runner.containerName}/${taskId}`;
    const state: ParsedLogState = { stdout: "", stderr: "", seenEventIds: new Set() };
    let nextToken: string | undefined;
    let lastHeartbeatAt = startedAt;

    while (true) {
      nextToken = await drainLogsForGroup(
        sink,
        runner.logGroup,
        logStreamName,
        state,
        nextToken,
      );

      const described = await ecs
        .describeTasks({
          cluster: config.ecsCluster,
          tasks: [taskArn],
        })
        .promise();

      const task = described.tasks?.[0];
      if (!task) {
        throw new Error("ECS task disappeared before completion.");
      }

      if (task.lastStatus === "STOPPED") {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await replayLogsFromStart(
            sink,
            runner.logGroup,
            logStreamName,
            state,
          );
          await wait(500);
        }

        const container = task.containers?.find(
          (entry) => entry.name === runner.containerName,
        );
        const exitCode = container?.exitCode ?? 1;

        if (container?.reason && exitCode !== 0) {
          state.stderr += `${container.reason}\n`;
          sink.emit({
            type: "stderr",
            data: `${container.reason}\n`,
            timestamp: new Date().toISOString(),
          });
        }

        const executionTime = Date.now() - startedAt;
        sink.emit({
          type: "complete",
          data: JSON.stringify({ exitCode, executionTime }),
          timestamp: new Date().toISOString(),
        });

        return {
          id: runId,
          sessionId: request.sessionId,
          code: request.code,
          language: request.language,
          stdout: state.stdout,
          stderr: state.stderr,
          exitCode,
          executionTime,
          timestamp: new Date().toISOString(),
        };
      }

      const now = Date.now();
      if (now - lastHeartbeatAt >= 10_000) {
        lastHeartbeatAt = now;
        sink.emit({
          type: "start",
          data: `Still waiting for ${language} runner (${task.lastStatus})...`,
          timestamp: new Date().toISOString(),
        });
      }

      await wait(config.cloudWatchPollIntervalMs);
    }
  } finally {
    if (uploadedPayload) {
      await s3
        .deleteObject({
          Bucket: uploadedPayload.bucket,
          Key: uploadedPayload.key,
        })
        .promise()
        .catch(() => undefined);
    }
  }
};

// Back-compat alias for older import sites — prefer executeViaEcs in new code.
export const executePythonViaEcs = executeViaEcs;
