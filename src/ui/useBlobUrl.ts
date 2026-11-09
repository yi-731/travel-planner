import { useEffect, useState } from 'react';
import { blobStore } from '@/store/persist';

/** 把 IndexedDB 裡的圖片 blob key 轉成可顯示的 URL */
export function useBlobUrl(key: string | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setUrl(null);
    if (key)
      void blobStore.get(key).then((b) => {
        if (!alive || !b) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [key]);
  return url;
}
