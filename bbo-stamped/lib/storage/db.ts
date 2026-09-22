import { migrateActivation } from './activation';
import type { BBOActivation } from '@/types';

const DB_NAME = 'bbo-stamped';
const DB_VERSION = 1;
const STORE = 'activations';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so activations cannot be saved.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local database.'));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Local database write failed.'));
        tx.oncomplete = () => db.close();
      })
  );
}

export async function saveActivation(activation: BBOActivation): Promise<void> {
  const next: BBOActivation = { ...activation, updatedAt: new Date().toISOString() };
  await run('readwrite', (store) => store.put(next));
}

export async function loadActivation(id: string): Promise<BBOActivation | null> {
  const result = await run<BBOActivation | undefined>('readonly', (store) => store.get(id));
  return result ? migrate(result) : null;
}

/** Fills in fields added after an activation was first saved. */
function migrate(activation: BBOActivation): BBOActivation {
  return {
    ...activation,
    photoPlan: activation.photoPlan ?? [],
    kitchenAccess: activation.kitchenAccess ?? 'unknown',
  };
}

export async function listActivations(): Promise<BBOActivation[]> {
  const all = await run<BBOActivation[]>('readonly', (store) => store.getAll());
  return all.map(migrate).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteActivation(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}

export async function duplicateActivation(id: string, newIdValue: string): Promise<BBOActivation | null> {
  const source = await loadActivation(id);
  if (!source) return null;
  const now = new Date().toISOString();
  const copy: BBOActivation = {
    ...structuredClone(source),
    id: newIdValue,
    createdAt: now,
    updatedAt: now,
    business: { ...source.business, name: `${source.business.name} (copy)` },
    shots: source.shots.map((shot) => ({ ...shot, completed: false })),
    photoPlan: (source.photoPlan ?? []).map((photo) => ({ ...photo, completed: false })),
    verdict: undefined,
    editBlueprints: [],
  };
  await saveActivation(copy);
  return copy;
}
