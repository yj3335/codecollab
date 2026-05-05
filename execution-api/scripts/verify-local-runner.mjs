import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const image = process.env.PYTHON_RUNNER_IMAGE ?? "codecollab-python-runner:local";
const timeoutSeconds = process.env.RUNNER_TIMEOUT_SECONDS ?? "2";
const memoryLimit = process.env.RUNNER_MEMORY_LIMIT ?? "256m";
const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const runnerContext = join(scriptDir, "../../runners/python");

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

const buildRunnerImage = async () => {
  const result = await runCommand("docker", [
    "build",
    "-t",
    image,
    runnerContext,
  ]);

  assert(result.code === 0, `Failed to build runner image.\n${result.stderr}`);
};

const verifyScenario = async ({ name, code, expectedExitCode, assertOutput }) => {
  const workspaceDir = await mkdtemp(join(tmpdir(), "codecollab-verify-"));
  const codePath = join(workspaceDir, "main.py");
  const stdinPath = join(workspaceDir, "stdin.txt");

  try {
    await writeFile(codePath, code, "utf8");
    await writeFile(stdinPath, "", "utf8");

    const result = await runCommand("docker", [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,size=64m",
      "--memory",
      memoryLimit,
      "--pids-limit",
      "64",
      "-e",
      "RUN_FILE=/workspace/main.py",
      "-e",
      "STDIN_FILE=/workspace/stdin.txt",
      "-e",
      `RUN_TIMEOUT_SECONDS=${timeoutSeconds}`,
      "-v",
      `${workspaceDir}:/workspace:ro`,
      image,
    ]);

    assert(
      result.code === expectedExitCode,
      `${name}: expected exit ${expectedExitCode}, received ${result.code}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );

    await assertOutput(result);
    console.log(`PASS ${name}`);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
};

const verify = async () => {
  await buildRunnerImage();

  await verifyScenario({
    name: "uid",
    code: "import os\nprint(os.getuid())\n",
    expectedExitCode: 0,
    assertOutput: async (result) => {
      assert(result.stdout.trim() === "1000", `uid: expected 1000, got ${result.stdout.trim()}`);
    },
  });

  await verifyScenario({
    name: "read-only root",
    code: [
      "from pathlib import Path",
      "target = Path('/root-blocked.txt')",
      "try:",
      "    target.write_text('blocked', encoding='utf-8')",
      "    print('unexpected-write-success')",
      "except Exception as exc:",
      "    print(type(exc).__name__)",
    ].join("\n"),
    expectedExitCode: 0,
    assertOutput: async (result) => {
      assert(
        result.stdout.includes("OSError") || result.stdout.includes("PermissionError") || result.stdout.includes("EROFS"),
        `read-only root: expected write failure, got stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    },
  });

  await verifyScenario({
    name: "network isolation",
    code: [
      "import socket",
      "sock = socket.socket()",
      "sock.settimeout(1)",
      "try:",
      "    sock.connect(('1.1.1.1', 53))",
      "    print('unexpected-network-success')",
      "except Exception as exc:",
      "    print(type(exc).__name__)",
      "finally:",
      "    sock.close()",
    ].join("\n"),
    expectedExitCode: 0,
    assertOutput: async (result) => {
      assert(
        !result.stdout.includes("unexpected-network-success"),
        `network isolation: outbound network unexpectedly succeeded.\nstdout:\n${result.stdout}`,
      );
    },
  });

  await verifyScenario({
    name: "timeout",
    code: "import time\ntime.sleep(10)\nprint('unexpected-timeout-miss')\n",
    expectedExitCode: 124,
    assertOutput: async (result) => {
      assert(
        result.stderr.includes("Execution timed out after the configured limit."),
        `timeout: expected timeout message.\nstderr:\n${result.stderr}`,
      );
    },
  });

  await verifyScenario({
    name: "memory limit",
    code: [
      "from pathlib import Path",
      "candidates = [Path('/sys/fs/cgroup/memory.max'), Path('/sys/fs/cgroup/memory/memory.limit_in_bytes')]",
      "for candidate in candidates:",
      "    if candidate.exists():",
      "        print(candidate.read_text(encoding='utf-8').strip())",
      "        break",
    ].join("\n"),
    expectedExitCode: 0,
    assertOutput: async (result) => {
      const limitValue = result.stdout.trim();
      assert(limitValue.length > 0, "memory limit: could not read cgroup memory limit.");
      assert(limitValue !== "max", `memory limit: expected a bounded limit, got ${limitValue}.`);
      const bytes = Number(limitValue);
      assert(Number.isFinite(bytes), `memory limit: expected numeric cgroup value, got ${limitValue}.`);
      assert(
        bytes <= 268435456,
        `memory limit: expected <= 256 MiB, got ${bytes} bytes.`,
      );
    },
  });

  console.log("Local runner verification passed.");
};

verify().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
