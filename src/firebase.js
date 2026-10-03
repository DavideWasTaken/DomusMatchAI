import { initializeApp } from "firebase/app";
import {
  getAuth, setPersistence, browserSessionPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "firebase/auth";
import {
  initializeFirestore, memoryLocalCache, collection, doc,
  setDoc, deleteDoc, onSnapshot, query, where, limit, getDocsFromServer, writeBatch
} from "firebase/firestore";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.authDomain && config.appId);
const KINDS = ["clients", "properties", "matches"];
const caches = Object.fromEntries(KINDS.map(kind => [kind, new Map()]));
let app, auth, db, initialization;
let unsubscribers = [];
let generation = 0;
// Memory-only recovery tickets: retry interrupted concurrent-match cleanup in
// the same page when the original operator reconnects. No customer disk cache.
const pendingCascades = new Map();

export async function initFirebase() {
  if (!initialization) {
    initialization = (async () => {
      app = initializeApp(config);
      db = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
      auth = getAuth(app);
      await setPersistence(auth, browserSessionPersistence);
    })();
  }
  return initialization;
}

export function stop() {
  generation++;
  unsubscribers.forEach(unsubscribe => unsubscribe());
  unsubscribers = [];
  for (const cache of Object.values(caches)) cache.clear();
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, user => {
    stop();
    callback(user);
  });
}
export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export async function logout() {
  stop();
  await signOut(auth);
}

// Wait for server-confirmed membership before exposing any records. Cache-only
// snapshots from an earlier account cannot repopulate the application on login.
export function subscribe(onChange) {
  stop();
  const current = generation;
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const ready = new Set();
  let listening = false;
  const fail = error => {
    if (generation !== current) return;
    stop();
    onChange(null, error);
  };
  unsubscribers.push(onSnapshot(doc(db, "members", uid), { includeMetadataChanges: true }, member => {
    if (generation !== current || member.metadata.fromCache) return;
    if (!member.exists() || member.data().active !== true) {
      fail(new Error("Accesso non abilitato. Contatta l'amministratore dell'agenzia."));
      return;
    }
    if (listening) return;
    listening = true;
    resumeCascades(uid, current).then(() => {
      if (generation !== current) return;
      for (const kind of KINDS) {
        unsubscribers.push(onSnapshot(collection(db, kind), { includeMetadataChanges: true }, snapshot => {
          if (generation !== current || snapshot.metadata.fromCache) return;
          const map = caches[kind];
          map.clear();
          snapshot.forEach(record => map.set(record.id, { ...record.data(), id: record.id }));
          ready.add(kind);
          if (ready.size === KINDS.length) onChange(kind, null);
        }, fail));
      }
    }).catch(fail);
  }, fail));
}

function requireKind(kind) {
  if (!KINDS.includes(kind)) throw new Error("Tipo di record non valido.");
}
function requireUser() {
  if (!auth.currentUser) throw new Error("Accedi prima di modificare i dati.");
  return auth.currentUser.uid;
}

function requireSession(uid, current) {
  if (generation !== current || auth.currentUser?.uid !== uid) {
    throw new Error("La sessione è cambiata. Operazione interrotta.");
  }
}

function linkedMatches(kind, id) {
  return query(collection(db, "matches"), where(kind === "clients" ? "clientId" : "propertyId", "==", id), limit(500));
}

async function reconcileCascade(ticket, current) {
  while (true) {
    requireSession(ticket.uid, current);
    const snapshot = await getDocsFromServer(linkedMatches(ticket.kind, ticket.id));
    requireSession(ticket.uid, current);
    if (snapshot.empty) return;
    const batch = writeBatch(db);
    snapshot.forEach(record => batch.delete(record.ref));
    await batch.commit();
    requireSession(ticket.uid, current);
    snapshot.forEach(record => caches.matches.delete(record.id));
  }
}

async function resumeCascades(uid, current) {
  for (const [key, ticket] of pendingCascades) {
    if (ticket.uid !== uid) continue;
    await reconcileCascade(ticket, current);
    pendingCascades.delete(key);
  }
}
export const storage = {
  async list(kind) {
    requireKind(kind);
    return structuredClone(Array.from(caches[kind].values()));
  },
  async save(kind, item) {
    requireKind(kind);
    const uid = requireUser();
    const current = generation;
    const id = item.id || crypto.randomUUID();
    const data = { ...item, updatedAt: new Date().toISOString(), updatedBy: uid };
    delete data.id;
    delete data._version;
    await setDoc(doc(db, kind, id), data);
    const result = { ...data, id };
    if (generation === current && auth.currentUser?.uid === uid) caches[kind].set(id, result);
    return structuredClone(result);
  },
  async remove(kind, id) {
    requireKind(kind);
    const uid = requireUser();
    const current = generation;
    if (kind === "matches") {
      await deleteDoc(doc(db, kind, id));
      if (generation === current && auth.currentUser?.uid === uid) caches[kind].delete(id);
      return;
    }
    // Query the server, not a possibly incomplete UI cache. 499 matches plus
    // their source fit Firestore's 500-write atomic batch.
    const snapshot = await getDocsFromServer(linkedMatches(kind, id));
    requireSession(uid, current);
    if (snapshot.size >= 500) throw new Error("Troppi match collegati: contatta l'amministratore prima di eliminare il record.");
    const batch = writeBatch(db);
    batch.delete(doc(db, kind, id));
    snapshot.forEach(record => batch.delete(record.ref));
    await batch.commit();
    if (generation === current && auth.currentUser?.uid === uid) {
      caches[kind].delete(id);
      snapshot.forEach(record => caches.matches.delete(record.id));
    }
    const key = JSON.stringify([uid, kind, id]);
    const ticket = { uid, kind, id };
    pendingCascades.set(key, ticket);
    try {
      // A match may have arrived between the first query and the batch. Rules
      // prevent new matches after the source is deleted; clean up that race.
      await reconcileCascade(ticket, current);
      pendingCascades.delete(key);
    } catch (cause) {
      const error = new Error("Record eliminato. Pulizia dei match interrotta: usa Riprova o accedi nuovamente in questa pagina. Se chiudi la pagina, contatta l'amministratore.", { cause });
      error.code = "partial-cleanup";
      throw error;
    }
  }
};
