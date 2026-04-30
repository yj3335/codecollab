import argparse
import base64
import os
import subprocess
import sys
import tempfile
from pathlib import Path


IMAGE_PREFIX = "CODECOLLAB_IMAGE:"


def encode_first_png(search_roots: list[Path]) -> str | None:
    for root in search_roots:
        if not root.exists():
            continue
        for candidate in root.rglob("*.png"):
            data = base64.b64encode(candidate.read_bytes()).decode("ascii")
            return f"{IMAGE_PREFIX}data:image/png;base64,{data}"
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-file", required=True)
    parser.add_argument("--stdin-file", required=True)
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()

    run_file = Path(args.run_file)
    stdin_file = Path(args.stdin_file)
    stdin_data = stdin_file.read_text(encoding="utf-8") if stdin_file.exists() else ""

    env = os.environ.copy()
    env["MPLBACKEND"] = "Agg"

    with tempfile.TemporaryDirectory(prefix="codecollab-run-", dir="/tmp") as tmp_dir:
        process = subprocess.run(
            [sys.executable, str(run_file)],
            input=stdin_data,
            text=True,
            capture_output=True,
            timeout=args.timeout,
            cwd=tmp_dir,
            env=env,
        )

        sys.stdout.write(process.stdout)
        sys.stderr.write(process.stderr)

        image_line = encode_first_png([Path(tmp_dir), run_file.parent])
        if image_line:
            sys.stdout.write("\n" + image_line + "\n")

        return process.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.TimeoutExpired:
        sys.stderr.write("Execution timed out after the configured limit.\n")
        raise SystemExit(124)
