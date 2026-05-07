# CodeCollab

Real-time collaborative code editor with multi-language support and execution.

## Live demo

> **Public URL**: <https://dup2iyfhlam0h.cloudfront.net>
>
> Open the URL in two browsers/tabs to try collaboration. The first run after a
> deploy or long idle takes ~50 s because of an ECS Fargate cold start; later
> runs return in a few seconds. Translation needs a real Gemini key in the
> Secrets Manager secret `codecollab/gemini-api-key` — the demo currently
> has a placeholder so the Translate flow surfaces a friendly 500.

See [`docs/demo-script.md`](docs/demo-script.md) for the 3-minute click-through
script.

## Project Structure

This is a monorepo containing 5 services:

- **frontend**: React + Monaco editor UI (Yatharth)
- **collab-server**: Yjs + Redis collaboration backend (Yash Jain)
- **execution-api**: Code runner with ECS integration (Pranali)
- **runners**: Docker images for Python and Node.js (Pranali)
- **translation**: Gemini API Lambda for code translation (Binti)
- **infra**: AWS CDK infrastructure setup (Binti)
- **shared**: Shared types and API contracts (everyone)

## Quick Start

### Prerequisites
- Node.js 18+ and npm 9+
- Docker (for running containers locally)
- AWS credentials configured (for CDK deployment)
- Git

### Setup

1. Clone and install
```bash
git clone <repo-url>
cd codecollab
npm install
```

2. Set up environment files
```bash
# In each service directory, create .env.local
cp .env.example .env.local
# Edit with your values
```

3. Start development servers
```bash
npm run dev
```

This will start all services in watch mode.

## Workspace Organization

Each person works on their assigned services but can read shared files:

**Yatharth Mogra (Frontend)**
- `frontend/` - Read/write
- `shared/` - Read only

**Yash Jain (Collaboration)**
- `collab-server/` - Read/write
- `shared/` - Read only

**Pranali Thakkar (Execution)**
- `execution-api/` - Read/write
- `runners/` - Read/write
- `shared/` - Read only

**Binti Padaliya (Translation + Infrastructure)**
- `translation/` - Read/write
- `infra/` - Read/write
- `shared/` - Read only

## API Contract

The source of truth for all API contracts is `shared/contracts.md`. 

Before implementing any endpoint or changing data structures:
1. Update the contract in `shared/contracts.md`
2. Update types in `shared/types.ts`
3. Notify other team members in the PR
4. Wait for feedback before coding

## Git Workflow

### Branch naming
- Feature: `feature/description-of-work`
- Bug fix: `bugfix/description-of-fix`
- Infrastructure: `infra/description-of-change`
- Docs: `docs/description-of-update`

### Commit messages
```
[SERVICE] Brief description

Longer explanation if needed. Reference issues/PRs.
```

Example:
```
[collab-server] Add session persistence to DynamoDB

- Implement read/write operations for Session table
- Add GSI for public sessions filtering
- Add migration script for existing data
Closes #42
```

### Pull requests
1. Create PR with clear title mentioning the service
2. Link related issues
3. Include testing steps
4. Request review from affected team members
5. Get approval before merging to main

## Development Tips

### Run a single service
```bash
cd frontend
npm run dev
```

### Build specific service
```bash
npm run build --workspace=frontend
```

### Run tests
```bash
npm run test --workspaces
```

### Check TypeScript
```bash
npm run build
```

## Common Tasks

### Update shared types
1. Edit `shared/types.ts`
2. Create PR for review
3. All services pull latest main after merge

### Change API contract
1. Update `shared/contracts.md`
2. Discuss changes in team slack
3. Implement in corresponding services
4. Update types in `shared/types.ts`

### Deploy infrastructure
```bash
cd infra
npm run synth          # Generate CloudFormation
npm run diff           # See what will change
npm run deploy         # Deploy to AWS
```

## Infrastructure

Five CDK stacks are deployed to AWS (`us-east-1`, currently account
`209292847448`):

