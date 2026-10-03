# Contributing

Keep DomusMatchAI small, understandable and easy to try. The demo is the
quickest way to explore a change without connecting a real agency database.

## Local checks

Use Node.js 22+; Auth/Firestore emulator tests also require Java 21+.

```bash
npm ci
npm test
npm run test:rules
npm run build:frontend
npm run build:demo
npm run check:demo
npm audit
```

Windows desktop changes also need `npm run format:rust:check`, Rust/C++
prerequisites and `npm run build`. CI checks and packages the Windows shell.

## Matching changes

Start with a short fictional request/listing that reproduces the incorrect
reason or score. Add a failing test in `src/matching.test.js`, make the
smallest correction, and update `docs/matching.md` when supported grammar
changes. Preserve structured-field precedence and the distinction between
missing information and a known incompatibility. Do not tune scores solely
to make the screenshots look better.

Changes to access rules, subscriptions or delete flows should include a
regression against the actual emulators in `tests/`. Keep the demo adapter's
visible behavior aligned with the shared-workspace adapter.

## Issues and pull requests

Describe the trigger, observed result and expected result; list checks you
ran. Use invented names and records. Do not upload agency exports, customer
details, `.env` files or credentials. Report security problems as described
in [SECURITY.md](SECURITY.md), without exposing them in a public issue.
