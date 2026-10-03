import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-domusmatchai',
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'members', 'operator'), { active: true });
    await setDoc(doc(db, 'members', 'second-branch'), { active: true });
    await setDoc(doc(db, 'members', 'revoked'), { active: false });
    for (const kind of ['clients', 'properties', 'matches']) {
      await setDoc(doc(db, kind, 'example'), { title: 'Synthetic record', updatedAt: '2026-01-01', updatedBy: 'operator', ...(kind === 'matches' ? { clientId: 'example', propertyId: 'example' } : {}) });
    }
  });
});

test('unauthenticated visitors cannot read or write agency records', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'clients', 'example')));
  await assertFails(setDoc(doc(db, 'clients', 'new'), { name: 'Example' }));
});
test('sign-in alone does not grant access; revoked members are denied', async () => {
  for (const uid of ['outsider', 'revoked']) {
    const db = env.authenticatedContext(uid).firestore();
    for (const kind of ['clients', 'properties', 'matches']) {
      await assertFails(getDocs(collection(db, kind)));
      await assertFails(deleteDoc(doc(db, kind, 'example')));
    }
  }
});
test('active operators share only the three intended collections', async () => {
  const db = env.authenticatedContext('operator').firestore();
  for (const kind of ['clients', 'properties', 'matches']) {
    await assertSucceeds(getDocs(collection(db, kind)));
    await assertSucceeds(setDoc(doc(db, kind, 'new'), { name: 'Synthetic', updatedAt: '2026-01-01', updatedBy: 'operator', ...(kind === 'matches' ? { clientId: 'new', propertyId: 'new' } : {}) }));
    await assertSucceeds(deleteDoc(doc(db, kind, 'example')));
  }
  await assertFails(setDoc(doc(db, 'unexpected', 'new'), { updatedBy: 'operator' }));
});
test('members cannot enroll themselves, reactivate access, or list membership', async () => {
  for (const uid of ['operator', 'outsider', 'revoked']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db, 'members', uid), { active: true }));
    await assertFails(deleteDoc(doc(db, 'members', uid)));
    await assertFails(getDocs(collection(db, 'members')));
  }
});
test('two approved operators can share records while membership reads stay private', async () => {
  const first = env.authenticatedContext('operator').firestore();
  const second = env.authenticatedContext('second-branch').firestore();
  await assertSucceeds(setDoc(doc(first, 'clients', 'shared'), { name: 'Example', updatedBy: 'operator', updatedAt: '2026-01-01' }));
  await assertSucceeds(getDoc(doc(second, 'clients', 'shared')));
  await assertSucceeds(setDoc(doc(second, 'clients', 'shared'), { name: 'Updated example', updatedBy: 'second-branch', updatedAt: '2026-01-02' }));
  await assertSucceeds(getDoc(doc(second, 'members', 'second-branch')));
  await assertFails(getDoc(doc(second, 'members', 'operator')));
});
test('writes require metadata attributed to the authenticated operator', async () => {
  const db = env.authenticatedContext('operator').firestore();
  await assertFails(setDoc(doc(db, 'clients', 'example'), { name: 'Synthetic' }));
  await assertFails(setDoc(doc(db, 'clients', 'example'), { updatedAt: '2026-01-01', updatedBy: 'another-user' }));
});
test('revoking membership blocks subsequent access for an already signed-in user', async () => {
  const db = env.authenticatedContext('operator').firestore();
  await assertSucceeds(getDoc(doc(db, 'clients', 'example')));
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'members', 'operator'), { active: false });
  });
  await assertFails(getDoc(doc(db, 'clients', 'example')));
  await assertFails(deleteDoc(doc(db, 'clients', 'example')));
});

test('matches must reference existing clients and properties', async () => {
  const db = env.authenticatedContext('operator').firestore();
  const metadata = { updatedBy: 'operator', updatedAt: '2026-01-01' };
  await assertFails(setDoc(doc(db, 'matches', 'orphan'), { ...metadata, clientId: 'missing', propertyId: 'example' }));
  await assertFails(setDoc(doc(db, 'matches', 'orphan'), { ...metadata, clientId: 'example', propertyId: 'missing' }));
  await assertFails(setDoc(doc(db, 'matches', 'orphan'), { ...metadata }));
});

test('a batch cannot delete a match parent and create a new linked match', async () => {
  const db = env.authenticatedContext('operator').firestore();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'clients', 'example'));
  batch.set(doc(db, 'matches', 'late'), { clientId: 'example', propertyId: 'example', updatedBy: 'operator', updatedAt: '2026-01-01' });
  await assertFails(batch.commit());
  const parent = await assertSucceeds(getDoc(doc(db, 'clients', 'example')));
  if (!parent.exists()) throw new Error('Failed batch removed its parent');
});
