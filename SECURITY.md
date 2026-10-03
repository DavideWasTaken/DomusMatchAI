# Security

The maintained version is `main`. This public edition contains fictional demo
data and no configured customer backend. Each agency manages its own Firebase
project, operator accounts and backups.

## Reporting a problem

Use GitHub's private vulnerability reporting when available. Otherwise contact
the author through [davide.sh](https://davide.sh) to arrange a private report.
Include a fictional reproduction and affected commit. Do not post keys,
customer records or a working exploit against an agency in a public issue.

## Access and data boundaries

- Email/password authentication plus `members/{uid}.active == true` grants
  shared archive access. Ordinary operators cannot enroll or approve users.
- All approved operators share the same collections. There are no branch
  permissions, tenant boundaries or field-level business validation.
- Initial display waits for server-confirmed membership and record snapshots.
  Record caches and cleanup retry tickets are memory-only. A disconnected
  session may retain data it already displayed; revocation takes effect when
  the server reports it, and cannot recall exports or screenshots.
- Match writes must reference existing sources after the write batch. Cascade
  cleanup has documented concurrent/interruption limits, not a server-side
  integrity guarantee against every administrative operation.
- The desktop CSP limits connections to local IPC and Firebase hosts. Only the
  development CSP adds the local Vite websocket. Installer signing, deployment
  configuration, endpoint security and backup/restore belong to the operator.

`VITE_*` values are embedded in the client. Firebase Web App configuration is
public configuration; Admin SDK JSON, private keys and other server secrets
must never appear there. Deploy the included rules before using real records.

`npm audit` covers the committed app/test dependency graph. The pinned Firebase
CLI is invoked separately through `npx`; it has its own dependencies and may
carry upstream advisories. Review tool updates before production administration.
Do not use `npm audit fix --force` to downgrade Firebase or bypass compatibility.
