// Explicit mode selection prevents demo sessions from initializing Firebase.
export const demoMode = import.meta.env.MODE === "demo";
const adapter = demoMode ? await import("./demo.js") : await import("./firebase.js");
export const { firebaseConfigured, initFirebase, watchAuth, login, logout, subscribe, stop, storage } = adapter;
