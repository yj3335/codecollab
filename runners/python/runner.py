import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from threading import Thread

import boto3


IMAGE_PREFIX = "CODECOLLAB_IMAGE:"
STDOUT_PREFIX = "CODECOLLAB_STDOUT:"
STDERR_PREFIX = "CODECOLLAB_STDERR:"


def encode_first_png(search_roots: list[Path]) -> str | None:
    for root in search_roots:
        if not root.exists():
            continue
        for candidate in root.rglob("*.png"):
            data = base64.b64encode(candidate.read_bytes()).decode("ascii")
            return f"{IMAGE_PREFIX}data:image/png;base64,{data}"
    return None


def load_payload_from_env() -> tuple[str, str]:
    inline_payload = os.environ.get("CODECOLLAB_INLINE_PAYLOAD_B64")
    if inline_payload:
        payload = json.loads(base64.b64decode(inline_payload).decode("utf-8"))
        return payload.get("code", ""), payload.get("stdin", "")

    bucket = os.environ.get("CODECOLLAB_S3_BUCKET")
    key = os.environ.get("CODECOLLAB_S3_KEY")
    if bucket and key:
        body = (
            boto3.client("s3")
            .get_object(Bucket=bucket, Key=key)["Body"]
            .read()
            .decode("utf-8")
        )
        payload = json.loads(body)
        return payload.get("code", ""), payload.get("stdin", "")

    return "", ""


def ensure_input_files(run_file: Path, stdin_file: Path) -> str:
    inline_code, inline_stdin = load_payload_from_env()

    if inline_code:
        run_file.parent.mkdir(parents=True, exist_ok=True)
        run_file.write_text(inline_code, encoding="utf-8")

    if inline_stdin or not stdin_file.exists():
        stdin_file.parent.mkdir(parents=True, exist_ok=True)
        stdin_file.write_text(inline_stdin, encoding="utf-8")

    return stdin_file.read_text(encoding="utf-8") if stdin_file.exists() else ""


def emit_chunk(stream_name: str, text: str, log_format: str) -> None:
    if not text:
        return

    if log_format == "framed":
        prefix = STDOUT_PREFIX if stream_name == "stdout" else STDERR_PREFIX
        for line in text.splitlines(keepends=True):
            encoded = base64.b64encode(line.encode("utf-8")).decode("ascii")
            sys.stdout.write(f"{prefix}{encoded}\n")
            sys.stdout.flush()
        return

    target = sys.stdout if stream_name == "stdout" else sys.stderr
    target.write(text)
    target.flush()


def stream_pipe(pipe, stream_name: str, log_format: str) -> None:
    try:
        for line in iter(pipe.readline, ""):
            emit_chunk(stream_name, line, log_format)
    finally:
        pipe.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-file", required=True)
    parser.add_argument("--stdin-file", required=True)
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()

    run_file = Path(args.run_file)
    stdin_file = Path(args.stdin_file)
    stdin_data = ensure_input_files(run_file, stdin_file)

    env = os.environ.copy()
    env["MPLBACKEND"] = "Agg"
    env["MPLCONFIGDIR"] = "/tmp/matplotlib"
    log_format = env.get("CODECOLLAB_LOG_FORMAT", "plain")

    with tempfile.TemporaryDirectory(prefix="codecollab-run-", dir="/tmp") as tmp_dir:
        process = subprocess.Popen(
            [sys.executable, str(run_file)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=tmp_dir,
            env=env,
            bufsize=1,
        )

        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None

        stdout_thread = Thread(
            target=stream_pipe,
            args=(process.stdout, "stdout", log_format),
            daemon=True,
        )
        stderr_thread = Thread(
            target=stream_pipe,
            args=(process.stderr, "stderr", log_format),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()

        try:
            process.stdin.write(stdin_data)
            process.stdin.close()
            return_code = process.wait(timeout=args.timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            return_code = 124
            emit_chunk(
                "stderr",
                "Execution timed out after the configured limit.\n",
                log_format,
            )
        finally:
            stdout_thread.join()
            stderr_thread.join()

        image_line = encode_first_png([Path(tmp_dir), run_file.parent])
        if image_line:
            sys.stdout.write(f"{image_line}\n")
            sys.stdout.flush()

        return return_code


if __name__ == "__main__":
    raise SystemExit(main())
