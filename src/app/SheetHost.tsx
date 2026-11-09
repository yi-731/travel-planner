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
    const { name, ...props } = top;
    const C = SHEETS[name] as unknown as ComponentType<Record<string, unknown>>;
    node = (
      <Suspense key={`${sheets.length}-${name}`} fallback={null}>
        <C {...props} />
      </Suspense>
    );
  }
  return <AnimatePresence>{node}</AnimatePresence>;
}
