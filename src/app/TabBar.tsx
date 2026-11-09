import { motion } from 'motion/react';
import { useUI, type Tab } from '@/store/ui';
import { haptic } from '@/platform';
import { Icon, type IconName } from '@/ui';
import s from './shell.module.css';

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'home', label: '今天', icon: 'home' },
  { key: 'plan', label: '行程', icon: 'calendar' },
  { key: 'map', label: '地圖', icon: 'map' },
  { key: 'money', label: '記帳', icon: 'wallet' },
  { key: 'more', label: '更多', icon: 'more' },
];

export function TabBar() {
  const tab = useUI((st) => st.tab);
  const setTab = useUI((st) => st.setTab);
  return (
    <nav className={s.tabbar} role="tablist" aria-label="主選單">
      {TABS.map((t) => {
        const on = t.key === tab;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={t.label}
            className={s.tab}
            onClick={() => {
              if (!on) void haptic('selection');
              setTab(t.key);
            }}
          >
            {on && <motion.span layoutId="tabpill" className={s.tabPill} transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
            <span className={s.tabInner}>
              <Icon name={t.icon} size={21} stroke={1.9} />
              {on && <span>{t.label}</span>}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
