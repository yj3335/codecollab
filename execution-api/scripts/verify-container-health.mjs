import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";

const image = process.env.EXECUTION_API_IMAGE ?? "codecollab-execution-api:local";
const port = process.env.EXECUTION_API_PORT ?? "8011";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../..");

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

const verify = async () => {
  const build = await runCommand("docker", [
    "build",
    "-f",
    join(repoRoot, "execution-api/Dockerfile"),
    "-t",
    image,
    repoRoot,
  ]);
  assert(build.code === 0, `Failed to build execution-api image.\n${build.stderr}`);

  const containerName = `codecollab-execution-api-check-${Date.now()}`;
  let logs = "";

  const start = await runCommand("docker", [
    "run",
    "-d",
    "--name",
    containerName,
    "-p",
    `${port}:8001`,
    image,
  ]);
  assert(start.code === 0, `Failed to start execution-api container.\n${start.stderr}`);

  try {
    let lastError = "";
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await delay(1000);
      const health = await runCommand("curl", [
        "-sS",
        "-o",
        "/tmp/codecollab-execution-health.json",
        "-w",
        "%{http_code}",
        `http://127.0.0.1:${port}/health`,
      ]);

      if (health.code === 0 && health.stdout.trim() === "200") {
        const body = await runCommand("cat", ["/tmp/codecollab-execution-health.json"]);
        assert(
          body.stdout.includes('"ok":true'),
          `Health endpoint returned 200 but unexpected body:\n${body.stdout}`,
        );
        console.log("PASS container health");
        return;
      }

      lastError = `${health.stderr}\n${health.stdout}`;
    }

    const logResult = await runCommand("docker", ["logs", containerName]).catch(() => ({
      stdout: "",
      stderr: "",
    }));
    logs = `${logResult.stdout}${logResult.stderr}`;
    throw new Error(`Container health check never passed.\n${lastError}\nLogs:\n${logs}`);
  } finally {
    await runCommand("docker", ["rm", "-f", containerName]).catch(() => undefined);
  }
};

verify().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
