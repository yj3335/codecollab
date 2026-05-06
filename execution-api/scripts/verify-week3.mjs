import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const executionApiDir = join(scriptDir, "..");
const port = Number(process.env.EXECUTION_API_VERIFY_PORT ?? "8013");
const baseUrl = `http://127.0.0.1:${port}`;
const wsBaseUrl = `ws://127.0.0.1:${port}`;

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const waitForHealth = async () => {
  let lastBody = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      lastBody = await response.text();
      if (response.ok && lastBody.includes('"ok":true')) {
        return;
      }
    } catch {
      // Server may still be starting.
    }
    await delay(500);
  }

  throw new Error(`execution-api did not become healthy on ${baseUrl}.\nLast body: ${lastBody}`);
};

const buildServer = async () => {
  const result = await runCommand("npm", ["run", "build", "--workspace=execution-api"], {
    cwd: join(executionApiDir, ".."),
    env: process.env,
  });
  assert(result.code === 0, `Build failed.\n${result.stdout}\n${result.stderr}`);
};

const startServer = async () => {
  const child = spawn(
    "node",
    ["dist/execution-api/src/server.js"],
    {
      cwd: executionApiDir,
      env: {
        ...process.env,
        EXECUTION_MODE: "local",
        PORT: String(port),
        RUNNER_TIMEOUT_SECONDS: "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  child.on("error", (error) => {
    logs += `\n${String(error)}`;
  });

  await waitForHealth();

  return {
    child,
    getLogs: () => logs,
  };
};

const normalCode = (id) =>
  [
    "from pathlib import Path",
    "import glob",
    "import time",
    `marker = Path('/tmp/cc_isolation_${id}.txt')`,
    "marker.write_text('ok', encoding='utf-8')",
    "time.sleep(0.5)",
    "visible = sorted(Path(p).name for p in glob.glob('/tmp/cc_isolation_*'))",
    "print('VISIBLE=' + ','.join(visible), flush=True)",
    "if visible != [marker.name]:",
    "    raise SystemExit('isolation breach')",
    `print('RUN_OK:${id}', flush=True)`,
  ].join("\n");

const timeoutCode = [
  "import time",
  "print('TIMEOUT_START', flush=True)",
  "time.sleep(5)",
  "print('UNEXPECTED_TIMEOUT_MISS', flush=True)",
].join("\n");

const postRun = async (body) => {
  const response = await fetch(`${baseUrl}/api/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  assert(response.ok, `POST /api/run failed: ${JSON.stringify(json)}`);
  assert(json.success === true, `POST /api/run returned unsuccessful response: ${JSON.stringify(json)}`);
  return json.data;
};

const postRunAsync = async (body) => {
  const response = await fetch(`${baseUrl}/api/run/async`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  assert(response.ok, `POST /api/run/async failed: ${JSON.stringify(json)}`);
  assert(json.success === true, `POST /api/run/async returned unsuccessful response: ${JSON.stringify(json)}`);
  return json.data;
};

const getRun = async (runId) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/run/${encodeURIComponent(runId)}`);
    const json = await response.json();
    if (response.status === 202) {
      await delay(250);
      continue;
    }
    return { status: response.status, body: json };
  }

  throw new Error(`Timed out polling /api/run/${runId}`);
};

const collectStream = (runId) =>
  new Promise((resolve, reject) => {
    const events = [];
    const ws = new WebSocket(`${wsBaseUrl}/api/run/${encodeURIComponent(runId)}/stream`);

    ws.on("message", (raw) => {
      try {
        events.push(JSON.parse(raw.toString()));
      } catch {
        // ignore malformed frame
      }
    });
    ws.on("error", (error) => reject(error));
    ws.on("close", () => resolve(events));
  });

const verifyConcurrentRuns = async () => {
  const requests = [];
  for (let i = 0; i < 9; i += 1) {
    requests.push(
      postRun({
        sessionId: `week3-concurrent-${i}`,
        language: "python",
        code: normalCode(i),
      }),
    );
  }
  requests.push(
    postRun({
      sessionId: "week3-concurrent-timeout",
      language: "python",
      code: timeoutCode,
      timeout: 2,
    }),
  );

  const results = await Promise.all(requests);

  for (let i = 0; i < 9; i += 1) {
    const result = results[i];
    assert(result.exitCode === 0, `Run ${i} exited with ${result.exitCode}`);
    assert(result.stderr === "", `Run ${i} produced stderr:\n${result.stderr}`);
    assert(
      result.stdout.includes(`RUN_OK:${i}`),
      `Run ${i} missing success marker.\nstdout:\n${result.stdout}`,
    );
    assert(
      result.stdout.includes(`VISIBLE=cc_isolation_${i}.txt`),
      `Run ${i} did not confirm isolated /tmp.\nstdout:\n${result.stdout}`,
    );
    assert(
      !result.stdout.includes("isolation breach"),
      `Run ${i} reported cross-session access.\nstdout:\n${result.stdout}`,
    );
  }

  const timeoutResult = results[9];
  assert(timeoutResult.exitCode === 124, `Timeout run exit code was ${timeoutResult.exitCode}`);
  assert(
    timeoutResult.stderr.includes("Execution timed out after the configured limit."),
    `Timeout run missing timeout stderr.\nstderr:\n${timeoutResult.stderr}`,
  );
  assert(
    !timeoutResult.stdout.includes("UNEXPECTED_TIMEOUT_MISS"),
    `Timeout run unexpectedly completed.\nstdout:\n${timeoutResult.stdout}`,
  );

  console.log("PASS concurrent sync runs");
};

const verifyStreamedTimeout = async () => {
  const accepted = await postRunAsync({
    sessionId: "week3-stream-timeout",
    language: "python",
    code: timeoutCode,
    timeout: 2,
  });

  const [events, finalResult] = await Promise.all([
    collectStream(accepted.runId),
    getRun(accepted.runId),
  ]);

  const stderrEvents = events.filter((event) => event.type === "stderr");
  const completeEvent = events.find((event) => event.type === "complete");

  assert(stderrEvents.length > 0, "Timeout stream emitted no stderr events.");
  assert(
    stderrEvents.some((event) =>
      String(event.data).includes("Execution timed out after the configured limit."),
    ),
    `Timeout stream missing timeout message.\nEvents:\n${JSON.stringify(events, null, 2)}`,
  );
  assert(completeEvent, `Timeout stream missing complete event.\nEvents:\n${JSON.stringify(events, null, 2)}`);
  assert(finalResult.status === 200, `Final timeout run status was ${finalResult.status}`);
  assert(finalResult.body?.data?.exitCode === 124, `Final timeout exit code was not 124.\n${JSON.stringify(finalResult.body)}`);

  console.log("PASS streamed timeout");
};

const verifyWeek3 = async () => {
  await buildServer();
  const server = await startServer();

  try {
    await verifyConcurrentRuns();
    await verifyStreamedTimeout();
    console.log("Week 3 execution verification passed.");
  } finally {
    server.child.kill("SIGINT");
    await delay(1000).catch(() => undefined);
  }
};

verifyWeek3().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
