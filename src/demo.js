// Fictional examples only. Each adapter instance lives entirely in memory.
const createdAt = "2026-01-15T09:00:00.000Z";
const fixtures = {
  clients: [
    { id: "demo-client-1", name: "Famiglia Riva · esempio", phone: "Non disponibile (demo)", email: "famiglia.riva@example.com", source: "agenzia", comuni: ["Milano"], comune: "Milano", quartieri: ["Navigli"], budgetMin: 350000, budgetMax: 450000, sqmMin: 80, sqmMax: 110, description: "Cerchiamo un trilocale luminoso ai Navigli. Ascensore obbligatorio, terrazzo abitabile e box. No piano terra.", notes: "Dati fittizi · preferenza per visite pomeridiane.", createdAt },
    { id: "demo-client-2", name: "Elena Conti · esempio", phone: "Non disponibile (demo)", email: "elena.conti@example.com", source: "sito", comuni: ["Milano"], comune: "Milano", quartieri: ["Isola"], budgetMin: 220000, budgetMax: 320000, sqmMin: 45, sqmMax: 70, description: "Bilocale in zona Isola, con balcone e ascensore, vicino alla metropolitana.", notes: "Dati fittizi · prima casa.", createdAt },
    { id: "demo-client-3", name: "Paolo Serra · esempio", phone: "Non disponibile (demo)", email: "paolo.serra@example.com", source: "passaparola", comuni: ["Torino"], comune: "Torino", quartieri: ["Centro"], budgetMin: 160000, budgetMax: 250000, sqmMin: 50, sqmMax: 80, description: "Bilocale a Torino Centro, luminoso, con balcone. Budget massimo 250.000 euro.", notes: "Dati fittizi · nessuna urgenza.", createdAt }
  ],
  properties: [
    { id: "demo-property-1", title: "Trilocale con terrazzo · Navigli", propertyType: "Appartamento", status: "available", address: "Via Esempio A, civico fittizio", comune: "Milano", quartiere: "Navigli", price: 430000, sqmMin: 92, sqmMax: 92, description: "Trilocale luminoso zona Navigli, terzo piano con ascensore, terrazzo abitabile di 22 mq e box. Buone condizioni.", notes: "Immobile interamente fittizio.", createdAt },
    { id: "demo-property-2", title: "Bilocale con balcone · Isola", propertyType: "Appartamento", status: "available", address: "Via Esempio B, civico fittizio", comune: "Milano", quartiere: "Isola", price: 295000, sqmMin: 58, sqmMax: 58, description: "Bilocale luminoso in zona Isola, secondo piano con ascensore e balcone, vicino alla metropolitana. Senza box.", notes: "Immobile interamente fittizio.", createdAt },
    { id: "demo-property-3", title: "Bilocale da ristrutturare · Torino", propertyType: "Appartamento", status: "available", address: "Via Esempio C, civico fittizio", comune: "Torino", quartiere: "Centro", price: 510000, sqmMin: 55, sqmMax: 55, description: "Bilocale a Torino Centro, piano terra senza ascensore, senza terrazzo e senza box. Da ristrutturare.", notes: "Immobile fittizio · esempio di incompatibilità con la richiesta Riva.", createdAt }
  ],
  matches: []
};

export function createDemoAdapter() {
  const records = Object.fromEntries(Object.entries(fixtures).map(([kind, rows]) => [
    kind, new Map(structuredClone(rows).map(row => [row.id, row]))
  ]));
  const demoUser = { uid: "demo-operator", email: "demo@example.com" };
  let user = { ...demoUser };
  const authListeners = new Set();
  let onChange = null;
  function collection(kind) {
    if (!Object.hasOwn(records, kind)) throw new Error("Unknown demo collection");
    return records[kind];
  }
  function requireUser() {
    if (!user) throw new Error("Accedi alla demo per modificare i dati.");
  }
  function notifyAuth() {
    for (const callback of authListeners) callback(user ? { ...user } : null);
  }
  return {
    demoMode: true,
    firebaseConfigured: true,
    async initFirebase() {},
    watchAuth(callback) {
      authListeners.add(callback);
      callback(user ? { ...user } : null);
      return () => authListeners.delete(callback);
    },
    async login() { user = { ...demoUser }; notifyAuth(); },
    async logout() { user = null; onChange = null; notifyAuth(); },
    subscribe(callback) {
      requireUser();
      onChange = callback;
      for (const kind of Object.keys(records)) callback(kind, null);
    },
    stop() { onChange = null; },
    storage: {
      async list(kind) { return structuredClone([...collection(kind).values()]); },
      async save(kind, item) {
        requireUser();
        const rows = collection(kind);
        const saved = structuredClone({ ...item, id: item.id || crypto.randomUUID(), updatedAt: new Date().toISOString() });
        delete saved._version;
        rows.set(saved.id, saved);
        onChange?.(kind, null);
        return structuredClone(saved);
      },
      async remove(kind, id) {
        requireUser();
        collection(kind).delete(id);
        onChange?.(kind, null);
      }
    }
  };
}

export const { demoMode, firebaseConfigured, initFirebase, watchAuth, login, logout, subscribe, stop, storage } = createDemoAdapter();
