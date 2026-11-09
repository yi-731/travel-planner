import { del, get, set } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

/** zustand persist 的 IndexedDB 儲存（比 localStorage 容量大、iOS 上較不易被清掉） */
export const idbStorage: StateStorage = {
  getItem: async (name) => (await get<string>(name)) ?? null,
  setItem: async (name, value) => {
    await set(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};

/** 圖片等大型檔案另外存，資料裡只記 key */
export const blobStore = {
  put: async (blob: Blob): Promise<string> => {
    const key = `blob:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await set(key, blob);
    return key;
  },
  get: (key: string) => get<Blob>(key),
  remove: (key: string) => del(key),
};
