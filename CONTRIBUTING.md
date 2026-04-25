# Contributing to CodeCollab

This guide helps team members work smoothly together in this monorepo.

## Before You Start

1. Read `README.md` for project overview
2. Read `shared/contracts.md` for API specifications
3. Check `shared/types.ts` for data structures
4. Set up local environment with `.env.local` files

## Daily Workflow

### Starting work
```bash
git checkout main
git pull origin main
git checkout -b feature/your-feature-name
```

### During development
- Run tests frequently: `npm run test`
- Type check: `npm run build`
- Format code with your IDE (eslint configured)
- Commit regularly with clear messages

### Before submitting PR
1. Pull latest main: `git pull origin main`
2. Resolve any conflicts
3. Run full build: `npm run build`
4. Run tests: `npm run test --workspaces`
5. Update `shared/contracts.md` if APIs changed

## Code Standards

### Naming
- Services: snake_case (collab-server, execution-api)
- Functions/variables: camelCase
- Types/Classes: PascalCase
- Constants: UPPER_SNAKE_CASE

### File organization
- Keep files focused (one main export per file)
- Group related code (don't scatter logic)
- Use index.ts for barrel exports if needed

### Imports
```typescript
// Prefer absolute imports when possible
import { Session } from "shared/types"
import { MyComponent } from "@/components/MyComponent"

// File path imports for relative structure
import { helper } from "./lib/helper"
```

### Error handling
Always handle errors in async code:
```typescript
try {
  const result = await apiCall()
  return result
} catch (error) {
  console.error("Context of error:", error)
  throw new ApiError("User-friendly message", 500)
}
```

### Logging
```typescript
// Use appropriate log levels
console.log("info:", "User created session")      // Info
console.warn("warning:", "High memory usage")     // Warnings
console.error("error:", "Failed to persist")      // Errors
```

## Working with Shared Code

### shared/types.ts
- This is the source of truth for data types
- All services must use these types
- Changes require team discussion
- Update contracts first, then implementation

### shared/contracts.md
- Update this BEFORE implementing API changes
- Include: endpoint path, request body, response format, status codes
- Link to related issues
- Wait for feedback in PR before coding

## Testing

### When to test
- New features: always
- Bug fixes: always
- Refactoring: run existing tests

### Test structure
```typescript
describe("MyComponent", () => {
  it("should do X when Y happens", () => {
    // Arrange
    const input = setupData()
    
    // Act
    const result = myFunction(input)
    
    // Assert
    expect(result).toBe(expected)
  })
})
```

### Running tests
```bash
npm run test                    # Current service
npm run test --workspaces      # All services
npm run test -- --watch        # Watch mode
```

## Database Changes

### Adding a table or field
1. Update types in `shared/types.ts`
2. Update contracts in `shared/contracts.md` with new fields
3. Create migration in `infra/`
4. Notify Person D about deployment

### Data migrations
- Keep migrations versioned
- Document rollback procedure
- Test on dev first, get approval before prod

## Working with AWS Services

### Local development
- Use LocalStack for DynamoDB, S3, etc.
- Environment variables in `.env.local`
- Never commit real AWS credentials

### Deploying changes
- Infrastructure changes: only Person D with `cdk deploy`
- Application changes: CI/CD pipeline (set up later)
- Test deployments: use dev stage first

### Accessing logs
```bash
# View execution logs
aws logs tail /aws/ecs/codecollab-runner-dev --follow

# Export logs locally
aws logs create-export-task --log-group-name /aws/ecs/codecollab-runner-dev
```

## Reviewing Code

### What to look for
- Does it follow the API contract?
- Are types correct from `shared/types.ts`?
- Error handling present?
- No console.logs left in (use proper logging)?
- Tests added/updated?
- Database changes documented?

### Feedback style
- Be specific: point to lines with examples
- Ask questions: "Why did you choose this approach?"
- Suggest: "What if we used X instead?"
- Approve when satisfied

## Merging and Deploying

### Merge requirements
- All tests passing
- At least one approval (not your own)
- No conflicts with main
- All conversations resolved

### After merge
1. Delete the feature branch
2. Pull main locally: `git pull origin main`
3. Verify deployment (CI/CD will run)
4. Monitor logs for errors

## Getting Help

- **API questions**: Check `shared/contracts.md`
- **Type issues**: Check `shared/types.ts` or add new types
- **Stuck on something**: Open an issue or ask in chat
- **Need another service**: Create an issue on that service repo
- **Infrastructure**: Ask Person D

## Emergency Procedures

### Revert a commit
```bash
git revert <commit-hash>
git push origin main
```

### Fix a bad merge
```bash
git reset --hard HEAD~1  # Undo last commit
git push --force origin main  # Force push (only if not deployed)
```

### Database issues
- Contact Person B (collab-server) for DynamoDB issues
- Contact Person C (execution-api) for cache issues
- Contact Person D for infrastructure issues
