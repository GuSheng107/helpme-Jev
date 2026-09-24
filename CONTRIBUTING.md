# Contributing

Thanks for considering a contribution. HelpMe JEV is a small self-hosted tool:
JEV makes structured decisions, an optional LLM handles wording, and the user
keeps the final say. Please keep changes in that spirit.

## Before you start

- Search existing [issues](https://github.com/GuSheng107/helpme-jev/issues) and
  pull requests so you do not duplicate work.
- For a bug, open an issue with steps to reproduce before writing a large fix.
- For a new feature, open an issue first if the change touches the decision
  flow, storage, or provider protocol. Small fixes can go straight to a PR.

## Development setup

```bash
git clone https://github.com/GuSheng107/helpme-jev.git
cd helpme-jev
uv sync --locked --group dev
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
```

Generate `APP_SECRET` and put it in `.env`:

```bash
python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))"
```

Frontend:

```bash
cd web
npm ci
npm run dev
```

## Checks before opening a pull request

```bash
uv run pytest -q          # backend, from the repo root
cd web && npm run typecheck && npm run build
git diff --check
```

CI runs the same checks on every pull request.

## Pull request guidelines

- One concern per PR. Split unrelated cleanups from the behavior change.
- Write a clear title and say what changed for the user, not just which files moved.
- Add or update a test when you change behavior. Backend tests mock upstream
  providers; do not call real JEV or LLM endpoints in tests.
- Do not commit secrets, `.env`, `data/`, or `web/dist`.
- Match the existing style. Do not reformat files you did not need to touch.
- UI copy is formal Chinese. Do not hard-code the other person's gender.

## Reporting security issues

Please do not file a public issue for a vulnerability. See
[SECURITY.md](SECURITY.md).
