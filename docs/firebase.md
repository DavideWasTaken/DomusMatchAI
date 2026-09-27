# Connect DomusMatchAI to Firebase

This guide sets up **one shared agency workspace**, suitable for operators in several branches. Every approved operator can read and edit the same clients, properties and matches. There is no branch-level isolation or public sign-up flow.

The demo (`npm run demo`) does not need any of these steps. Use a new Firebase project for your own installation; the public repository includes no original agency configuration or records.

## 1. Create the project and database

1. Open the [Firebase console](https://console.firebase.google.com/) and create a project.
2. Create a **Cloud Firestore** database, using the default database ID and **Standard edition**. Start in production/locked mode, not open test mode.
3. Choose a region appropriate for the organization before provisioning the database. Review its data handling requirements and Firebase's current pricing/quotas for your use case.
4. Under **Authentication → Sign-in method**, enable **Email/Password**. Email-link authentication is not used by this app.

Official references: [create a Firestore database](https://firebase.google.com/docs/firestore/quickstart), [email/password authentication](https://firebase.google.com/docs/auth/web/password-auth).

## 2. Register the frontend

Under **Project settings → General → Your apps**, register a **Web app**. Copy the Firebase configuration values into a local `.env` file made from `.env.example`:

```dotenv
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

Use the values shown by your console; do not guess the storage domain. Storage and messaging are not used by the current application. The required configuration checks are API key, auth domain, project ID and app ID.

Firebase Web App configuration is designed to be included in a client bundle. **Authorization comes from Authentication and Security Rules**, not from hiding that configuration. Never put an Admin SDK service-account JSON, private key or server secret into any `VITE_*` variable. These variables are embedded at build time. [Firebase configuration reference](https://firebase.google.com/docs/web/learn-more#config-object).

Keep `.env` out of Git. Restart Vite after editing it; rebuild desktop installers after changing projects.

## 3. Deploy the included rules

In **Firestore Database → Rules**, replace the existing rules with the contents of [`firestore.rules`](../firestore.rules) and click **Publish**. Alternatively, from the project directory:

```bash
npx firebase login
npx firebase deploy --only firestore:rules --project YOUR_PROJECT_ID
```

Deploy only to a project you manage. The repository intentionally contains no default production project alias.

The rules:

- Deny agency-data access to signed-out users and unapproved/revoked operators.
- Allow active members to read, create, update and delete records in `clients`, `properties` and `matches`.
- Require saved records to include the current operator's `updatedBy` UID and an `updatedAt` string, which the adapter adds.
- Allow a signed-in user to read only their own membership document, so the app can react to access changes.
- Deny membership listing and all client-side membership writes, and deny unrelated collections.

The metadata is useful attribution, not a tamper-proof audit log; `updatedAt` is supplied by the client. The rules do not validate every business field. [Official rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions).

## 4. Create and approve each operator

For each staff member:

1. **Authentication → Users → Add user:** create an email/password account. Give each operator their own account.
2. Copy the resulting **User UID**.
3. In Firestore, create collection **`members`** if it does not exist.
4. Create a document whose ID is **exactly that UID**.
5. Add field **`active`**, type **boolean**, value **`true`**.

```text
members
└── the-authentication-user-uid
    └── active: true    (boolean, not the string "true")
```

An Authentication account without this document cannot access agency records, even if somebody creates an account directly through Firebase's APIs. Ordinary operators cannot approve themselves.

To revoke access, set `active` to **false** (or remove the membership document). Also disable the Authentication account when appropriate. Membership changes cause the application to clear its visible records after the server reports the change. Data already viewed or exported cannot be recalled; revocation is not a remote device wipe.

## 5. Start and verify

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**, sign in with an approved account and create a **fictional test record**. Open a second browser/device with another approved operator and verify that the record appears there. Remove the test record when finished.

Check that an unapproved account cannot read the archive. Do not weaken the rules to resolve a permission error: check project ID, UID spelling and the boolean membership field instead.

For a hosted browser deployment, configure HTTPS and review **Authentication → Settings → Authorized domains**. Add your actual hosting domain when required by the authentication flow. Never include credentials in URLs.

## 6. Build for the three branches

Once the same Firebase project works in browser development:

```bash
npm run desktop:dev
npm run build
```

Distribute the resulting configured installer to staff devices. Each person signs in with their own approved account. All branches share the same database; records do not have branch ownership or separate branch permissions.

The public application's identifier is `com.davidewastaken.domusmatchai`. It has no automatic migration from private customer builds and does not read their local SQLite files.

## Data, sessions and simultaneous edits

- Collections are `clients`, `properties`, `matches` and `members`. The first three are created when data is first saved.
- Matching text is processed locally. Records are still synchronized to **your** Firebase project, so client contact details and internal notes are cloud data in normal mode.
- Authentication uses browser-session persistence. Firestore record caching is in memory, not a persistent browser database. Initial data display waits for server-confirmed membership and snapshots.
- Use an online connection for shared work. When disconnected, already displayed records can be stale and writes may await reconnection; offline startup and durable offline work are not supported.
- Edits replace the record: if two operators change the same item concurrently, **the last accepted write wins**. There is no merge UI, version conflict handling or full audit history.
- Exported spreadsheets contain the records shown to the operator. Handle and store them accordingly. Arrange backups separately; an application export is not an automatic backup policy.

This public edition does not silently enable persistent storage of personal data. Firebase documents the implications of disk caching in its [offline data guide](https://firebase.google.com/docs/firestore/manage-data/enable-offline).

## Local access-rule tests

Install Java **21+**, ensure `java -version` selects it, then:

```bash
npm run test:rules
```

The command starts Firestore on `127.0.0.1:8085`, loads the included rules, tests fictional accounts/records, and shuts the emulator down. It uses `demo-domusmatchai`; no Firebase login or real project is needed. Intentional `PERMISSION_DENIED` logs are expected for denial tests. [Firebase emulator guidance](https://firebase.google.com/docs/emulator-suite/connect_firestore).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing configuration screen | All required `.env` values are filled; restart or rebuild |
| Login fails | Email/password provider enabled; correct project and account |
| Access not enabled | `members/{UID}.active` exists and is boolean `true` |
| Permission denied on save | Correct rules deployed; use this edition's adapter, which adds write metadata |
| Blank archive after login | Internet access and Firestore availability; initial reads wait for the server |
| Different records on another device | Both builds point to the same Firebase project |
| Changes overwritten | Concurrent edits use last-write-wins; coordinate edits on the same record |
| Emulator rejects Java | Put Java 21+ first on PATH, or configure JAVA_HOME |
