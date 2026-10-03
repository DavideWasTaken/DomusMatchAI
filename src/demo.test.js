import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { createDemoAdapter } from "./demo.js";
import { scoreMatch } from "./matching.js";

function uiContext(extra = {}) {
  // Exercise the actual UI functions without starting a browser or a backend.
  const source = readFileSync(new URL("./main.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\s*/gm, "")
    .split("start().catch(")[0];
  const context = createContext({
    window: {}, document: { querySelector: () => ({}), addEventListener() {} },
    localScoreMatch: scoreMatch, console, ...extra
  });
  runInContext(source, context);
  return context;
}

test("copy helpers and archive badges recompute current matching instead of stale saved scores", async () => {
  const demo = createDemoAdapter();
  const clients = await demo.storage.list("clients");
  const properties = await demo.storage.list("properties");
  const context = uiContext({ clients, properties });
  runInContext(`state.clients = clients; state.properties = properties;
    state.matches = [{id: clients[0].id + "|" + properties[2].id,
      clientId: clients[0].id, propertyId: properties[2].id, score: 99}];`, context);
  const hydrated = runInContext("hydratedMatch(state.matches[0].id)", context);
  assert.ok(hydrated.score < 45);
  assert.equal(runInContext("bestScoreForProperty(properties[2].id)", context), Math.max(...clients.map(c => scoreMatch(c, properties[2], { budgetTolerance: 7 }).score)));
  runInContext("state.properties = []", context);
  assert.equal(runInContext("hydratedMatch(state.matches[0].id)", context), null);
});

test("an in-flight cache refresh cannot restore records after the session is cleared", async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const context = uiContext({ storage: { list: async () => { await waiting; return [{ id: "late-client", name: "Late" }]; } } });
  runInContext("state.user = {uid: 'first-session'}", context);
  const refresh = runInContext("refreshFromCache()", context);
  runInContext("clearSessionData()", context);
  release();
  await refresh;
  assert.equal(runInContext("state.clients.length", context), 0);
  assert.equal(runInContext("state.selectedClientId", context), "");
});

test("demo starts with fictional data and real matching distinguishes suitable properties", async () => {
  const demo = createDemoAdapter();
  assert.equal(demo.demoMode, true);
  const clients = await demo.storage.list("clients");
  const properties = await demo.storage.list("properties");
  assert.ok(clients.length >= 3 && properties.length >= 3);
  assert.ok(clients.every(c => c.email.endsWith("@example.com") && !/\d/.test(c.phone)));
  const strong = scoreMatch(clients[0], properties[0]);
  const weak = scoreMatch(clients[0], properties[2]);
  assert.ok(strong.score >= 70, `Suitable sample scored ${strong.score}`);
  assert.ok(weak.score < 45, `Poor sample scored ${weak.score}`);
});

test("demo creates, edits and deletes records, notifying active subscribers", async () => {
  const demo = createDemoAdapter();
  const changes = [];
  demo.subscribe((kind, error) => changes.push([kind, error]));
  assert.deepEqual(changes.map(([kind]) => kind), ["clients", "properties", "matches"]);
  const saved = await demo.storage.save("clients", { name: "Cliente di prova", comuni: ["Milano"] });
  assert.ok(saved.id && saved.updatedAt);
  saved.comuni.push("Torino");
  const edited = await demo.storage.save("clients", { ...saved, name: "Cliente aggiornato" });
  assert.equal(edited.id, saved.id);
  assert.equal((await demo.storage.list("clients")).find(c => c.id === saved.id).name, "Cliente aggiornato");
  await demo.storage.remove("clients", saved.id);
  assert.ok(!(await demo.storage.list("clients")).some(c => c.id === saved.id));
  assert.deepEqual(changes.slice(3).map(([kind]) => kind), ["clients", "clients", "clients"]);
  demo.stop();
  await demo.storage.save("matches", { id: "demo-result", score: 80 });
  assert.equal(changes.length, 6);
});

test("demo copies cannot mutate stored data and fresh sessions reset changes", async () => {
  const demo = createDemoAdapter();
  const rows = await demo.storage.list("clients");
  const initialName = rows[0].name;
  rows[0].name = "Mutated";
  rows[0].comuni.push("Unexpected");
  const freshRows = await demo.storage.list("clients");
  assert.equal(freshRows[0].name, initialName);
  assert.ok(!freshRows[0].comuni.includes("Unexpected"));
  await demo.storage.remove("clients", rows[0].id);
  assert.ok((await createDemoAdapter().storage.list("clients")).some(c => c.id === rows[0].id));
});

test("demo authentication notifies observers and unsubscribes cleanly", async () => {
  const demo = createDemoAdapter();
  await demo.initFirebase();
  const users = [];
  const unwatch = demo.watchAuth(user => users.push(user));
  assert.equal(users[0].email, "demo@example.com");
  await demo.logout();
  assert.equal(users.at(-1), null);
  await assert.rejects(demo.storage.save("clients", { name: "Signed out" }), /demo/i);
  await demo.login();
  assert.equal(users.at(-1).email, "demo@example.com");
  unwatch();
  await demo.logout();
  assert.equal(users.length, 3);
  await assert.rejects(demo.storage.list("unknown"), /collection/i);
});

test("demo deletion removes linked matches while preserving unrelated records", async () => {
  const demo = createDemoAdapter();
  const clients = await demo.storage.list("clients");
  const properties = await demo.storage.list("properties");
  await demo.storage.save("matches", { id: "linked", clientId: clients[0].id, propertyId: properties[0].id });
  await demo.storage.save("matches", { id: "unrelated", clientId: clients[1].id, propertyId: properties[1].id });
  await demo.storage.remove("clients", clients[0].id);
  assert.deepEqual((await demo.storage.list("matches")).map(row => row.id), ["unrelated"]);
  assert.equal((await demo.storage.list("properties")).length, properties.length);
  await demo.storage.remove("properties", properties[1].id);
  assert.equal((await demo.storage.list("matches")).length, 0);
});

async function deletionContext(confirm) {
  const listeners = {};
  const demo = createDemoAdapter();
  const context = uiContext({
    window: { confirm }, storage: demo.storage,
    document: { querySelector: () => ({}), addEventListener(type, callback) { listeners[type] = callback; } }
  });
  runInContext("state.user = {uid: 'demo-operator'}; renderShell = () => {}; toast = () => {};", context);
  await runInContext("refreshFromCache()", context);
  const id = (await demo.storage.list("clients"))[0].id;
  const click = () => listeners.click({ target: { closest(selector) {
    return selector === "[data-delete-client]" ? { dataset: { deleteClient: id } } : null;
  } } });
  return { demo, context, click, id };
}

test("canceling deletion confirmation keeps the client", async () => {
  let asked = false;
  const { demo, click, id } = await deletionContext(() => { asked = true; return false; });
  await click();
  assert.equal(asked, true);
  assert.ok((await demo.storage.list("clients")).some(client => client.id === id));
});

test("an accepted deletion cannot run after its session changes", async () => {
  let context;
  const result = await deletionContext(() => {
    runInContext("clearSessionData(); state.user = null", context);
    return true;
  });
  context = result.context;
  await result.click();
  assert.ok((await result.demo.storage.list("clients")).some(client => client.id === result.id));
});

test("partial cleanup stops ordinary updates and keeps Retry until recovery", async () => {
  const demo = createDemoAdapter();
  const listeners = {};
  let listening = true;
  let stops = 0;
  let retries = 0;
  const partial = Object.assign(new Error("Record eliminato. Pulizia interrotta: usa Riprova."), { code: "partial-cleanup" });
  const context = uiContext({
    window: { confirm: () => true },
    storage: { ...demo.storage, async remove(kind, id) {
      await demo.storage.remove(kind, id);
      throw partial;
    } },
    stop() { listening = false; stops++; },
    subscribe(callback) { listening = true; retries++; callback("clients", null); },
    document: { querySelector: () => ({}), addEventListener(type, callback) { listeners[type] = callback; } }
  });
  runInContext("state.user = {uid: 'demo-operator'}; state.dataLoaded = true; renderShell = () => {}; toast = () => {};", context);
  await runInContext("refreshFromCache()", context);
  const id = (await demo.storage.list("clients"))[0].id;
  await listeners.click({ target: { closest(selector) {
    return selector === "[data-delete-client]" ? { dataset: { deleteClient: id } } : null;
  } } });
  assert.equal(runInContext("state.dataError", context), partial.message);
  // A successful unrelated update must not dismiss an unresolved cleanup.
  if (listening) runInContext("handleDataChange('properties', null)", context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runInContext("state.dataError", context), partial.message);
  assert.equal(stops, 1);
  assert.match(runInContext("renderDataError()", context), /retry-load/);
  await listeners.click({ target: { closest(selector) {
    return selector === "[data-action]" ? { dataset: { action: "retry-load" } } : null;
  } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(retries, 1);
  assert.equal(runInContext("state.dataError", context), null);
  assert.equal(runInContext("state.dataLoaded", context), true);
  assert.ok(!runInContext("state.clients", context).some(client => client.id === id));
});

test("an already accepted refresh cannot erase a later partial-cleanup error", async () => {
  const demo = createDemoAdapter();
  const listeners = {};
  const partial = Object.assign(new Error("Record eliminato. Usa Riprova."), { code: "partial-cleanup" });
  const context = uiContext({
    window: { confirm: () => true }, stop() {},
    storage: { ...demo.storage, async remove(kind, id) {
      await demo.storage.remove(kind, id);
      runInContext("handleDataChange('properties', null)", context);
      // Let refreshFromCache accept this generation before its UI continuation.
      await Promise.resolve();
      await Promise.resolve();
      throw partial;
    } },
    document: { querySelector: () => ({}), addEventListener(type, callback) { listeners[type] = callback; } }
  });
  runInContext("state.user = {uid: 'demo-operator'}; state.dataLoaded = true; renderShell = () => {}; toast = () => {};", context);
  await runInContext("refreshFromCache()", context);
  const id = (await demo.storage.list("clients"))[0].id;
  await listeners.click({ target: { closest(selector) {
    return selector === "[data-delete-client]" ? { dataset: { deleteClient: id } } : null;
  } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runInContext("state.dataError", context), partial.message);
  assert.equal(runInContext("state.dataLoaded", context), false);
});

test("a rejected refresh from an old session cannot clear the new session", async () => {
  let reject;
  const waiting = new Promise((_resolve, fail) => { reject = fail; });
  const context = uiContext({ stop() {}, storage: { list: () => waiting } });
  runInContext(`state.user = {uid: 'old'}; renderShell = () => {};
    handleDataChange('clients', null); clearSessionData();
    state.user = {uid: 'new'}; state.dataLoaded = true;
    state.clients = [{id: 'new-client'}];`, context);
  reject(new Error("Old connection failed"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runInContext("state.dataError", context), null);
  assert.equal(runInContext("state.dataLoaded", context), true);
  assert.equal(runInContext("state.clients[0]?.id", context), "new-client");
});
