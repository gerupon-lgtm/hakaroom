import type { PhotoRecord } from '../types';
import { PHOTO_TOTAL_CAP_BYTES, selectPhotosToEvict } from './photo-eviction';

const DB_NAME = 'hakaroom-photos';
const STORE = 'photos';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export function listPhotos(): Promise<PhotoRecord[]> {
  return run('readonly', (store) => store.getAll() as IDBRequest<PhotoRecord[]>).then((photos) =>
    photos.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)),
  );
}

export function deletePhoto(id: string): Promise<undefined> {
  return run('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

/** 保存後、合計サイズが上限を超えていれば古い写真から削除する。削除したIDを返す。 */
export async function savePhoto(photo: PhotoRecord): Promise<string[]> {
  await run('readwrite', (store) => store.put(photo));
  const all = await listPhotos();
  const evictIds = selectPhotosToEvict(all, PHOTO_TOTAL_CAP_BYTES);
  for (const id of evictIds) await deletePhoto(id);
  return evictIds;
}

/** 自動削除されない永続ストレージを要求する。許可されたかを返す（非対応ならfalse）。 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
