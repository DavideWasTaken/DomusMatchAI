# Architecture and limits

DomusMatchAI is a small shared-agency application, originally developed for a private agency with three branches. The public edition preserves that focused workflow while separating customer material and infrastructure.

| File | Responsibility |
| --- | --- |
| `src/main.js` | Italian forms, archive views, matching views, exports and session UI |
| `src/matching.js` | Pure local extraction and scoring of current client/property data |
| `src/data.js` | Select demo or Firebase adapter based on Vite build mode |
| `src/demo.js` | Fictional in-memory records; no Firebase initialization |
| `src/firebase.js` | Session authentication, approved membership, listeners and persistence |
| `firestore.rules` | Enforce shared-agency access and deny operator self-enrollment |
| `src-tauri/` | Windows desktop shell and app version command |

## Deliberate boundaries

- One Firebase project represents one agency. Operators share records; three branches describes the original use case, not a branch-specific authorization model.
- Matching has no model API. Italian text parsing is limited and scores require human review.
- Notes are stored and displayed but excluded from matching extraction and text similarity.
- Scores displayed in rankings, messages, badges and exports are recalculated using current records and current filters. Stored matches are not an immutable historical record; orphaned stored rows are ignored after their client/property is deleted.
- Messages are copied to the clipboard for manual review. The application never sends them to clients.
- Export uses SpreadsheetML XML with an `.xls` extension for compatibility; it is not a native `.xlsx` file. Some spreadsheet software may warn about the extension/format. Values are written as typed XML cells, not executable spreadsheet formulas.
- Location fields are manual. The public Nominatim service [does not permit client-side autocomplete](https://operations.osmfoundation.org/policies/nominatim/); this edition makes no requests to it. There is no geocoding, distance ranking or address verification.
- Firebase sessions use memory-only record caches and server-confirmed initial data. Offline-first operation and conflict resolution are outside scope.
- The source contains no original agency identity, commercial proposals, documents, credentials or customer datasets. Screenshots and demo fixtures are invented.

## Running modes

`npm run demo` / `npm run build:demo` select the isolated demo at build time. Merely appending a query parameter to the production app cannot select the demo adapter. Reloading demo restores the fixtures; signing out and re-entering within the same loaded page preserves that page's in-memory changes.

`npm run dev` / `npm run build:frontend` select Firebase. A project must be configured before using the authenticated workspace. Tauri's normal desktop build embeds this configured frontend; the browser demo is the quickest credential-free way to evaluate the project.

## Maintenance

Use `npm ci` with the committed lockfile, run JavaScript tests, emulator access tests and a frontend build before releases. Check the Rust shell on Windows. Test a deployment with fictional data and two approved accounts before introducing real client records. Keep Firebase project administration, backups and operator onboarding with the agency administrator.
