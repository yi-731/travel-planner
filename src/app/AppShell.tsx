import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useEffect } from 'react';
import { useActiveTrip } from '@/store/data';
import { takeSheetOpener, useUI, type Tab } from '@/store/ui';
import { Spinner } from '@/ui';
import { SheetHost } from './SheetHost';
import { TabBar } from './TabBar';
import { Toasts } from './Toasts';
import { TopBar } from './TopBar';
import { useKeyboardInset } from './useKeyboardInset';
import { NoTrip } from './NoTrip';
import s from './shell.module.css';

const HomeView = lazy(() => import('@/features/home/HomeView'));
const PlanView = lazy(() => import('@/features/plan/PlanView'));
const MapView = lazy(() => import('@/features/map/MapView'));
const MoneyView = lazy(() => import('@/features/money/MoneyView'));
const MoreView = lazy(() => import('@/features/more/MoreView'));

const VIEWS: Record<Tab, React.LazyExoticComponent<() => React.JSX.Element>> = {
  home: HomeView,
  plan: PlanView,
  map: MapView,
  money: MoneyView,
  more: MoreView,
};

export function AppShell() {
  const tab = useUI((st) => st.tab);
  const trip = useActiveTrip();
  const sheetOpen = useUI((st) => st.sheets.length > 0);
  const View = VIEWS[tab];

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  useKeyboardInset();

  useEffect(() => {
    if (sheetOpen) {
      // 彈出頁開著時鎖住背後頁面的捲動（iOS 在背景或已捲到底的內容上拖曳，會捲動後面的清單）
      const el = document.documentElement;
      const prev = el.style.overflow;
      el.style.overflow = 'hidden';
      return () => {
        el.style.overflow = prev;
      };
    }
    // 全部關閉：inert 已在這次更新拿掉，把焦點還給當初開啟彈出頁的按鈕
    const opener = takeSheetOpener();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }, [sheetOpen]);

  return (
    <div className={s.app}>
      <div inert={sheetOpen} style={{ display: 'contents' }}>
      <TopBar />
      <main className={s.main}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab + (trip?.id ?? '')}
            className={s.view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Suspense fallback={<div className={s.loading}><Spinner /></div>}>{trip || tab === 'more' ? <View /> : <NoTrip />}</Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
      <TabBar />
      </div>
      <SheetHost />
      <Toasts />
    </div>
  );
}
