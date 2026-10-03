// Give only the test process a fictional emulator configuration.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith('/src/firebase.js')) {
    const source = String(result.source)
      .replaceAll('import.meta.env', JSON.stringify({
        VITE_FIREBASE_API_KEY: 'demo-key',
        VITE_FIREBASE_AUTH_DOMAIN: 'demo-domusmatchai.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'demo-domusmatchai',
        VITE_FIREBASE_APP_ID: 'demo-app'
      }))
      .replace('getDocsFromServer,', 'getDocsFromServer as originalGetDocsFromServer,');
    // Reproduce a concurrent write or interrupted server read using the real SDK.
    return { ...result, source: source + `
      async function getDocsFromServer(query) {
        const snapshot = await originalGetDocsFromServer(query);
        if (globalThis.afterServerQuery) await globalThis.afterServerQuery(snapshot);
        return snapshot;
      }
    ` };
  }
  return result;
}
