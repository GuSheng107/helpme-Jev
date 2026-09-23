# HelpMe JEV

<p align="center">
  <strong>help me, JEV!</strong><br>
  <sub>When a question is hard to answer, ask JEV.</sub><br>
  <sub>遇到不会回答的问题怎么办？找 JEV。</sub>
</p>

<p align="center">
  A small, self-hosted helper for tricky conversations and everyday decisions.<br>
  <strong>JEV makes the decision. An optional LLM helps with wording. You choose what happens next.</strong>
</p>

<p align="center">
  <a href="https://github.com/GuSheng107/helpme-jev"><img src="https://img.shields.io/github/stars/GuSheng107/helpme-jev?style=flat-square" alt="GitHub stars"></a>
  <a href="https://github.com/GuSheng107/helpme-jev/network/members"><img src="https://img.shields.io/github/forks/GuSheng107/helpme-jev?style=flat-square" alt="GitHub forks"></a>
  <a href="https://github.com/GuSheng107/helpme-jev/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="AGPL-3.0"></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/python-3.12%2B-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.12+"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19"></a>
</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

> [!NOTE]
> HelpMe JEV is a self-hosted <code>0.1.0</code> project. It is meant to help you think, not to speak for you. Provider behavior depends on the JEV and LLM endpoints you configure.

## Why this exists

Some questions are small but strangely difficult:

- “Is this message actually negative, or am I overthinking it?”
- “Should I reply now, ask one more question, or leave it alone?”
- “What is the safest next step at work?”
- “Can I say this more clearly without changing the tone?”

Paste the message, a screenshot, or the situation. HelpMe JEV turns it into a few concrete checks and possible next moves. You can review the inputs, edit drafts, keep the useful context, and stop before anything is sent.

> **JEV decides. LLM explains. You decide.**

JEV (TypeSafe System One) answers typed questions such as yes/no probability, option probability, and scores. It does not write the final message. An optional OpenAI-compatible LLM can translate, clarify, draft, or polish text when you ask it to.

## What it can do

| Area | What you get |
| --- | --- |
| Chat helper | Analyze intent, risk, emotion, needs, and possible next actions. |
| Decision workbench | Ask <code>noul</code>, <code>choice</code>, or <code>score</code> questions without opening a chat. |
| Scenarios | Built-in romance and workplace packs, plus editable copies for your own situations. |
| People and context | Keep separate context for you and the other person; build lightweight persona notes with evidence and confidence. |
| Memory | Let the LLM summarize useful context into dated entries; review, revert, or delete it. |
| Images | Paste or upload PNG/JPEG/WEBP screenshots, up to 9 per message; a vision-capable LLM describes them. HelpMe JEV does not run OCR. |
| Wording help | Polish a message, ask for clarification, generate candidate replies, then let JEV rank them. |
| Data controls | SQLite storage, account export, account deletion, owner-level isolation, trace-linked call logs, and encrypted provider keys. |

## The basic loop

~~~mermaid
flowchart LR
    A["Paste a message<br/>or screenshot"] --> B["Add context<br/>if needed"]
    B --> C["Translate to English<br/>when JEV needs it"]
    C --> D["JEV answers<br/>typed questions"]
    D --> E["Optional LLM<br/>clarifies or drafts"]
    E --> F["JEV compares<br/>possible replies"]
    F --> G["You edit, send,<br/>wait, or stop"]
~~~

Nothing is sent automatically. The final action stays with you.

## Quick start

### Requirements

- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/)
- Node.js 20 or newer for the web development server/build
- A JEV System One-compatible endpoint and an OpenAI-compatible chat endpoint when you want live analysis

### 1. Clone and install

~~~bash
git clone https://github.com/GuSheng107/helpme-jev.git
cd helpme-jev

uv sync --locked
cp .env.example .env
~~~

On PowerShell, use <code>Copy-Item .env.example .env</code> instead of <code>cp</code>.

Generate a 32-byte secret and put the result in <code>.env</code> as <code>APP_SECRET</code>:

~~~bash
python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))"
~~~

Keep <code>APP_SECRET</code> safe. Changing it makes existing encrypted provider keys unreadable.

### 2. Start the backend

~~~bash
uv run uvicorn app.main:app --reload --port 8790
~~~

On the first start, the application:

1. runs the Alembic migrations;
2. checks the expected database schema;
3. creates the first admin user when the database is empty;
4. seeds the built-in romance and workplace scenarios.

The default admin values come from <code>DEFAULT_ADMIN_USERNAME</code> and <code>DEFAULT_ADMIN_PASSWORD</code> in <code>.env</code>. Change the password immediately; the first login requires a password change.

