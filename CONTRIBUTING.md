# Contributing to Edgebric

Thanks for your interest in contributing to Edgebric! This document covers the basics. For a more detailed guide, see the [full contributing documentation](https://docs.edgebric.com/contributing/development).

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/edgebric.git
   cd edgebric
   pnpm install
   ```
3. **Create a branch** from `dev`:
   ```bash
   git checkout dev
   git checkout -b feature/your-feature
   ```
4. **Make your changes** and commit
5. **Open a pull request** against `dev`

## Contributor License Agreement

You'll be asked to sign the [Contributor License Agreement](CLA.md) on your first pull request. This is a one-time requirement.

## Code Style

- **Language**: TypeScript throughout (strict mode)
- **Linting**: ESLint — run `pnpm lint` before committing
- **Type checking**: Run `pnpm typecheck` to verify
- **Formatting**: Follow existing patterns in the codebase
- **UI components**: Use shadcn/ui — don't introduce other component libraries
- **Dark mode**: All UI changes must support both light and dark mode

## Testing Requirements

All pull requests must:

- Pass existing tests (`pnpm test`)
- Include tests for new code
- Assert specific values (not just `.toBeDefined()`)
- Test both happy path and error cases

See [Testing Guide](https://docs.edgebric.com/contributing/testing) for details.

## Commit Messages

Write clear, descriptive commit messages:

```
feat: add Dropbox cloud storage connector
fix: handle expired OAuth tokens during sync
docs: add Okta authentication guide
test: add E2E tests for group chat creation
```

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Include a description of what changed and why
- Add screenshots for UI changes
- Link to any related GitHub issues

## Where to Ask Questions

- **GitHub Discussions**: [github.com/jerv/edgebric/discussions](https://github.com/jerv/edgebric/discussions)
- **Issues**: [github.com/jerv/edgebric/issues](https://github.com/jerv/edgebric/issues)

## Good First Issues

These are great starting points for new contributors:

- **Auth providers**: Add support for Okta, OneLogin, or generic OIDC providers
- **Cloud connectors**: Add Dropbox, Box, or other cloud storage integrations
- **Translations**: Internationalize UI strings

Check [GitHub Issues](https://github.com/jerv/edgebric/issues) labeled `good first issue`.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
