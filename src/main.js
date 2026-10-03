import "./styles.css";
import { featuresFor as localFeaturesFor, scoreMatch as localScoreMatch } from "./matching.js";
import {
  firebaseConfigured,
  initFirebase,
  watchAuth,
  login,
  logout,
  subscribe,
  stop,
  storage,
  demoMode
} from "./data.js";

const FALLBACK_APP_VERSION = "1.0.0";

let invoke = window.__TAURI__?.core?.invoke || null;

function getInvoke() {
  if (invoke) return invoke;
  invoke = window.__TAURI__?.core?.invoke || null;
  return invoke;
}

async function waitForInvoke(timeoutMs = 1200) {
  const started = Date.now();
  while (!getInvoke() && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return getInvoke();
}

// Storage and authentication use the explicitly selected adapter.
// Tauri invocation is used only for the application version.

const state = {
  view: "clients",
  clients: [],
  properties: [],
  matches: [],
  matchMode: "property",
  visibleCount: 5,
  clientSearch: "",
  propertySearch: "",
  clientSort: "createdDesc",
  propertySort: "createdDesc",
  clientVisibleCount: 10,
  propertyVisibleCount: 10,
  selectedClientId: "",
  selectedPropertyId: "",
  editingClientId: null,
  editingPropertyId: null,
  filters: {
    budgetTolerance: 7
  },
  appVersion: FALLBACK_APP_VERSION,
  dataError: null,
  authReady: false,
  user: null,
  loginError: "",
  loginBusy: false,
  accountOpen: false,
  dataLoaded: false
};

const titles = {
  clients: ["Clienti", "Gestione richieste e preferenze di acquisto."],
  properties: ["Immobili", "Portafoglio e caratteristiche degli appartamenti."],
  matches: ["Match", "Graduatoria degli immobili più coerenti con ogni richiesta."]
};

const clientSources = [
  ["agenzia", "Agenzia"],
  ["telefono", "Telefono"],
  ["sito", "Sito"],
  ["passaparola", "Passaparola"],
  ["immobiliare_it", "Immobiliare.it"],
  ["idealista_it", "Idealista.it"],
  ["casa_it", "Casa.it"],
  ["conoscente", "Conoscente/Amico"],
  ["altro", "Altro"]
];

const sortOptions = [
  ["createdDesc", "Inserimento recente"],
  ["createdAsc", "Inserimento vecchio"],
  ["alphaAsc", "Alfabetico A-Z"],
  ["alphaDesc", "Alfabetico Z-A"]
];

const app = document.querySelector("#app");

function icon(name) {
  const paths = {
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    home: "M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10.5z",
    match: "M7 7h10 M7 17h10 M5 12h14 M17 7l3 3-3 3 M7 17l-3-3 3-3",
    save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8",
    trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6"
  };
  return `<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]}"/></svg>`;
}

let activeSearchField = null;
let draftComuneInput = null;
let draftComuni = null;
let draftQuartiereInput = null;
let draftQuartieri = null;
let draftClientForm = null;
let draftPropertyForm = null;

function normalizeZoneText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clearClientLocationDrafts() {
  draftComuneInput = null;
  draftComuni = null;
  draftQuartiereInput = null;
  draftQuartieri = null;
}

function uniqueLocationList(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const label = String(value || "").trim();
    const key = normalizeZoneText(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function currentComuni() {
  if (draftComuni !== null) return draftComuni;
  const current = state.clients.find((c) => c.id === state.editingClientId);
  return uniqueLocationList([...(Array.isArray(current?.comuni) ? current.comuni : []), current?.comune || ""]);
}

function addComuneDraft(name) {
  draftComuni = uniqueLocationList([...currentComuni(), name]);
  draftComuneInput = "";
}

function addQuartiereDraft(name) {
  draftQuartieri = uniqueLocationList([...currentQuartieri(), name]);
  draftQuartiereInput = "";
}

function renderClientLocationFieldsInPlace() {
  const comuniEl = document.querySelector("[data-comuni-field]");
  const quartieriEl = document.querySelector("[data-quartieri-field]");
  if (comuniEl) comuniEl.outerHTML = comuniField();
  if (quartieriEl) quartieriEl.outerHTML = quartieriField();
  restoreSearchFocus();
}

function currentQuartieri() {
  if (draftQuartieri !== null) return draftQuartieri;
  const current = state.clients.find((c) => c.id === state.editingClientId);
  return Array.isArray(current?.quartieri) ? current.quartieri.slice() : [];
}

function draftForRecord(draft, id) {
  if (!draft) return null;
  return String(draft.id || "") === String(id || "") ? draft : null;
}

function draftValue(draft, current, key, fallback = "") {
  if (draft && Object.prototype.hasOwnProperty.call(draft, key)) return draft[key] ?? "";
  return current?.[key] ?? fallback;
}

function syncFormDraft(form) {
  if (!form) return;
  if (form.id === "clientForm") draftClientForm = formData(form);
  if (form.id === "propertyForm") draftPropertyForm = formData(form);
}

function syncFormDraftFromTarget(target) {
  const form = target?.closest?.("form")
    || (state.view === "clients" ? document.querySelector("#clientForm") : null)
    || (state.view === "properties" ? document.querySelector("#propertyForm") : null);
  syncFormDraft(form);
}

function clearClientDrafts() {
  draftClientForm = null;
  clearClientLocationDrafts();
}

function clearPropertyDrafts() {
  draftPropertyForm = null;
}

function recordInsertTime(record = {}) {
  const raw = record.createdAt || record.insertedAt || record.updatedAt || "";
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function compareAlpha(left, right, getLabel) {
  return String(getLabel(left) || "").localeCompare(String(getLabel(right) || ""), "it", {
    sensitivity: "base",
    numeric: true
  });
}

function sortRecords(rows, sortKey, getLabel) {
  return [...rows].sort((a, b) => {
    if (sortKey === "alphaAsc") return compareAlpha(a, b, getLabel) || (recordInsertTime(b) - recordInsertTime(a));
    if (sortKey === "alphaDesc") return compareAlpha(b, a, getLabel) || (recordInsertTime(b) - recordInsertTime(a));
    if (sortKey === "createdAsc") return (recordInsertTime(a) - recordInsertTime(b)) || compareAlpha(a, b, getLabel);
    return (recordInsertTime(b) - recordInsertTime(a)) || compareAlpha(a, b, getLabel);
  });
}

function sortControl(name, value) {
  return `
    <select class="select sort-select" name="${name}" aria-label="Ordinamento">
      ${sortOptions.map(([id, text]) => `<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(text)}</option>`).join("")}
    </select>
  `;
}

function comuniField() {
  const list = currentComuni();
  const inputValue = draftComuneInput !== null ? draftComuneInput : "";
  const chips = list.map((comune, i) => `
    <span class="chip ok">
      ${esc(comune)}
      <button type="button" class="chip-remove" data-comune-remove="${i}" aria-label="rimuovi comune">&times;</button>
    </span>
  `).join("");
  return `
    <div class="field field-autocomplete" data-comuni-field>
      <label>Comuni di ricerca</label>
      ${list.length ? `<div class="chips compact">${chips}</div>` : ""}
      <div class="manual-location-row">
        <input class="input" name="comuneInput" type="text" value="${esc(inputValue)}" placeholder="Scrivi un comune" autocomplete="off" aria-label="Comune da aggiungere">
        <button class="btn" type="button" data-action="add-comune">Aggiungi</button>
      </div>
      <small class="panel-subtitle">Scrivi e premi Invio o Aggiungi. Inserimento manuale.</small>
    </div>
  `;
}

function quartieriField() {
  const list = currentQuartieri();
  const inputValue = draftQuartiereInput !== null ? draftQuartiereInput : "";
  const chips = list.map((q, i) => `
    <span class="chip">
      ${esc(q)}
      <button type="button" data-quartiere-remove="${i}" aria-label="rimuovi" style="margin-left:4px;background:none;border:none;cursor:pointer;color:inherit;font-size:14px;line-height:1;padding:0">×</button>
    </span>
  `).join("");
  return `
    <div class="field field-autocomplete" data-quartieri-field>
      <label>Quartieri preferiti</label>
      ${list.length ? `<div class="chips compact">${chips}</div>` : ""}
      <div class="manual-location-row">
        <input class="input" name="quartiereInput" type="text" value="${esc(inputValue)}" placeholder="Scrivi un quartiere" autocomplete="off" aria-label="Quartiere da aggiungere">
        <button class="btn" type="button" data-action="add-quartiere">Aggiungi</button>
      </div>
    </div>
  `;
}

function addressField(current = {}) {
  const draft = draftForRecord(draftPropertyForm, current.id);
  return `
    ${field("Indirizzo", "address", draftValue(draft, current, "address"), "Via e civico", true)}
    <div class="form-grid">
      ${field("Comune", "comune", draftValue(draft, current, "comune"), "Comune")}
      ${field("Quartiere", "quartiere", draftValue(draft, current, "quartiere"), "Quartiere")}
    </div>
    <div class="form-grid">
      ${field("Provincia", "provincia", draftValue(draft, current, "provincia"), "Provincia")}
      ${field("CAP", "cap", draftValue(draft, current, "cap"), "CAP")}
    </div>
    <small class="panel-subtitle">Località inserite manualmente; nessuna ricerca esterna.</small>
  `;
}

function restoreSearchFocus() {
  if (!activeSearchField) return;
  const el = document.querySelector(`[name="${activeSearchField}"]`);
  if (!el) {
    activeSearchField = null;
    return;
  }
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  const len = el.value.length;
  try { el.setSelectionRange(len, len); } catch {}
}

function renderShell() {
  if (!state.authReady) {
    app.innerHTML = `<div class="empty">Avvio…</div>`;
    return;
  }
  if (!state.user) {
    app.innerHTML = renderLogin();
    return;
  }
  const [title, subtitle] = titles[state.view];
  const prevScrolls = Array.from(document.querySelectorAll(".panel-body")).map((el) => el.scrollTop);
  const prevWindowScroll = window.scrollY;
  app.innerHTML = `
    <div class="app-shell">
      <header class="brandbar">
        <div class="brand">
          <div class="brand-mark" aria-label="DomusMatchAI">
            <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="6.5" y="8" width="12" height="12" rx="3.5"/>
              <rect x="13.5" y="12" width="12" height="12" rx="3.5"/>
              <path d="M12 15.2l3 3 6-6"/>
            </svg>
          </div>
          <div>
            <div class="brand-title">DomusMatchAI</div>
            <div class="brand-subtitle">Matching clienti e immobili <span class="app-version">v${esc(state.appVersion)}</span></div>
          </div>
        </div>
        <nav class="nav">
          ${navButton("clients", "users", "Clienti")}
          ${navButton("properties", "home", "Immobili")}
          ${navButton("matches", "match", "Match")}
        </nav>
        <div class="brandbar-actions">
          <button class="btn server-button connected" data-action="account-settings">
            <span class="status-dot"></span>
            ${esc(state.user?.email || "Account")}
          </button>
          <button class="btn" data-action="export-excel">Esporta Excel</button>
        </div>
      </header>
      ${demoMode ? `<div class="demo-banner" role="status"><strong>Demo · dati fittizi</strong><span>Le modifiche restano in questa sessione e si azzerano ricaricando la pagina.</span></div>` : ""}
      <main class="main">
        <header class="topbar">
          <div>
            <h1 class="page-title">${title}</h1>
            <div class="page-subtitle">${subtitle}</div>
          </div>
        </header>
        <section class="content">
          ${state.dataError ? renderDataError() : renderView()}
        </section>
      </main>
    </div>
    ${renderAccountModal()}
    <div id="toast" class="toast hidden"></div>
  `;
  const newPanels = document.querySelectorAll(".panel-body");
  const applyScroll = () => {
    prevScrolls.forEach((top, i) => {
      if (newPanels[i]) newPanels[i].scrollTop = top;
    });
    window.scrollTo(0, prevWindowScroll);
  };
  applyScroll();
  restoreSearchFocus();
  applyScroll();
  requestAnimationFrame(applyScroll);
}

function renderLogin() {
  if (demoMode) return `<div class="login-wrap demo-entry"><section class="panel"><div class="panel-body stack"><h1>DomusMatchAI</h1><strong>Demo · dati fittizi</strong><p>Esplora il matching con esempi inventati. Le modifiche durano fino al ricaricamento della pagina.</p><button class="btn primary" data-action="demo-login">Entra nella demo</button></div></section></div>`;
  return `
    <div class="login-wrap" style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
      <section class="panel" style="max-width:380px;width:100%;">
        <div class="panel-head">
          <div>
            <div class="panel-title">DomusMatchAI</div>
            <div class="panel-subtitle">Accedi alla tua postazione</div>
          </div>
        </div>
        <div class="panel-body">
          <form id="loginForm" class="stack">
            <div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="username" required></div>
            <div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
            ${state.loginError ? `<div class="notice bad">${esc(state.loginError)}</div>` : ""}
            <div class="form-actions"><div></div><button class="btn primary" type="submit" ${state.loginBusy ? "disabled" : ""}>${state.loginBusy ? "Accesso…" : "Accedi"}</button></div>
          </form>
        </div>
      </section>
    </div>
  `;
}

function renderAccountModal() {
  if (!state.accountOpen) return "";
  return `
    <div class="modal-backdrop">
      <section class="server-modal" role="dialog" aria-modal="true" aria-label="Account e dati">
        <div class="modal-head">
          <div>
            <h2>Account e dati</h2>
            <p>${esc(state.user?.email || "")}</p>
          </div>
          <button class="btn icon-button" type="button" data-action="account-close" aria-label="Chiudi">×</button>
        </div>
        <div class="server-form">
          <div class="notice ok">${demoMode ? "Demo con dati fittizi in memoria. Nessun dato viene inviato al cloud." : "Archivio condiviso tra gli operatori autorizzati dell’agenzia."}</div>
          <div class="form-actions server-actions">
            <button class="btn danger" type="button" data-action="logout">Esci</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderDataError() {
  return `
    <section class="panel connection-gate">
      <div class="panel-head">
        <div>
          <div class="panel-title">Errore dati</div>
          <div class="panel-subtitle">Impossibile sincronizzare con il cloud.</div>
        </div>
      </div>
      <div class="panel-body">
        <div class="notice bad">${esc(state.dataError)}</div>
        <div class="form-actions">
          <button class="btn primary" type="button" data-action="retry-load">Riprova</button>
        </div>
      </div>
    </section>
  `;
}

function navButton(view, iconName, label) {
  return `<button class="${state.view === view ? "active" : ""}" data-view="${view}">${icon(iconName)} ${label}</button>`;
}

function renderView() {
  if (state.view === "clients") return renderClients();
  if (state.view === "properties") return renderProperties();
  if (state.view === "matches") return renderMatches();
  return renderClients();
}

function searchableText(...values) {
  return values.filter(Boolean).join(" ").toLowerCase();
}

function filterClients(query) {
  const q = query.trim().toLowerCase();
  if (!q) return state.clients;
  return state.clients.filter((c) => searchableText(c.name, c.phone, c.email, c.comune, ...(c.comuni || []), ...(c.quartieri || []), sqmRangeText(c), c.description, c.notes).includes(q));
}

function filterProperties(query) {
  const q = query.trim().toLowerCase();
  if (!q) return state.properties;
  return state.properties.filter((p) => searchableText(p.title, p.propertyType, p.address, p.comune, p.quartiere, sqmRangeText(p), p.description, p.notes).includes(q));
}

function renderClients() {
  const current = state.clients.find((row) => row.id === state.editingClientId) || {};
  const draft = draftForRecord(draftClientForm, current.id);
  const filtered = sortRecords(filterClients(state.clientSearch), state.clientSort, (client) => client.name);
  const visibleCount = Math.min(state.clientVisibleCount, filtered.length);
  const visibleClients = filtered.slice(0, visibleCount);
  const remainingClients = filtered.length - visibleCount;
  const hasQuery = state.clientSearch.trim().length > 0;
  const budgetMinValue = draft ? (draft.budgetMin || "") : (current.budgetMin ? Math.round(current.budgetMin / 1000) : "");
  const budgetMaxValue = draft ? (draft.budgetMax || "") : (current.budgetMax ? Math.round(current.budgetMax / 1000) : "");
  const sqmMinValue = draft ? (draft.sqmMin || "") : (current.sqmMin || "");
  const sqmMaxValue = draft ? (draft.sqmMax || "") : (current.sqmMax || "");
  return `
    <div class="grid-two">
      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">${current.id ? "Modifica cliente" : "Nuovo cliente"}</div>
            <div class="panel-subtitle">Inserisci la richiesta come la raccogli al telefono o in agenzia.</div>
          </div>
        </div>
        <div class="panel-body">
          <form id="clientForm" class="stack">
            <input type="hidden" name="id" value="${esc(current.id || "")}">
            <div class="form-grid">
              ${field("Nome", "name", draftValue(draft, current, "name"), "Famiglia Rossi", true)}
              ${field("Telefono", "phone", draftValue(draft, current, "phone"), "Telefono del cliente")}
            </div>
            <div class="form-grid">
              ${field("Email", "email", draftValue(draft, current, "email"), "cliente@example.com")}
              ${selectField("Provenienza", "source", draftValue(draft, current, "source", "agenzia") || "agenzia", clientSources)}
            </div>
            ${comuniField()}
            ${quartieriField()}
            <div class="field"><label>Budget (k €)</label>
              <div class="form-grid">
                <input class="input" type="number" name="budgetMin" min="0" step="5" value="${esc(budgetMinValue)}" placeholder="min · es. 380">
                <input class="input" type="number" name="budgetMax" min="0" step="5" value="${esc(budgetMaxValue)}" placeholder="max · es. 450">
              </div>
            </div>
            <div class="field"><label>Metri quadri richiesti (mq)</label>
              <div class="form-grid">
                <input class="input" type="number" name="sqmMin" min="0" step="1" value="${esc(sqmMinValue)}" placeholder="min · es. 80">
                <input class="input" type="number" name="sqmMax" min="0" step="1" value="${esc(sqmMaxValue)}" placeholder="max · es. 110">
              </div>
            </div>
            ${textarea("Richiesta", "description", draftValue(draft, current, "description"), "Trilocale luminoso a Milano Navigli, ascensore obbligatorio, terrazzo abitabile, budget fino a 450.000 euro.", true)}
            ${textarea("Note interne", "notes", draftValue(draft, current, "notes"), "Urgenza, disponibilità visite, preferenze emerse in appuntamento.")}
            <div class="form-actions">
              <div>
                ${current.id ? `<button type="button" class="btn danger" data-delete-client="${current.id}">${icon("trash")} Elimina</button>` : ""}
              </div>
              <div>
                ${current.id ? "" : `<label class="check-row"><input type="checkbox" name="matchNow" ${draft?.matchNow === "on" ? "checked" : ""}> Matcha subito</label>`}
                ${current.id ? `<button type="button" class="btn" data-action="new-client">Nuovo</button>` : ""}
                <button class="btn primary" type="submit">${icon("save")} Salva cliente</button>
              </div>
            </div>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">Archivio clienti</div>
            <div class="panel-subtitle">${hasQuery ? `${filtered.length} di ${state.clients.length} clienti corrispondono a "${esc(state.clientSearch)}"` : `${state.clients.length} richieste in archivio.`}</div>
          </div>
        </div>
        <div class="panel-body">
          <div class="search-row">
            <input class="input search-input" name="clientSearch" type="search" value="${esc(state.clientSearch)}" placeholder="Cerca per nome, email, zona, budget...">
            ${sortControl("clientSort", state.clientSort)}
            ${hasQuery ? `<button type="button" class="btn" data-action="clear-client-search">Pulisci</button>` : ""}
          </div>
          <div class="card-list">
            ${state.clients.length === 0 ? empty("Nessun cliente inserito.") : (visibleClients.length ? visibleClients.map(clientCard).join("") : empty("Nessun cliente corrisponde alla ricerca."))}
          </div>
          ${remainingClients > 0 ? `<button class="btn show-more" data-action="show-more-clients" type="button">Mostra altri ${Math.min(10, remainingClients)} (${remainingClients} rimanenti)</button>` : ""}
        </div>
      </section>
    </div>
  `;
}

function renderProperties() {
  const current = state.properties.find((row) => row.id === state.editingPropertyId) || {};
  const draft = draftForRecord(draftPropertyForm, current.id);
  const filtered = sortRecords(filterProperties(state.propertySearch), state.propertySort, (property) => property.title);
  const visibleCount = Math.min(state.propertyVisibleCount, filtered.length);
  const visibleProperties = filtered.slice(0, visibleCount);
  const remainingProperties = filtered.length - visibleCount;
  const hasQuery = state.propertySearch.trim().length > 0;
  const priceValue = draft ? (draft.price || "") : (current.price ? Math.round(current.price / 1000) : "");
  const sqmMinValue = draft ? (draft.sqmMin || "") : (current.sqmMin || "");
  const sqmMaxValue = draft ? (draft.sqmMax || "") : (current.sqmMax || "");
  return `
    <div class="grid-two">
      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">${current.id ? "Modifica immobile" : "Nuovo immobile"}</div>
            <div class="panel-subtitle">Scheda rapida con descrizione e note utili al confronto.</div>
          </div>
        </div>
        <div class="panel-body">
          <form id="propertyForm" class="stack">
            <input type="hidden" name="id" value="${esc(current.id || "")}">
            ${field("Titolo", "title", draftValue(draft, current, "title"), "Trilocale via Tortona", true)}
            <div class="form-grid">
              ${field("Tipo di immobile", "propertyType", draftValue(draft, current, "propertyType"), "Trilocale, attico, villa, monolocale...")}
              ${numberField("Prezzo immobile (k €)", "price", priceValue, 0, 10000)}
            </div>
            <div class="field"><label>Metri quadri immobile (mq)</label>
              <div class="form-grid">
                <input class="input" type="number" name="sqmMin" min="0" step="1" value="${esc(sqmMinValue)}" placeholder="min · es. 90">
                <input class="input" type="number" name="sqmMax" min="0" step="1" value="${esc(sqmMaxValue)}" placeholder="max · es. 95">
              </div>
            </div>
            ${addressField(draft ? { ...current, address: draft.address ?? current.address } : current)}
            ${textarea("Descrizione immobile", "description", draftValue(draft, current, "description"), "95mq al 3 piano con ascensore, terrazzo abitabile 22mq, box incluso, 439.000 euro.", true)}
            ${textarea("Note interne", "notes", draftValue(draft, current, "notes"), "Chiavi, disponibilità visite, trattabilità prezzo, particolarità.")}
            <div class="form-actions">
              <div>
                ${current.id ? `<button type="button" class="btn danger" data-delete-property="${current.id}">${icon("trash")} Elimina</button>` : ""}
              </div>
              <div>
                ${current.id ? "" : `<label class="check-row"><input type="checkbox" name="matchNow" ${draft?.matchNow === "on" ? "checked" : ""}> Matcha subito</label>`}
                ${current.id ? `<button type="button" class="btn" data-action="new-property">Nuovo</button>` : ""}
                <button class="btn primary" type="submit">${icon("save")} Salva immobile</button>
              </div>
            </div>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">Portafoglio immobili</div>
            <div class="panel-subtitle">${hasQuery ? `${filtered.length} di ${state.properties.length} immobili corrispondono a "${esc(state.propertySearch)}"` : `${state.properties.length} immobili in archivio.`}</div>
          </div>
        </div>
        <div class="panel-body">
          <div class="search-row">
            <input class="input search-input" name="propertySearch" type="search" value="${esc(state.propertySearch)}" placeholder="Cerca per titolo, riferimento, zona...">
            ${sortControl("propertySort", state.propertySort)}
            ${hasQuery ? `<button type="button" class="btn" data-action="clear-property-search">Pulisci</button>` : ""}
          </div>
          <div class="card-list">
            ${state.properties.length === 0 ? empty("Nessun immobile inserito.") : (visibleProperties.length ? visibleProperties.map(propertyCard).join("") : empty("Nessun immobile corrisponde alla ricerca."))}
          </div>
          ${remainingProperties > 0 ? `<button class="btn show-more" data-action="show-more-properties" type="button">Mostra altri ${Math.min(10, remainingProperties)} (${remainingProperties} rimanenti)</button>` : ""}
        </div>
      </section>
    </div>
  `;
}

function renderMatches() {
  const selectedClient = state.clients.find((c) => c.id === state.selectedClientId);
  const selectedProperty = state.properties.find((p) => p.id === state.selectedPropertyId);
  const isClientMode = state.matchMode === "client";
  const allRows = isClientMode
    ? selectedClient
      ? rankedMatchesForClient(selectedClient)
      : []
    : selectedProperty
      ? rankedMatchesForProperty(selectedProperty)
      : [];
  const visibleCount = Math.min(state.visibleCount, allRows.length);
  const rows = allRows.slice(0, visibleCount);
  const remaining = allRows.length - visibleCount;
  return `
    <div class="grid-match">
      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">Motore matching locale</div>
            <div class="panel-subtitle">${isClientMode ? "Parti da un cliente e trova gli immobili migliori." : "Parti da un immobile e trova i clienti più adatti."}</div>
          </div>
        </div>
        <div class="panel-body">
          <div class="filter-grid">
            <div class="mode-switch">
              <button class="${!isClientMode ? "active" : ""}" data-match-mode="property" type="button">Immobile → Clienti</button>
              <button class="${isClientMode ? "active" : ""}" data-match-mode="client" type="button">Cliente → Immobili</button>
            </div>
            ${isClientMode
              ? selectField("Cliente", "matchClient", state.selectedClientId, [["", "Seleziona cliente"], ...state.clients.map((c) => [c.id, c.name])])
              : selectField("Immobile", "matchProperty", state.selectedPropertyId, [["", "Seleziona immobile"], ...state.properties.map((p) => [p.id, p.title])])
            }
            ${numberField("Tolleranza budget (%)", "budgetTolerance", state.filters.budgetTolerance, 0, 30)}
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">${isClientMode ? (selectedClient ? `Immobili per ${esc(selectedClient.name)}` : "Ranking immobili") : (selectedProperty ? `Clienti per ${esc(selectedProperty.title)}` : "Ranking clienti")}</div>
            <div class="panel-subtitle">${(isClientMode ? selectedClient : selectedProperty) ? `Mostrati ${rows.length} di ${allRows.length} risultati` : "Seleziona un punto di partenza per calcolare."}</div>
          </div>
        </div>
        <div class="panel-body">
          <div class="stack">
            ${(isClientMode ? selectedClient : selectedProperty) ? (rows.length ? rows.map((row, index) => matchCard(row, index)).join("") : empty("Nessun risultato disponibile.")) : empty(isClientMode ? "Nessun cliente selezionato." : "Nessun immobile selezionato.")}
            ${remaining > 0 ? `<button class="btn show-more" data-action="show-more-matches" type="button">Mostra altri ${Math.min(5, remaining)} (${remaining} rimanenti)</button>` : (allRows.length > 5 ? `<div class="empty">Tutti i ${allRows.length} risultati sono visualizzati.</div>` : "")}
          </div>
        </div>
      </section>
    </div>
  `;
}

function requiredMark(required) {
  return required ? ' <span style="color:#dc2626" aria-hidden="true">*</span>' : '';
}

function field(label, name, value, placeholder, required = false) {
  return `<div class="field"><label>${label}${requiredMark(required)}</label><input class="input" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}"${required ? ' required' : ''}></div>`;
}

function numberField(label, name, value, min, max) {
  return `<div class="field"><label>${label}</label><input class="input" type="number" name="${name}" value="${esc(value)}" min="${min}" max="${max}"></div>`;
}

function textarea(label, name, value, placeholder, required = false) {
  return `<div class="field"><label>${label}${requiredMark(required)}</label><textarea class="textarea" name="${name}" placeholder="${esc(placeholder)}"${required ? ' required' : ''}>${esc(value)}</textarea></div>`;
}

function selectField(label, name, value, options) {
  return `<div class="field"><label>${label}</label><select class="select" name="${name}">${options.map(([id, text]) => `<option value="${esc(id)}" ${String(id) === String(value) ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></div>`;
}

function empty(text) {
  return `<div class="empty">${text}</div>`;
}

function clientCard(client) {
  const currentMatches = rankedMatchesForClient(client);
  const hasCalculated = currentMatches.length > 0;
  const strong = currentMatches.filter((m) => m.score >= 70).length;
  const badgeLabel = strong
    ? `${strong} forti`
    : hasCalculated
      ? `${countMatches(client.id)} match`
      : "non valutato";
  const comuni = uniqueLocationList([...(Array.isArray(client.comuni) ? client.comuni : []), client.comune || ""]);
  const sqmLine = sqmRangeText(client);
  const hasTags = Boolean(comuni.length || sqmLine);
  return `
    <article class="item-card ${client.id === state.editingClientId ? "selected" : ""}" data-edit-client="${client.id}">
      <div class="item-row">
        <div>
          <div class="item-title">${esc(client.name)}</div>
          <div class="item-meta">${esc([client.phone, client.email].filter(Boolean).join(" · ") || "Nessun contatto")}</div>
        </div>
        <span class="chip clickable ${strong ? "ok" : ""}" data-open-matches-client="${client.id}" title="Apri match per questo cliente">${badgeLabel}</span>
      </div>
      ${hasTags ? `<div class="chips compact">
        ${comuni.map((comune) => `<span class="chip ok">${esc(comune)}</span>`).join("")}
        ${sqmLine ? `<span class="chip">${esc(sqmLine)}</span>` : ""}
      </div>` : ""}
      <div class="item-desc">${esc(client.description)}</div>
      ${client.notes ? `<div class="item-note">${esc(client.notes)}</div>` : ""}
    </article>
  `;
}

function propertySummaryLine(property = {}) {
  const locationLine = [property.comune, property.quartiere].filter(Boolean).join(" · ");
  const priceLine = property.price ? eur(property.price) : "";
  const sqmLine = sqmRangeText(property);
  return [property.propertyType, priceLine, sqmLine, locationLine || property.address].filter(Boolean).join(" · ");
}

function propertyCard(property) {
  const best = bestScoreForProperty(property.id);
  const clientNotes = clientNotesForProperty(property);
  return `
    <article class="item-card ${property.id === state.editingPropertyId ? "selected" : ""}" data-edit-property="${property.id}">
      <div class="item-row">
        <div>
          <div class="item-title">${esc(property.title)}</div>
          <div class="item-meta">${esc(propertySummaryLine(property))}</div>
        </div>
        <span class="chip clickable ${best >= 70 ? "ok" : best >= 40 ? "warn" : ""}" data-open-matches-property="${property.id}" title="Apri match per questo immobile">${best ? `${best}% top` : "non valutato"}</span>
      </div>
      <div class="item-desc">${esc(property.description)}</div>
      ${property.notes ? `<div class="item-note">${esc(property.notes)}</div>` : ""}
      ${clientNotes.length ? `
        <div class="activity-mini">
          <b>Note clienti compatibili</b>
          ${clientNotes.map(({ client, match }) => `
            <div class="activity-row">
              <span><a class="activity-link" data-go-client="${esc(client.id)}">${esc(client.name)}</a> · ${match.score}% match</span>
              <small>${esc(client.notes)}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

function clientNotesForProperty(property) {
  if (!property) return [];
  return state.clients
    .filter((client) => client.notes && client.notes.trim())
    .map((client) => ({
      client,
      match: localScoreMatch(client, property, state.filters)
    }))
    .filter(({ match }) => match.score >= 45)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 3);
}

function matchCard(row, index = 0) {
  const color = row.score >= 70 ? "#067647" : row.score >= 45 ? "#b54708" : "#b42318";
  const isPropertyMode = row.mode === "property" || row.mode === "top";
  const title = isPropertyMode ? row.client.name : row.property.title;
  const subtitle = isPropertyMode
    ? `${row.property.title} · ${[row.client.phone, row.client.email].filter(Boolean).join(" · ")}`
    : propertySummaryLine(row.property) || "Dettagli immobile";
  return `
    <article class="match-card">
      <div class="match-head">
        <div class="rank-badge">#${index + 1}</div>
        <div class="score" style="--score:${row.score};--score-color:${color}"><span>${row.score}</span></div>
        <div>
          <div class="match-title">${esc(title)}</div>
          <div class="match-summary">${esc(row.summary)}</div>
          <div class="chips">
            <span class="chip ${row.score >= 70 ? "ok" : row.score >= 45 ? "warn" : "bad"}">${row.verdict}</span>
            <span class="chip">Copertura criteri ${row.confidence || 0}%</span>
            <span class="chip">${esc(subtitle)}</span>
          </div>
        </div>
      </div>
      <div class="match-insight-grid">
        <div class="insight-box positive">
          <b>Punti forti</b>
          <span>${(row.positives?.length ? row.positives : ["Compatibilita parziale da verificare"]).map(esc).join(" · ")}</span>
        </div>
        <div class="insight-box risk">
          <b>Criticita</b>
          <span>${(row.risks?.length ? row.risks : ["Nessuna criticita forte emersa"]).map(esc).join(" · ")}</span>
        </div>
      </div>
      <div class="reason-grid">
        ${row.reasons.map((r) => `<div class="reason ${r.status === "unknown" ? "unknown" : ""}"><b>${esc(r.criterion)}</b><span>${esc(r.label)}</span></div>`).join("")}
      </div>
      <div class="match-actions">
        <button class="btn" data-action="copy-message" data-match="${esc(row.id)}">Copia messaggio</button>
        <button class="btn" data-action="copy-phone" data-match="${esc(row.id)}">Copia telefono</button>
      </div>
    </article>
  `;
}

async function enhanceItemWithLocalMatching(kind, item) {
  return { ...item, aiFeatures: localFeaturesFor(item), matchingEngine: `local-${kind}` };
}

function rankedMatchesForClient(client) {
  const saved = state.matches.filter((m) => m.clientId === client.id);
  const byProperty = new Map(saved.map((m) => [m.propertyId, m]));
  return state.properties
    .map((property) => {
      const existing = byProperty.get(property.id);
      const recalculated = localScoreMatch(client, property, state.filters);
      return existing ? { ...recalculated, calculatedAt: existing.calculatedAt || recalculated.calculatedAt } : recalculated;
    })
    .sort((a, b) => b.score - a.score);
}

function rankedMatchesForProperty(property) {
  const saved = state.matches.filter((m) => m.propertyId === property.id);
  const byClient = new Map(saved.map((m) => [m.clientId, m]));
  return state.clients
    .map((client) => {
      const existing = byClient.get(client.id);
      const recalculated = localScoreMatch(client, property, state.filters);
      return {
        ...recalculated,
        mode: "property",
        client,
        calculatedAt: existing?.calculatedAt || recalculated.calculatedAt
      };
    })
    .sort((a, b) => b.score - a.score);
}

async function calculateMatches(options = {}) {
  const operationGeneration = sessionGeneration;
  const rows = state.matchMode === "client" ? calculateClientMatches() : calculatePropertyMatches();
  for (const row of rows) {
    if (operationGeneration !== sessionGeneration) return;
    const payload = { ...row };
    delete payload.property;
    delete payload.client;
    delete payload.mode;
    payload._version = state.matches.find((match) => match.id === payload.id)?._version;
    await storage.save("matches", payload);
  }
  await refreshFromCache();
  if (operationGeneration !== sessionGeneration) return;
  if (!options.silent) {
    toast(`${rows.length} match calcolati.`);
    renderShell();
  }
}

async function calculateMatchesAfterSave(mode) {
  state.matchMode = mode;
  state.view = "matches";
  try {
    await calculateMatches({ silent: true });
    renderShell();
    toast(mode === "client" ? "Cliente salvato. Ranking immobili aggiornato." : "Immobile salvato. Ranking clienti aggiornato.");
  } catch (error) {
    console.error("Match calculation after save failed:", error);
    renderShell();
    toast(`${mode === "client" ? "Cliente" : "Immobile"} salvato. Match non aggiornato: ${error?.message || error}`);
  }
}

function calculateClientMatches() {
  const client = state.clients.find((c) => c.id === state.selectedClientId);
  return client ? state.properties.map((property) => localScoreMatch(client, property, state.filters)) : [];
}

function calculatePropertyMatches() {
  const property = state.properties.find((p) => p.id === state.selectedPropertyId);
  return property ? state.clients.map((client) => ({ ...localScoreMatch(client, property, state.filters), mode: "property", client })) : [];
}

function hydratedMatch(id) {
  const saved = state.matches.find((m) => m.id === id);
  const [clientId, propertyId] = String(id || "").split("|");
  const client = state.clients.find((c) => c.id === (saved?.clientId || clientId));
  const property = state.properties.find((p) => p.id === (saved?.propertyId || propertyId));
  return client && property ? { ...localScoreMatch(client, property, state.filters), client, property } : null;
}

async function ensureMatch(id) {
  return hydratedMatch(id);
}

function currentMatches() {
  return state.clients.flatMap(client => state.properties.map(property =>
    ({ ...localScoreMatch(client, property, state.filters), client, property })
  ));
}

function fallbackOutreachMessage(match) {
  const client = state.clients.find((c) => c.id === match.clientId);
  const property = state.properties.find((p) => p.id === match.propertyId) || match.property;
  const name = client?.name?.split(" ")[0] || "Cliente";
  return [
    `Buongiorno ${name},`,
    `abbiamo individuato un immobile coerente con la sua richiesta: ${property?.title || "immobile selezionato"}.`,
    `I punti principali sono: ${match.summary || "caratteristiche compatibili con le preferenze indicate"}.`,
    "Se le interessa, possiamo fissare una visita o sentirci per darle maggiori dettagli.",
    "DomusMatchAI"
  ].join("\n");
}

async function outreachMessage(match) {
  return fallbackOutreachMessage(match);
}

async function exportExcel() {
  const clientsRows = state.clients.map((c) => ({
    nome: c.name,
    telefono: c.phone,
    email: c.email,
    provenienza: sourceText(c.source),
    comuni_ricerca: uniqueLocationList([...(Array.isArray(c.comuni) ? c.comuni : []), c.comune || ""]).join(", "),
    quartieri_ricerca: Array.isArray(c.quartieri) ? c.quartieri.join(", ") : "",
    budget_min: c.budgetMin || "",
    budget_max: c.budgetMax || "",
    mq_min: c.sqmMin || "",
    mq_max: c.sqmMax || "",
    richiesta: c.description,
    note: c.notes
  }));
  const propertiesRows = state.properties.map((p) => ({
    titolo: p.title,
    tipo_immobile: p.propertyType || "",
    prezzo: p.price || "",
    mq_min: p.sqmMin || "",
    mq_max: p.sqmMax || "",
    indirizzo: p.address,
    comune: p.comune || "",
    quartiere: p.quartiere || "",
    descrizione: p.description,
    note: p.notes
  }));
  const matchesRows = currentMatches().map((m) => {
    const client = state.clients.find((c) => c.id === m.clientId);
    const property = state.properties.find((p) => p.id === m.propertyId);
    return {
      cliente: client?.name || "",
      immobile: property?.title || "",
      score: m.score,
      verdetto: m.verdict,
      sintesi: m.summary,
      data_calcolo: m.calculatedAt || ""
    };
  });
  const xml = buildExcelXml([
    { name: "Clienti", rows: clientsRows },
    { name: "Immobili", rows: propertiesRows },
    { name: "Match attuali", rows: matchesRows }
  ]);
  const blob = new Blob(["﻿" + xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DomusMatchAIExport.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  toast("Excel scaricato: 3 fogli (Clienti, Immobili, Match).");
}

function buildExcelXml(sheets) {
  const escXml = (v) => String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const cell = (v) => {
    const isNum = typeof v === "number" && Number.isFinite(v);
    const type = isNum ? "Number" : "String";
    return `<Cell><Data ss:Type="${type}">${escXml(v)}</Data></Cell>`;
  };
  const sheetXml = ({ name, rows }) => {
    if (!rows.length) {
      return `<Worksheet ss:Name="${escXml(name)}"><Table><Row><Cell><Data ss:Type="String">(nessun dato)</Data></Cell></Row></Table></Worksheet>`;
    }
    const headers = Object.keys(rows[0]);
    const headerRow = `<Row>${headers.map((h) => `<Cell><Data ss:Type="String">${escXml(h)}</Data></Cell>`).join("")}</Row>`;
    const dataRows = rows.map((row) => `<Row>${headers.map((h) => cell(row[h])).join("")}</Row>`).join("");
    return `<Worksheet ss:Name="${escXml(name)}"><Table>${headerRow}${dataRows}</Table></Worksheet>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.map(sheetXml).join("")}</Workbook>`;
}

function countMatches(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  return client ? rankedMatchesForClient(client).filter(m => m.score >= 45).length : 0;
}

function bestScoreForProperty(propertyId) {
  const property = state.properties.find(p => p.id === propertyId);
  return property ? Math.max(0, ...rankedMatchesForProperty(property).map(m => m.score)) : 0;
}

function sourceText(source) {
  return Object.fromEntries(clientSources)[source || "agenzia"] || "Agenzia";
}

function eur(n) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function parsePositiveNumber(value) {
  const n = Number(String(value || "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function parseNumberRange(minValue, maxValue) {
  let min = parsePositiveNumber(minValue);
  let max = parsePositiveNumber(maxValue);
  if (min && max && min > max) [min, max] = [max, min];
  return { min, max };
}

function sqmRangeText(item = {}) {
  const min = parsePositiveNumber(item.sqmMin);
  const max = parsePositiveNumber(item.sqmMax);
  const sqm = parsePositiveNumber(item.sqm);
  if (min && max && min === max) return `${min} mq`;
  if (min && max) return `${min}-${max} mq`;
  if (min) return `da ${min} mq`;
  if (max) return `fino a ${max} mq`;
  if (sqm) return `${sqm} mq`;
  return "";
}

function toast(message) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2800);
}

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Email o password non corretti.";
  }
  if (code.includes("invalid-email")) return "Email non valida.";
  if (code.includes("too-many-requests")) return "Troppi tentativi. Riprova tra qualche minuto.";
  if (code.includes("network")) return "Errore di rete: controlla la connessione.";
  return error?.message || "Accesso non riuscito.";
}

function normalizeLegacyProperty(property) {
  const sqmRange = parseNumberRange(property.sqmMin, property.sqmMax);
  return {
    propertyType: "",
    status: "available",
    ...property,
    createdAt: property.createdAt || property.insertedAt || property.updatedAt || null,
    title: (property.title || property.reference || "").trim(),
    reference: property.reference || "",
    sqmMin: sqmRange.min,
    sqmMax: sqmRange.max
  };
}

function normalizeLegacyClient(client) {
  const comuni = uniqueLocationList([...(Array.isArray(client.comuni) ? client.comuni : []), client.comune || ""]);
  const sqmRange = parseNumberRange(client.sqmMin, client.sqmMax);
  return {
    source: "agenzia",
    ...client,
    createdAt: client.createdAt || client.insertedAt || client.updatedAt || null,
    comune: comuni[0] || client.comune || "",
    comuni,
    quartieri: Array.isArray(client.quartieri) ? client.quartieri : [],
    sqmMin: sqmRange.min,
    sqmMax: sqmRange.max
  };
}

function existingClientFromForm(id) {
  return id ? state.clients.find((client) => client.id === id) || {} : {};
}

function existingPropertyFromForm(id) {
  return id ? state.properties.find((property) => property.id === id) || {} : {};
}

let sessionGeneration = 0;
let refreshSequence = 0;

function clearSessionData() {
  sessionGeneration++;
  state.dataLoaded = false;
  state.clients = [];
  state.properties = [];
  state.matches = [];
  state.selectedClientId = "";
  state.selectedPropertyId = "";
  state.editingClientId = null;
  state.editingPropertyId = null;
  state.clientSearch = "";
  state.propertySearch = "";
  state.accountOpen = false;
  activeSearchField = null;
  clearClientDrafts();
  clearPropertyDrafts();
}

async function refreshFromCache() {
  const generation = sessionGeneration;
  const sequence = ++refreshSequence;
  const [clients, properties, matches] = await Promise.all([
    storage.list("clients"), storage.list("properties"), storage.list("matches")
  ]);
  if (generation !== sessionGeneration || sequence !== refreshSequence || !state.user) return false;
  state.clients = clients.map(normalizeLegacyClient);
  state.properties = properties.map(normalizeLegacyProperty);
  state.matches = matches.filter(m => clients.some(c => c.id === m.clientId) && properties.some(p => p.id === m.propertyId));
  if (!state.clients.some(c => c.id === state.selectedClientId)) state.selectedClientId = state.clients[0]?.id || "";
  if (!state.properties.some(p => p.id === state.selectedPropertyId)) state.selectedPropertyId = state.properties[0]?.id || "";
  return true;
}

function handleDataChange(_kind, error) {
  if (error) {
    stop();
    clearSessionData();
    state.dataError = error?.message || String(error);
    renderShell();
    return;
  }
  refreshFromCache().then((accepted) => {
    if (!accepted) return;
    const wasLoaded = state.dataLoaded;
    state.dataLoaded = true;
    state.dataError = null;
    const editing = document.activeElement && document.activeElement.matches
      && document.activeElement.matches("input, textarea, select");
    if (!wasLoaded || (!editing && !state.accountOpen)) renderShell();
  }).catch(error => handleDataChange(_kind, error));
}

async function start() {
  app.innerHTML = `<div class="empty">Avvio…</div>`;
  if (!firebaseConfigured) {
    state.authReady = true;
    app.innerHTML = `<div class="empty">Configurazione Firebase mancante. Crea il file .env (vedi .env.example) e riavvia l'app.</div>`;
    return;
  }
  try {
    await waitForInvoke(800);
    const fn = getInvoke();
    if (fn) {
      try { state.appVersion = await fn("app_version"); } catch (error) { console.error(error); }
    }
  } catch (error) {
    console.error(error);
  }
  await initFirebase();
  watchAuth((user) => {
    clearSessionData();
    state.dataError = null;
    state.user = user || null;
    state.authReady = true;
    if (user) {
      state.loginError = "";
      subscribe(handleDataChange);
    } else {
      stop();
    }
    renderShell();
  });
}

document.addEventListener("click", async (event) => {
  const operationGeneration = sessionGeneration;
  try {
  const comuneRemoveIdx = event.target.closest("[data-comune-remove]")?.dataset.comuneRemove;
  if (comuneRemoveIdx !== undefined) {
    event.preventDefault();
    syncFormDraftFromTarget(event.target);
    const current = currentComuni();
    current.splice(Number(comuneRemoveIdx), 1);
    draftComuni = current;
    activeSearchField = "comuneInput";
    renderClientLocationFieldsInPlace();
    return;
  }
  const quartiereRemoveIdx = event.target.closest("[data-quartiere-remove]")?.dataset.quartiereRemove;
  if (quartiereRemoveIdx !== undefined) {
    event.preventDefault();
    syncFormDraftFromTarget(event.target);
    const current = currentQuartieri();
    current.splice(Number(quartiereRemoveIdx), 1);
    draftQuartieri = current;
    activeSearchField = "quartiereInput";
    renderClientLocationFieldsInPlace();
    return;
  }
  const view = event.target.closest("[data-view]")?.dataset.view;
  if (view) {
    state.view = view;
    clearClientDrafts();
    clearPropertyDrafts();
    renderShell();
    return;
  }
  const goClient = event.target.closest("[data-go-client]")?.dataset.goClient;
  if (goClient) {
    event.preventDefault();
    state.view = "clients";
    state.editingClientId = goClient;
    clearClientDrafts();
    renderShell();
    return;
  }
  const openMatchesClient = event.target.closest("[data-open-matches-client]")?.dataset.openMatchesClient;
  if (openMatchesClient) {
    event.preventDefault();
    state.view = "matches";
    state.matchMode = "client";
    state.selectedClientId = openMatchesClient;
    state.visibleCount = 5;
    renderShell();
    return;
  }
  const openMatchesProperty = event.target.closest("[data-open-matches-property]")?.dataset.openMatchesProperty;
  if (openMatchesProperty) {
    event.preventDefault();
    state.view = "matches";
    state.matchMode = "property";
    state.selectedPropertyId = openMatchesProperty;
    state.visibleCount = 5;
    renderShell();
    return;
  }
  const editClient = event.target.closest("[data-edit-client]")?.dataset.editClient;
  if (editClient) {
    state.editingClientId = editClient;
    clearClientDrafts();
    renderShell();
    return;
  }
  const editProperty = event.target.closest("[data-edit-property]")?.dataset.editProperty;
  if (editProperty) {
    state.editingPropertyId = editProperty;
    clearPropertyDrafts();
    renderShell();
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "demo-login" && demoMode) { await login(); return; }
  if (action === "add-comune" || action === "add-quartiere") {
    syncFormDraftFromTarget(event.target);
    if (action === "add-comune") addComuneDraft(draftComuneInput);
    else addQuartiereDraft(draftQuartiereInput);
    activeSearchField = action === "add-comune" ? "comuneInput" : "quartiereInput";
    renderClientLocationFieldsInPlace();
    return;
  }
  const matchMode = event.target.closest("[data-match-mode]")?.dataset.matchMode;
  if (matchMode) {
    state.matchMode = matchMode;
    state.visibleCount = 5;
    renderShell();
    return;
  }
  if (action === "new-client") {
    state.editingClientId = null;
    clearClientDrafts();
    renderShell();
  }
  if (action === "retry-load") {
    state.dataError = null;
    subscribe(handleDataChange);
    renderShell();
    return;
  }
  if (action === "account-settings") {
    state.accountOpen = true;
    renderShell();
    return;
  }
  if (action === "account-close") {
    state.accountOpen = false;
    renderShell();
    return;
  }
  if (action === "logout") {
    try {
      await logout();
    } catch (error) {
      toast(`Errore uscita: ${error?.message || error}`);
    }
    state.accountOpen = false;
    return;
  }
  if (action === "new-property") {
    state.editingPropertyId = null;
    clearPropertyDrafts();
    renderShell();
  }
  if (action === "show-more-matches") {
    state.visibleCount += 5;
    renderShell();
  }
  if (action === "show-more-clients") {
    state.clientVisibleCount += 10;
    renderShell();
  }
  if (action === "show-more-properties") {
    state.propertyVisibleCount += 10;
    renderShell();
  }
  if (action === "clear-client-search") {
    state.clientSearch = "";
    state.clientVisibleCount = 10;
    activeSearchField = "clientSearch";
    renderShell();
  }
  if (action === "clear-property-search") {
    state.propertySearch = "";
    state.propertyVisibleCount = 10;
    activeSearchField = "propertySearch";
    renderShell();
  }
  if (action === "export-excel") {
    await exportExcel();
  }
  if (action === "copy-message") {
    const id = event.target.closest("[data-match]")?.dataset.match;
    const match = await ensureMatch(id);
    if (!match) return;
    await navigator.clipboard?.writeText(await outreachMessage(match));
    toast("Messaggio copiato.");
  }
  if (action === "copy-phone") {
    const id = event.target.closest("[data-match]")?.dataset.match;
    const [clientId] = String(id || "").split("|");
    const client = state.clients.find((c) => c.id === clientId);
    if (!client?.phone) {
      toast("Nessun telefono per questo cliente.");
      return;
    }
    await navigator.clipboard?.writeText(client.phone);
    toast(`Telefono copiato: ${client.phone}`);
  }
  const deleteClient = event.target.closest("[data-delete-client]")?.dataset.deleteClient;
  if (deleteClient) {
    const row = state.clients.find((client) => client.id === deleteClient);
    if (!row || !window.confirm(`Eliminare il cliente "${row.name}" e i suoi match?`)) return;
    if (operationGeneration !== sessionGeneration) return;
    await storage.remove("clients", deleteClient);
    await refreshFromCache();
    if (operationGeneration !== sessionGeneration) return;
    state.editingClientId = null;
    clearClientDrafts();
    renderShell();
  }
  const deleteProperty = event.target.closest("[data-delete-property]")?.dataset.deleteProperty;
  if (deleteProperty) {
    const row = state.properties.find((property) => property.id === deleteProperty);
    if (!row || !window.confirm(`Eliminare l'immobile "${row.title}" e i suoi match?`)) return;
    if (operationGeneration !== sessionGeneration) return;
    await storage.remove("properties", deleteProperty);
    await refreshFromCache();
    if (operationGeneration !== sessionGeneration) return;
    state.editingPropertyId = null;
    clearPropertyDrafts();
    renderShell();
  }
  } catch (error) {
    if (error?.code === "partial-cleanup" && operationGeneration === sessionGeneration) {
      await refreshFromCache();
      if (operationGeneration !== sessionGeneration) return;
      state.editingClientId = null;
      state.editingPropertyId = null;
      clearClientDrafts();
      clearPropertyDrafts();
      state.dataError = error.message;
      renderShell();
    }
    if (operationGeneration === sessionGeneration) toast(`Operazione non riuscita: ${error?.message || error}`);
  }
});

document.addEventListener("input", (event) => {
  syncFormDraft(event.target.closest("form"));
  if (event.target.name === "clientSearch") {
    state.clientSearch = event.target.value;
    state.clientVisibleCount = 10;
    activeSearchField = "clientSearch";
    renderShell();
  }
  if (event.target.name === "propertySearch") {
    state.propertySearch = event.target.value;
    state.propertyVisibleCount = 10;
    activeSearchField = "propertySearch";
    renderShell();
  }
  if (event.target.name === "comuneInput") draftComuneInput = event.target.value;
  if (event.target.name === "quartiereInput") draftQuartiereInput = event.target.value;
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !["comuneInput", "quartiereInput"].includes(event.target.name)) return;
  event.preventDefault();
  syncFormDraftFromTarget(event.target);
  if (event.target.name === "comuneInput") addComuneDraft(event.target.value);
  else addQuartiereDraft(event.target.value);
  activeSearchField = event.target.name;
  renderClientLocationFieldsInPlace();
});

document.addEventListener("change", (event) => {
  syncFormDraft(event.target.closest("form"));
  if (event.target.name === "clientSort") {
    state.clientSort = event.target.value;
    state.clientVisibleCount = 10;
    renderShell();
  }
  if (event.target.name === "propertySort") {
    state.propertySort = event.target.value;
    state.propertyVisibleCount = 10;
    renderShell();
  }
  if (event.target.name === "matchClient") {
    state.selectedClientId = event.target.value;
    state.visibleCount = 5;
    renderShell();
  }
  if (event.target.name === "matchProperty") {
    state.selectedPropertyId = event.target.value;
    state.visibleCount = 5;
    renderShell();
  }
  if (["budgetTolerance"].includes(event.target.name)) {
    if (event.target.type === "checkbox") state.filters[event.target.name] = event.target.checked;
    else if (event.target.type === "number") state.filters[event.target.name] = Number(event.target.value);
    else state.filters[event.target.name] = event.target.value;
    state.visibleCount = 5;
    renderShell();
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formId = event.target.getAttribute("id");
  const operationGeneration = sessionGeneration;
  try {
  if (formId === "loginForm") {
    const { email, password } = formData(event.target);
    state.loginBusy = true;
    state.loginError = "";
    renderShell();
    try {
      await login((email || "").trim(), password || "");
    } catch (error) {
      state.loginError = authErrorMessage(error);
      state.loginBusy = false;
      renderShell();
      return;
    }
    state.loginBusy = false;
    return;
  }
  if (formId === "clientForm") {
    const data = formData(event.target);
    const previousClient = existingClientFromForm(data.id);
    const parseBudgetK = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n) * 1000 : null;
    };
    const comuni = uniqueLocationList([...currentComuni(), data.comuneInput || ""]);
    const sqmRange = parseNumberRange(data.sqmMin, data.sqmMax);
    const clientPayload = await enhanceItemWithLocalMatching("cliente", {
      ...previousClient,
      id: data.id || undefined,
      createdAt: previousClient.createdAt || new Date().toISOString(),
      name: (data.name || "").trim(),
      phone: (data.phone || "").trim(),
      email: (data.email || "").trim(),
      source: data.source || "agenzia",
      comune: comuni[0] || "",
      comuni,
      quartieri: uniqueLocationList([...currentQuartieri(), data.quartiereInput || ""]),
      budgetMin: parseBudgetK(data.budgetMin),
      budgetMax: parseBudgetK(data.budgetMax),
      sqmMin: sqmRange.min,
      sqmMax: sqmRange.max,
      description: (data.description || "").trim(),
      notes: (data.notes || "").trim()
    });
    if (operationGeneration !== sessionGeneration) return;
    const saved = await storage.save("clients", clientPayload);
    await refreshFromCache();
    if (operationGeneration !== sessionGeneration) return;
    state.editingClientId = saved.id;
    state.selectedClientId = saved.id;
    state.clientSearch = "";
    state.clientVisibleCount = 10;
    clearClientDrafts();
    if (data.matchNow === "on") {
      await calculateMatchesAfterSave("client");
    } else {
      renderShell();
      toast("Cliente salvato.");
    }
    return;
  }
  if (formId === "propertyForm") {
    const data = formData(event.target);
    const previousProperty = existingPropertyFromForm(data.id);
    const parseCoord = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const parsePriceK = (v) => {
      const n = Number(String(v || "").replace(/[.\s]/g, "").replace(",", "."));
      return Number.isFinite(n) && n > 0 ? Math.round(n) * 1000 : null;
    };
    const sqmRange = parseNumberRange(data.sqmMin, data.sqmMax);
    const addressMeta = {
      comune: (data.comune || "").trim(),
      quartiere: (data.quartiere || "").trim(),
      provincia: (data.provincia || "").trim(),
      cap: (data.cap || "").trim(),
      lat: previousProperty.lat,
      lon: previousProperty.lon
    };
    const propertyPayload = await enhanceItemWithLocalMatching("immobile", {
      ...previousProperty,
      id: data.id || undefined,
      createdAt: previousProperty.createdAt || new Date().toISOString(),
      title: (data.title || "").trim(),
      agent: "",
      propertyType: (data.propertyType || "").trim(),
      price: parsePriceK(data.price),
      sqmMin: sqmRange.min,
      sqmMax: sqmRange.max,
      address: (data.address || "").trim(),
      comune: addressMeta.comune,
      quartiere: addressMeta.quartiere,
      provincia: addressMeta.provincia,
      cap: addressMeta.cap,
      lat: parseCoord(addressMeta.lat),
      lon: parseCoord(addressMeta.lon),
      description: (data.description || "").trim(),
      notes: (data.notes || "").trim()
    });
    if (operationGeneration !== sessionGeneration) return;
    const saved = await storage.save("properties", propertyPayload);
    await refreshFromCache();
    if (operationGeneration !== sessionGeneration) return;
    state.editingPropertyId = saved.id;
    state.selectedPropertyId = saved.id;
    state.propertySearch = "";
    state.propertyVisibleCount = 10;
    clearPropertyDrafts();
    if (data.matchNow === "on") {
      await calculateMatchesAfterSave("property");
    } else {
      renderShell();
      toast("Immobile salvato.");
    }
    return;
  }
  } catch (error) {
    console.error("Submit handler error:", error);
    toast(`Errore salvataggio: ${error?.message || error}`);
  }
});

start().catch((error) => {
  console.error(error);
  app.innerHTML = `<div class="empty">Errore avvio app: ${esc(error.message || error)}</div>`;
});