Open the API health check at [http://127.0.0.1:8790/api/health](http://127.0.0.1:8790/api/health), or view the FastAPI schema at [http://127.0.0.1:8790/docs](http://127.0.0.1:8790/docs).

### 3. Start the web app in development

Keep the backend running, open another terminal, and run:

~~~bash
cd web
npm ci
npm run dev
~~~

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies <code>/api</code> to the backend on port <code>8790</code>.

### Single-port build

To let FastAPI serve the built React app:

~~~bash
cd web
npm ci
npm run build
cd ..
uv run uvicorn app.main:app --host 127.0.0.1 --port 8790
~~~

The backend serves <code>web/dist</code> when it exists. For a public deployment, put TLS and an access policy in front of the service, and do not expose the default admin credentials.

## Configure JEV and LLM

After signing in, open **Settings → Providers**.

1. Add a provider with kind <code>jev</code>.
   - Use the full endpoint URL for the System One-compatible API.
   - Enter its API key and model name.
   - Run the connection test and the JEV smoke test.
2. Add a provider with kind <code>llm</code>.
   - Use the full <code>POST</code> URL for an OpenAI-compatible chat endpoint; the app does not guess or append a provider path.
   - Enter its API key and model name.
   - Mark it as vision-capable if it should read screenshots.
3. Choose the default provider of each kind.

The LLM is used only where the workflow needs language work: translation, clarification, image description, reply drafts, and polishing. JEV remains the structured decision layer.

## Environment variables

Copy <code>.env.example</code> to <code>.env</code>. The file is ignored by Git.

| Variable | Default | Purpose |
| --- | --- | --- |
| <code>APP_SECRET</code> | — | Required 32-byte base64url secret used to derive encryption keys. |
| <code>DEFAULT_ADMIN_USERNAME</code> | <code>admin</code> | First admin username; only used when no user exists. |
| <code>DEFAULT_ADMIN_PASSWORD</code> | See <code>.env.example</code> | First admin password; only used when no user exists. |
| <code>PORT</code> | <code>8790</code> | Application port. |
| <code>DATABASE_PATH</code> | <code>./data/helpme_jev.db</code> | SQLite database path. |
| <code>RETENTION_DAYS</code> | <code>15</code> | Retention window for upstream call logs. |
| <code>SESSION_TTL_HOURS</code> | <code>8</code> | Server session lifetime. |
| <code>WEB_DIST_DIR</code> | <code>./web/dist</code> | Built frontend directory served by FastAPI. |

Advanced context budgets are also available in <code>app/core/config.py</code>.

## Project layout

~~~text
app/
├── api/            HTTP endpoints
├── clients/        JEV, LLM, translation, and retry clients
├── core/           configuration, database, security, logging, throttling
├── domain/         enums, errors, and request/response schemas
├── repositories/   SQLAlchemy models and data access
├── scenarios/      built-in question packs
└── services/       application use cases

web/                React 19 + TypeScript + Vite frontend
migrations/         Alembic migrations
tests/              backend tests
~~~

## API map

The interactive API reference is available at <code>/docs</code> when the backend is running.

| Area | Prefix |
| --- | --- |
| Health | <code>GET /api/health</code> |
| Authentication | <code>/api/auth</code> |
| Account export/delete | <code>/api/account</code> |
| Provider settings | <code>/api/providers</code> |
| Scenarios | <code>/api/scenarios</code> |
| Conversations and images | <code>/api/conversations</code> |
| Chat analysis and memory | <code>/api/chat</code> |
| Direct decisions | <code>/api/decide</code> |
| Personas and imports | <code>/api/personas</code>, <code>/api/import</code>, <code>/api/materials</code> |
| Trace-linked logs | <code>/api/logs</code> |

## Privacy and security

- Provider API keys are encrypted at rest with HKDF-SHA256 and AES-256-GCM; the UI receives a mask, never the key.
- Passwords use Argon2id. Bearer tokens are handled as server sessions and stored in hashed form.
- User-owned conversations, memories, personas, provider settings, and logs are isolated by owner. Admin does not automatically get access to another user's content.
- Request logs pass through redaction. <code>Authorization</code>, cookies, and common token formats are removed before logging.
- Call logs are purged after <code>RETENTION_DAYS</code> at startup. Conversations are not deleted just because call logs expire.
- You can export your data or delete the account. Account deletion is intentionally irreversible.

> [!WARNING]
> “Self-hosted” does not mean “nothing leaves the machine.” If you configure a remote JEV or LLM endpoint, the text or images required for that operation are sent there. Read the provider's policy before using private conversations.

## Development

~~~bash
# Backend
uv run pytest -q

# Frontend
cd web
npm run typecheck
npm run build
~~~

The current baseline passes 105 backend tests, frontend type checking, and a production build.

## Contributing

Small, focused pull requests are welcome.

1. Create a branch for your change.
2. Keep secrets, local databases, and <code>web/dist</code> out of commits.
3. Run the backend tests and frontend checks above.
4. Use <code>git diff --check</code> before opening a pull request.
5. Explain behavior changes and provider assumptions in the pull request.

## Thanks

Thanks to the [Linux.do community](https://linux.do/) for the early feedback, questions, and discussions that helped shape this project.

This project is independent and is not affiliated with or endorsed by Linux.do.

The bilingual README layout and self-hosting notes were shaped in part by the author's related project, [human-llm-gateway](https://github.com/GuSheng107/human-llm-gateway).

## License

[AGPL-3.0](LICENSE) © 2026 故笙

If you modify and offer this project as a network service, AGPL-3.0 requires you to provide the corresponding source code to its users.

<p align="center">
  Made for the moment when a message looks simple, but your brain has opened 17 tabs.
</p>
