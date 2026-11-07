/**
 * Private browser vault — stores encrypted and decrypted media in IndexedDB.
 * This is completely independent from the device's main gallery/file manager.
 * Deleting a file from the phone gallery does NOT affect this vault.
 * Deleting media from within the chat app does NOT touch the phone gallery.
 */

const DB_NAME = 'private-vault';
const DB_VERSION = 1;
const MEDIA_STORE = 'media';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'mediaId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export type VaultEntry = {
  mediaId: string;
  blob: Blob;
  mimeType: string;
  fileName: string;
  size: number;
  createdAt: number;
  fromUser: string;
  roomId: string;
};

export async function saveMedia(entry: VaultEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    tx.objectStore(MEDIA_STORE).put(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getMedia(mediaId: string): Promise<VaultEntry | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const req = tx.objectStore(MEDIA_STORE).get(mediaId);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as VaultEntry) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function deleteMedia(mediaId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    tx.objectStore(MEDIA_STORE).delete(mediaId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function deleteMediaForRoom(roomId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readwrite');
    const store = tx.objectStore(MEDIA_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const entries = req.result as VaultEntry[];
      for (const entry of entries) {
        if (entry.roomId === roomId) {
          store.delete(entry.mediaId);
        }
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getAllMedia(): Promise<VaultEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const req = tx.objectStore(MEDIA_STORE).getAll();
    req.onsuccess = () => {
      db.close();
      resolve((req.result as VaultEntry[]) ?? []);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}
