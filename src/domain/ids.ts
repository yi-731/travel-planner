export const uid = (): string => {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID().replace(/-/g, '').slice(0, 16);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
};
