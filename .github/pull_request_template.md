## Summary

<!-- What changed, and why. One or two sentences a reviewer can verify. -->

## Checklist

- [ ] `uv run pytest -q` passes
- [ ] `cd web && npm run typecheck && npm run build` passes, if the frontend changed
- [ ] `git diff --check` is clean
- [ ] No secrets, `.env`, database files, or `web/dist` in the diff
- [ ] UI copy stays formal Chinese and does not assume the other person's gender

## Notes for reviewers

<!-- Behavior changes, provider assumptions, or anything easy to miss. -->
