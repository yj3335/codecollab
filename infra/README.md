# CodeCollab Infrastructure

AWS CDK v2 (TypeScript) infrastructure for CodeCollab. Three stacks deploy in dependency order: NetworkStack → DataStack → ComputeStack.

## Stacks

### NetworkStack — `CodeCollab-NetworkStack`

VPC and connectivity shared by all other stacks.

| Resource | Detail |
|----------|--------|
| VPC | `10.0.0.0/16`, 2 AZs, 2 public + 2 private subnets |
| NAT Gateways | 2 (one per AZ) for private-subnet egress |
| Gateway endpoints | DynamoDB, S3 — free, no NAT cost |
| Interface endpoints | ECR API, ECR Docker, CloudWatch Logs — keeps image pulls and log shipping inside the VPC |

---

### DataStack — `CodeCollab-DataStack`

Stateful resources and data-plane Lambdas.

| Resource | Detail |
|----------|--------|
| DynamoDB | `codecollab-sessions`, PK `sessionId` (String), PAY_PER_REQUEST, TTL on `expiresAt` |
| S3 — edit history | `codecollab-edit-history-{account}` — incremental Yjs updates from collab-server |
| S3 — exec staging | `codecollab-exec-staging-{account}` — code input/output for runner tasks |
| ElastiCache Redis 7 | Single-node `cache.t3.micro`, TLS in-transit + at-rest, private subnets |
| SQS DLQ | `codecollab-dlq`, 14-day retention |
| ECR | `codecollab/python-runner`, `codecollab/nodejs-runner` — lifecycle: keep last 5 images |
| Translation Lambda | `codecollab-translation` — Node 20, mock translate handler, ALB target |
| Compaction Lambda | `codecollab-yjs-compaction` — Node 20, 512 MB, 5 min timeout — merges incremental Yjs S3 updates into DynamoDB, deletes processed objects |
| EventBridge | `CompactionSchedule` — `cron(0 4 * * ? *)`, triggers compaction Lambda nightly at 04:00 UTC |

**Compaction Lambda env vars**

| Var | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `S3_BUCKET_LOGS` | edit-history bucket name |
| `DYNAMODB_TABLE_SESSIONS` | `codecollab-sessions` |

---

### ComputeStack — `CodeCollab-ComputeStack`

ECS Fargate cluster, ALB, and IAM task roles.

**ALB** — `codecollab-alb`, internet-facing, port 80

| Path pattern | Target | Port |
|---|---|---|
| `/ws`, `/ws/*` | collab-server | 8000 |
| `/api/sessions`, `/api/sessions/*` | collab-server | 8000 |
| `/api/run`, `/api/run/*` | execution-api | 8001 |
| `/translate`, `/translate/*` | Translation Lambda | — |
| `*` (default) | frontend | 3000 |

**ECS Services**

| Service | Image | Desired | CPU / Mem |
|---------|-------|---------|-----------|
| collab-server | `codecollab/collab-server:latest` | 2 | 512 / 1024 |
| execution-api | placeholder¹ | 1 | 512 / 1024 |
| frontend | placeholder¹ | 1 | 256 / 512 |

¹ ALB target registration skipped until real ECR image is pushed.

**IAM Task Roles**

| Role | Permissions |
|------|-------------|
| `collab-server-task-role` | `dynamodb:{GetItem,PutItem,UpdateItem,DeleteItem,Query}` on sessions table; `s3:{PutObject,GetObject}` on edit-history objects; `s3:ListBucket` on edit-history bucket |
| `execution-api-task-role` | `s3:{GetObject,PutObject}` on exec-staging; `ecs:RunTask` on python/nodejs-runner task defs (cluster-scoped); `ecs:DescribeTasks` on cluster tasks; `logs:{GetLogEvents,FilterLogEvents}` on runner log groups; `iam:PassRole` on execution role + runner task roles |
| `frontend-task-role` | None |
| `python-runner-task-role` | None (network blocked at container level) |
| `nodejs-runner-task-role` | None (network blocked at container level) |

---

## Prerequisites

- Node.js 20+
- AWS CLI configured (`aws sts get-caller-identity` shows the right account)
- CDK bootstrapped: `npx cdk bootstrap aws://<account>/us-east-1`

## Deploy

```bash
cd infra
npm install

# All three stacks in order
npx cdk deploy --all --require-approval never

# Single stack
npx cdk deploy CodeCollab-DataStack --require-approval never
```

## Useful commands

```bash
# Diff against deployed state
npx cdk diff

# Synthesise CloudFormation templates only (no deploy)
npx cdk synth

# Destroy everything (destructive — data will be lost)
npx cdk destroy --all
```

## Cross-stack dependency notes

- **No hardcoded account IDs** — all ARNs use `this.account` / `this.region` tokens.
- **ECS security group lives in ComputeStack**, not DataStack. Moving it avoids a cross-stack SG reference cycle between the Redis SG (DataStack) and the ECS task SG (ComputeStack). Redis allows inbound from the VPC CIDR instead.
- **Translation Lambda ALB target** uses a CFN escape hatch (`CfnTargetGroup.targets` + `CfnPermission` without `sourceArn`) to break the circular dependency that `LambdaTarget.bind()` would create between DataStack and ComputeStack.
