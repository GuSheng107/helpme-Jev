# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | yes |
| older commits | no |

There are no versioned releases yet. Security fixes land on `main`.

## Reporting a vulnerability

Please do **not** open a public GitHub issue for a security problem.

Email the maintainer with:

- a short description of the impact
- steps to reproduce, or a proof of concept
- the commit you tested against

Use the address published on the maintainer's GitHub profile
([GuSheng107](https://github.com/GuSheng107)). If none is listed, open a
GitHub Security Advisory on this repository instead of a public issue:

https://github.com/GuSheng107/helpme-jev/security/advisories/new

You can expect an acknowledgement within 7 days. Please give the maintainer
a reasonable window to ship a fix before disclosing details publicly.

## Scope

In scope:

- authentication and session handling
- encryption of stored provider API keys
- owner isolation (one user reading another user's chats, memories, or logs)
- log redaction failures that leak credentials

Out of scope:

- a provider endpoint you configured yourself receiving the text you asked it to process
- the default admin password on a deployment that was never changed
- issues in upstream JEV or LLM services
