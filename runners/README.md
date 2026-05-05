# runners

## Week 2

- `python/` contains the real execution runner used by ECS `RunTask`
- `nodejs/` remains a stub for future milestones

The Python runner:

- supports inline payloads for smaller requests
- supports S3-backed payloads for larger requests
- emits framed stdout/stderr for CloudWatch log parsing
- emits `CODECOLLAB_IMAGE` for matplotlib PNG output
- runs as uid `1000`
- is intended to run with a read-only root filesystem
