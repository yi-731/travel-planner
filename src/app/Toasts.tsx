import { AnimatePresence, motion } from 'motion/react';
import { useUI } from '@/store/ui';
import s from './shell.module.css';

export function Toasts() {
  const toasts = useUI((st) => st.toasts);
  return (
    <div className={s.toasts} aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`${s.toast} ${t.tone === 'good' ? s.good : t.tone === 'bad' ? s.bad : ''}`}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
          >
            <span className={s.toastDot} />
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
