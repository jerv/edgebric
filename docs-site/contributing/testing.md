# Testing

Edgebric uses Vitest for unit tests and Playwright for end-to-end tests. Every new module, service, and route must have tests.

## Running Tests

```bash
# All unit tests
pnpm test

# Tests for a specific package
pnpm --filter @edgebric/api test
pnpm --filter @edgebric/core test

# Watch mode (re-runs on file changes)
pnpm --filter @edgebric/api test -- --watch

# E2E tests
pnpm test:e2e
```

## Writing Unit Tests

### File Naming

Test files live next to the code they test, with a `.test.ts` suffix:

```
packages/api/src/routes/
├── dataSources.ts
└── dataSources.test.ts
```

### Test Structure

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('DataSourceService', () => {
  describe('create', () => {
    it('creates a data source with valid input', async () => {
      // Arrange
      const input = { name: 'Test Source', type: 'network' }

      // Act
      const result = await service.create(input)

      // Assert
      expect(result.name).toBe('Test Source')
      expect(result.type).toBe('network')
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('rejects empty names', async () => {
      await expect(service.create({ name: '', type: 'network' }))
        .rejects.toThrow('Name is required')
    })
  })
})
```

### Testing Standards

These are the project's testing rules:

1. **Assert specific values**, not just `.toBeDefined()`. Check response bodies, not just status codes.

   ```typescript
   // Bad
   expect(result).toBeDefined()
   expect(response.status).toBe(200)

   // Good
   expect(result.name).toBe('Company Policies')
   expect(response.body.sources).toHaveLength(3)
   expect(response.body.sources[0].name).toBe('HR')
   ```

2. **Test happy path AND error/edge cases.** Every `if` branch should have a test.

3. **Mock dependencies, not the thing being tested.**

   ```typescript
   // Bad — mocking the service you're testing
   vi.spyOn(service, 'create')

   // Good — mocking the database the service depends on
   vi.spyOn(db, 'insert').mockResolvedValue({ id: '123' })
   ```

4. **Database tests**: The `CREATE TABLE` statements in `db/index.ts` must match `schema.ts`. When adding columns, add `ALTER TABLE` migrations for existing databases, but fresh databases must work from `CREATE TABLE` alone.

## Writing E2E Tests

E2E tests use Playwright and live in the `e2e/` directory.

```typescript
import { test, expect } from '@playwright/test'

test('can create a data source', async ({ page }) => {
  await page.goto('/')
  await page.click('text=New Source')
  await page.fill('[name="sourceName"]', 'Test Source')
  await page.click('text=Create')
  await expect(page.locator('text=Test Source')).toBeVisible()
})
```

### Running E2E Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run with browser visible
pnpm test:e2e -- --headed

# Run a specific test file
pnpm test:e2e -- e2e/data-sources.spec.ts
```

### When to Write E2E Tests

- When adding a new feature visible in the UI
- When modifying existing user-facing functionality
- When fixing a bug that could have been caught by E2E
