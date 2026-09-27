<p align="center"><img src="docs/images/icon.svg" width="76" alt="DomusMatchAI"></p>

# DomusMatchAI

**A simple workspace for matching people with properties.**

Originally built for a private real-estate agency with **three branches**, DomusMatchAI brings client requests, available properties and explainable matching into one shared workspace. This repository is a cleaned, independently configured edition of that application, with fictional demo data.

The interface is in Italian. The scope is intentionally small: help agency staff keep track of requests and find relevant properties without a complicated CRM workflow.

![Matching a client request with available properties](docs/images/matching.png)

*Actual application screenshot, using the included fictional demo. Scores come from the matching engine.*

## What it does

- **Client requests:** contacts, budget, surface area, preferred municipalities/neighborhoods, descriptions and internal notes.
- **Property archive:** location, price, size, descriptions and searchable records.
- **Matching in both directions:** find properties for a client or clients for a property, with reasons, missing information and incompatibilities.
- **A shared agency workspace:** Firebase Authentication and Firestore keep authorized operators connected to the same records.
- **Practical follow-up:** copy a suggested message for manual review, and export clients, properties and current matches to an Excel-compatible XML workbook.
- **Windows desktop or browser:** a small Tauri shell around the same JavaScript interface.

### Where the “AI” fits

The current matching engine runs **locally**, using Italian text extraction, structured fields and weighted rules. It needs **no LLM, API key for AI or paid model service**. Firebase is only needed for the shared, authenticated workspace.

Every score comes with explanations. Missing information earns no matching credit and is shown separately from an explicit mismatch. “Criteria coverage” indicates how many evaluated criteria have known information; it is not a probability or statistical confidence. Read the [matching rules and limitations](docs/matching.md).

## Try the demo

Requires **Node.js 22+** and npm. No Firebase account, Rust or credentials required.

```bash
git clone https://github.com/DavideWasTaken/DomusMatchAI.git
cd DomusMatchAI
npm ci
npm run demo
```

Open **http://127.0.0.1:5173**. The demo contains fictional clients and properties, uses the real matching engine, and allows editing records. Changes live in memory and reset when the page reloads. Demo mode never initializes Firebase and does not send property or client data to external services.

## Connect your agency to Firebase

Follow the [Firebase setup guide](docs/firebase.md) to create a project, enable email/password sign-in, deploy the included access rules and approve operators.

```bash
# Copy .env.example to .env and fill in your Firebase Web App configuration.
npm run dev
```

Each installation connects to **one agency's Firebase project**. Operators share the same archive across branches. The project does not implement separate branch permissions or multi-tenant SaaS accounts.

> Creating an Authentication user is not enough: that user's UID must also have a `members/{uid}` document with `active: true`. Membership is managed in the Firebase console, never by ordinary application users.

## A quick look

### Collect the request

![Client requests and searchable archive](docs/images/clients.png)

### Keep the property archive current

![Property details and archive](docs/images/properties.png)

All screenshots use the repository's demo fixtures. [Screenshot provenance](docs/images/README.md).

## Desktop development

Windows desktop development also requires Rust, Microsoft C++ Build Tools and WebView2. Follow the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) first.

```bash
npm run desktop:dev
npm run build
```

`npm run build` creates a Windows MSI under `src-tauri/target/release/bundle/msi/`. Configure `.env` **before building**: the Firebase Web App configuration is embedded in the frontend. Installers are not code-signed by this project. A ready-made installer is not included because each agency uses its own Firebase configuration.

The public edition has its own application identifier and does not import or connect to the original agency's installation.

## Development and checks

| Command | Purpose |
| --- | --- |
| `npm run demo` | Editable in-memory demo with fictional records |
| `npm run dev` | Browser development using your Firebase project |
| `npm test` | Matching and demo/session regression tests |
| `npm run test:rules` | Firestore access tests in the local emulator; requires Java 21+ |
| `npm run build:frontend` | Build the Firebase-enabled frontend |
| `npm run build:demo` | Build the standalone demo frontend |
| `npm run preview` | Preview the last frontend build locally |
| `npm run desktop:dev` | Run the Tauri desktop shell |
| `npm run build` | Build the configured Windows desktop installer |

CI checks JavaScript tests, Firestore rules, frontend builds and the Windows Rust shell. Rules tests use the `demo-domusmatchai` emulator project and require no production credentials.

## Architecture and scope

```mermaid
flowchart LR
    UI[Italian interface] --> Match[Local matching rules]
    UI --> Adapter[Data adapter]
    Adapter --> Demo[Fictional in-memory demo]
    Adapter --> Auth[Firebase Authentication]
    Adapter --> Store[Shared Firestore archive]
    Rules[Active operator membership] --> Store
    Tauri[Windows Tauri shell] --> UI
```

**Stack:** JavaScript, Vite, Firebase and Tauri/Rust. No separate application server or AI inference service is needed.

This is a small agency tool. It has no portal scraping, automatic messages, property valuation, appointment calendar or complete audit history. Concurrent edits to the same record use last-write-wins. Online access is required to establish an authorized shared-data session; the public edition uses memory-only record caching. Locations are entered manually.

See [architecture and operational limits](docs/architecture.md), [Firebase setup](docs/firebase.md) and [matching details](docs/matching.md).

## Author and license

Built by [Davide Gaglione](https://davide.sh). Released under the [MIT license](LICENSE).