| Stack | What it owns |
|---|---|
| `CodeCollab-NetworkStack` | VPC, public + private subnets, NAT gateways, VPC endpoints |
| `CodeCollab-DataStack` | DynamoDB (sessions), ElastiCache Redis, S3 buckets (edit history, exec staging), ECR repos, translation Lambda, Yjs compaction Lambda |
| `CodeCollab-ComputeStack` | ECS Fargate cluster, ALB with path routing, Fargate services + auto-scaling, runner task definitions |
| `CodeCollab-FrontendStack` | S3 bucket for compiled SPA, CloudFront distribution with `/api/*` and `/ws/*` routed to the ALB |
| `CodeCollab-ObservabilityStack` | CloudWatch dashboard for the four core signals |

### CloudFront routing

CloudFront is the only public origin. Behaviors:

| Path             | Origin            | Notes                                 |
| ---------------- | ----------------- | ------------------------------------- |
| `/` (default)    | S3 frontend bucket | SPA fallback via 403 → /index.html   |
| `/api/*`         | ALB               | Caching disabled, all methods allowed |
| `/ws/*`          | ALB               | WebSocket upgrade support             |

### ECS services & auto-scaling

Services run on Fargate in private subnets behind the ALB.

| Service        | Port | ALB path(s)                 | Health check    | Min | Max | CPU scale-out |
| -------------- | ---- | --------------------------- | --------------- | --- | --- | ------------- |
| collab-server  | 8000 | `/ws/*`, `/api/sessions/*`  | `GET /healthz`  | 2   | 6   | 60 %          |
| execution-api  | 8001 | `/api/run/*`                | `GET /healthz`  | 1   | 4   | 60 %          |
| (translation)  | n/a  | `/api/translate*`           | n/a (Lambda)    | n/a | n/a | n/a           |

Scale-out cooldown: 60 s. Scale-in cooldown: 300 s.

### Deploy from scratch

```bash
# 0. Bootstrap once per AWS account/region
cd infra && npx cdk bootstrap aws://<account>/<region>

# 1. Stand up data plane (creates ECR repos used by step 2)
npx cdk deploy CodeCollab-NetworkStack CodeCollab-DataStack

# 2. Build & push 4 Docker images for linux/amd64 (Fargate platform)
cd ..
aws ecr get-login-password --region <region> | docker login --username AWS \
  --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
for image in python-runner nodejs-runner collab-server execution-api; do
  case $image in
    python-runner)  ctx=runners/python   ; df=runners/python/Dockerfile ;;
    nodejs-runner)  ctx=runners/nodejs   ; df=runners/nodejs/Dockerfile ;;
    collab-server)  ctx=.                ; df=collab-server/Dockerfile ;;
    execution-api)  ctx=.                ; df=execution-api/Dockerfile ;;
  esac
  docker buildx build --platform linux/amd64 --push \
    -t <account>.dkr.ecr.<region>.amazonaws.com/codecollab/$image:latest \
    -f $df $ctx
done

# 3. Stand up compute, frontend, observability
cd infra
npx cdk deploy CodeCollab-ComputeStack \
              CodeCollab-FrontendStack \
              CodeCollab-ObservabilityStack

# 4. Build the SPA pointed at the deployed CloudFront domain and sync to S3
cd ../frontend
cat > .env.production.local <<EOF
REACT_APP_COLLAB_API_URL=https://<cloudfront-domain>
REACT_APP_EXECUTION_API_URL=https://<cloudfront-domain>
REACT_APP_COLLAB_WS_URL=wss://<cloudfront-domain>/ws
REACT_APP_DEFAULT_LANGUAGE=python
EOF
CI=true npm run build
aws s3 sync ./build s3://<frontend-bucket> --delete
aws cloudfront create-invalidation --distribution-id <dist-id> --paths '/*'

# 5. Set the Gemini API key (required for Translate)
aws secretsmanager update-secret \
  --secret-id codecollab/gemini-api-key --secret-string '<your-key>'
```

Stack outputs (after step 1 + 3) include the ECR repo URIs, the ALB DNS, the
CloudFront distribution id and the public URL.

## Troubleshooting

**Port conflicts?**
Services default to:
- Frontend: 3000
- Collab Server: 8000
- Execution API: 8001
- Set different ports in .env.local

**Node modules issues?**
```bash
rm -rf node_modules package-lock.json
npm install
```

**AWS credentials not found?**
```bash
# Configure AWS credentials
aws configure
# Or set environment variables
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

## Contact

- Architecture questions: See `shared/contracts.md`
- Need to sync with team? Check calendar for collab sync time
- Blocked on another service? Open an issue on that service
