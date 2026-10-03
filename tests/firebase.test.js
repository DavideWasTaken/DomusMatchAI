import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer, terminate } from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as adapter from '../src/firebase.js';

let env, db, uid;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-domusmatchai',
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
  await adapter.initFirebase();
  const auth = getAuth(getApp());
  connectAuthEmulator(auth, 'http://127.0.0.1:9098', { disableWarnings: true });
  db = getFirestore(getApp());
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  const user = await createUserWithEmailAndPassword(auth, `operator-${crypto.randomUUID()}@example.com`, 'fictional-password');
  uid = user.user.uid;
});
beforeEach(async () => {
  adapter.stop();
  globalThis.afterServerQuery = null;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await setDoc(doc(admin, 'members', uid), { active: true });
    for (const kind of ['clients', 'properties']) {
      await setDoc(doc(admin, kind, 'one'), { name: 'Fictional one' });
      await setDoc(doc(admin, kind, 'two'), { name: 'Fictional two' });
    }
    await setDoc(doc(admin, 'matches', 'linked'), { clientId: 'one', propertyId: 'one' });
    await setDoc(doc(admin, 'matches', 'unrelated'), { clientId: 'two', propertyId: 'two' });
  });
});
after(async () => {
  adapter.stop();
  if (db) {
    await adapter.logout();
    await terminate(db);
    await deleteApp(getApp());
  }
  await env?.cleanup();
});

test('client deletion cascades on the server and preserves unrelated records', async () => {
  await adapter.storage.remove('clients', 'one');
  assert.equal((await getDocFromServer(doc(db, 'clients', 'one'))).exists(), false);
  assert.equal((await getDocFromServer(doc(db, 'matches', 'linked'))).exists(), false);
  assert.equal((await getDocFromServer(doc(db, 'matches', 'unrelated'))).exists(), true);
  assert.equal((await getDocFromServer(doc(db, 'properties', 'one'))).exists(), true);
});

test('property deletion also removes its linked matches', async () => {
  await adapter.storage.remove('properties', 'one');
  assert.equal((await getDocFromServer(doc(db, 'matches', 'linked'))).exists(), false);
  assert.equal((await getDocFromServer(doc(db, 'clients', 'one'))).exists(), true);
});

test('a concurrent match created after the first query is cleaned up', async () => {
  let queries = 0;
  globalThis.afterServerQuery = async () => {
    if (++queries !== 1) return;
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'matches', 'concurrent'), { clientId: 'one', propertyId: 'two' });
    });
  };
  await adapter.storage.remove('clients', 'one');
  globalThis.afterServerQuery = null;
  assert.ok(queries >= 2, 'The real server race must run before checking reconciliation');
  assert.equal((await getDocFromServer(doc(db, 'matches', 'concurrent'))).exists(), false);
});

test('a session change during the first server query cancels the delete', async () => {
  globalThis.afterServerQuery = () => adapter.stop();
  await assert.rejects(adapter.storage.remove('clients', 'one'), /sessione/i);
  globalThis.afterServerQuery = null;
  assert.equal((await getDocFromServer(doc(db, 'clients', 'one'))).exists(), true);
});

test('an interrupted post-commit cleanup is reported and retried in the same page', async () => {
  let queries = 0;
  globalThis.afterServerQuery = async () => {
    if (++queries === 1) {
      await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'matches', 'concurrent'), { clientId: 'one', propertyId: 'two' });
      });
    } else {
      throw new Error('Synthetic connection interruption');
    }
  };
  await assert.rejects(adapter.storage.remove('clients', 'one'), error => error.code === 'partial-cleanup');
  globalThis.afterServerQuery = null;
  assert.equal((await getDocFromServer(doc(db, 'clients', 'one'))).exists(), false);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Subscription timeout')), 8000);
    adapter.subscribe((_kind, error) => {
      clearTimeout(timeout);
      if (error) reject(error); else resolve();
    });
  });
  assert.equal((await getDocFromServer(doc(db, 'matches', 'concurrent'))).exists(), false);
});

test('500 linked matches refuse deletion before the parent is removed', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await Promise.all(Array.from({ length: 499 }, (_, index) =>
      setDoc(doc(admin, 'matches', `large-${index}`), { clientId: 'one', propertyId: 'one' })
    ));
  });
  await assert.rejects(adapter.storage.remove('clients', 'one'), /troppi match/i);
  assert.equal((await getDocFromServer(doc(db, 'clients', 'one'))).exists(), true);
});

test('499 linked matches fit the atomic delete boundary', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await Promise.all(Array.from({ length: 498 }, (_, index) =>
      setDoc(doc(admin, 'matches', `boundary-${index}`), { clientId: 'one', propertyId: 'one' })
    ));
  });
  await adapter.storage.remove('clients', 'one');
  assert.equal((await getDocFromServer(doc(db, 'clients', 'one'))).exists(), false);
  assert.equal((await getDocFromServer(doc(db, 'matches', 'boundary-497'))).exists(), false);
  assert.equal((await getDocFromServer(doc(db, 'matches', 'unrelated'))).exists(), true);
});

test('revoking membership during lookup prevents the atomic delete', async () => {
  globalThis.afterServerQuery = async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'members', uid), { active: false });
    });
  };
  await assert.rejects(adapter.storage.remove('clients', 'one'), error => error.code === 'permission-denied');
  globalThis.afterServerQuery = null;
  await env.withSecurityRulesDisabled(async context => {
    const snapshot = await getDocFromServer(doc(context.firestore(), 'clients', 'one'));
    assert.equal(snapshot.exists(), true);
  });
});
