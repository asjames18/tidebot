# Pull request

## What does this PR change?

<!-- One or two sentences. Link the issue with "Fixes #123" if applicable. -->

## How was it verified?

- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm test` passes (or explains why it's skipped)
- [ ] Tested manually in the browser/desktop (describe below)

<!-- Describe what you clicked, what you saw before, and what you see now. -->

## Checklist

- [ ] No secrets, `.env` files or SQLite `.db` files are staged
- [ ] Model/tool output is treated as untrusted data (no direct injection into prompts, shells or file paths)
- [ ] New user-facing strings don't break existing flows
- [ ] Small, focused diff (split large changes into stacked PRs if you can)

By opening this PR you agree your contribution is licensed under the project's [MIT License](../LICENSE).
