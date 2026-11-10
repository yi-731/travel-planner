import { AnimatePresence } from 'motion/react';
import { Suspense, type ComponentType } from 'react';
import { useUI } from '@/store/ui';
import { SHEETS } from './sheetRegistry';

/** 只顯示最上層的彈出頁；關閉後會回到下一層 */
export function SheetHost() {
  const sheets = useUI((st) => st.sheets);
  const top = sheets[sheets.length - 1];
  let node = null;
  if (top) {
    // key 每次開啟都不同：剛關閉、還在滑出動畫中的同名頁面不會被沿用（否則會看到上一次沒存的內容）
    const { name, key, ...props } = top;
    const C = SHEETS[name] as unknown as ComponentType<Record<string, unknown>>;
    node = (
      <Suspense key={key ?? `${sheets.length}-${name}`} fallback={null}>
        <C {...props} />
      </Suspense>
    );
  }
  return <AnimatePresence>{node}</AnimatePresence>;
}
