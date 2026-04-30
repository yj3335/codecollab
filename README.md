# CodeCollab

Real-time collaborative code editor with multi-language support and execution.

## Project Structure

This is a monorepo containing 5 services:

- **frontend**: React + Monaco editor UI (Person A)
- **collab-server**: Yjs + Redis collaboration backend (Yash Jain)
- **execution-api**: Code runner with ECS integration (Person C)
- **runners**: Docker images for Python and Node.js (Person C)
- **translation**: Gemini API Lambda for code translation (Person D)
- **infra**: AWS CDK infrastructure setup (Person D)
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
