#!/usr/bin/env node
// CodeCollab Node.js runner — mirrors runners/python/runner.py protocol.
//
// Reads payload (code + stdin) from CODECOLLAB_INLINE_PAYLOAD_B64 or S3
// (CODECOLLAB_S3_BUCKET / CODECOLLAB_S3_KEY), spawns `node <run-file>`,
// streams framed stdout/stderr (CODECOLLAB_STDOUT: / CODECOLLAB_STDERR:
// base64 lines), and emits the first PNG it finds (if any) as
// CODECOLLAB_IMAGE: data:image/png;base64,...

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const IMAGE_PREFIX = "CODECOLLAB_IMAGE:";
const STDOUT_PREFIX = "CODECOLLAB_STDOUT:";
const STDERR_PREFIX = "CODECOLLAB_STDERR:";
const TIMEOUT_EXIT_CODE = 124;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && i + 1 < argv.length) {
      out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

async function loadPayloadFromEnv() {
  const inline = process.env.CODECOLLAB_INLINE_PAYLOAD_B64;
  if (inline) {
    const decoded = Buffer.from(inline, "base64").toString("utf-8");
    const payload = JSON.parse(decoded);
    return { code: payload.code ?? "", stdin: payload.stdin ?? "" };
  }

  const bucket = process.env.CODECOLLAB_S3_BUCKET;
  const key = process.env.CODECOLLAB_S3_KEY;
  if (bucket && key) {
    // Lazy require so the runner still works if @aws-sdk/client-s3 isn't bundled
    // (it's installed in the runner image).
    const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
    const client = new S3Client({});
    const resp = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const body = await resp.Body.transformToString("utf-8");
    const payload = JSON.parse(body);
    return { code: payload.code ?? "", stdin: payload.stdin ?? "" };
  }
  return { code: "", stdin: "" };
}

async function ensureInputFiles(runFile, stdinFile) {
  const { code, stdin } = await loadPayloadFromEnv();
  if (code) {
    await fsp.mkdir(path.dirname(runFile), { recursive: true });
    await fsp.writeFile(runFile, code, "utf-8");
  }
  let stdinExists = false;
  try {
    await fsp.access(stdinFile);
    stdinExists = true;
  } catch {
    /* missing */
  }
  if (stdin || !stdinExists) {
    await fsp.mkdir(path.dirname(stdinFile), { recursive: true });
    await fsp.writeFile(stdinFile, stdin ?? "", "utf-8");
  }
  return await fsp.readFile(stdinFile, "utf-8");
}

function emitChunk(streamName, text, logFormat) {
  if (!text) return;
  if (logFormat === "framed") {
    const prefix = streamName === "stdout" ? STDOUT_PREFIX : STDERR_PREFIX;
    // Split keeping line terminators, emit each as base64.
    const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    for (const line of lines) {
      const encoded = Buffer.from(line, "utf-8").toString("base64");
      process.stdout.write(`${prefix}${encoded}\n`);
    }
    return;
  }
  const target = streamName === "stdout" ? process.stdout : process.stderr;
  target.write(text);
}

function streamPipe(stream, name, logFormat) {
  return new Promise((resolve) => {
    let buffer = "";
    stream.setEncoding("utf-8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lastNewline = buffer.lastIndexOf("\n");
      if (lastNewline >= 0) {
        emitChunk(name, buffer.slice(0, lastNewline + 1), logFormat);
        buffer = buffer.slice(lastNewline + 1);
      }
    });
    stream.on("end", () => {
      if (buffer) emitChunk(name, buffer, logFormat);
      resolve();
    });
    stream.on("error", () => resolve());
  });
}

async function findFirstPng(roots) {
  async function* walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) yield* walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".png")) yield full;
    }
  }
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for await (const file of walk(root)) {
      const data = await fsp.readFile(file);
      return `${IMAGE_PREFIX}data:image/png;base64,${data.toString("base64")}`;
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const runFile = args["run-file"];
  const stdinFile = args["stdin-file"];
  const timeoutSec = parseInt(args["timeout"] ?? "30", 10);
  if (!runFile || !stdinFile) {
    process.stderr.write("runner.js: --run-file and --stdin-file are required\n");
    return 2;
  }

  const stdinData = await ensureInputFiles(runFile, stdinFile);
  const logFormat = process.env.CODECOLLAB_LOG_FORMAT ?? "plain";

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codecollab-run-"));
  try {
    const child = spawn(process.execPath, [runFile], {
      cwd: tmpDir,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutDone = streamPipe(child.stdout, "stdout", logFormat);
    const stderrDone = streamPipe(child.stderr, "stderr", logFormat);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

    if (stdinData) child.stdin.write(stdinData);
    child.stdin.end();

    const exitCode = await new Promise((resolve) => {
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          emitChunk(
            "stderr",
            "Execution timed out after the configured limit.\n",
            logFormat
          );
          resolve(TIMEOUT_EXIT_CODE);
          return;
        }
        if (code === null && signal) {
          resolve(128 + (os.constants.signals[signal] ?? 0));
        } else {
          resolve(code ?? 0);
        }
      });
    });

    await Promise.all([stdoutDone, stderrDone]);

    const imageLine = await findFirstPng([
      tmpDir,
      path.dirname(runFile),
    ]);
    if (imageLine) {
      process.stdout.write(`${imageLine}\n`);
    }
    return exitCode;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`runner.js fatal: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
