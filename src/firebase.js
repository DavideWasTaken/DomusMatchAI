import { initializeApp } from "firebase/app";
import {
  getAuth, setPersistence, browserSessionPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "firebase/auth";
import {
  initializeFirestore, memoryLocalCache, collection, doc,
  setDoc, deleteDoc, onSnapshot
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
  }, fail));
}

function requireKind(kind) {
  if (!KINDS.includes(kind)) throw new Error("Tipo di record non valido.");
}
function requireUser() {
  if (!auth.currentUser) throw new Error("Accedi prima di modificare i dati.");
  return auth.currentUser.uid;
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
    await deleteDoc(doc(db, kind, id));
    if (generation === current && auth.currentUser?.uid === uid) caches[kind].delete(id);
  }
};
