import { motion, useDragControls, type PanInfo } from 'motion/react';
import { useEffect, useId, type ReactNode } from 'react';
import { useUI } from '@/store/ui';
import { Icon } from './Icon';
import s from './ui.module.css';

interface SheetProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  /** 固定在底部的操作區（例如「儲存」按鈕） */
  footer?: ReactNode;
  /** 標題右側額外內容 */
  headerExtra?: ReactNode;
  /** 預設關閉最上層彈出頁 */
  onClose?: () => void;
  /** 頂部是否不顯示標題列（例如地點頁自訂大圖頭） */
  bare?: boolean;
  /** 沒有標題文字時的無障礙名稱 */
  ariaLabel?: string;
}

/**
 * 底部彈出頁（iOS 風格）：可拖曳把手往下滑關閉、點背景關閉、Esc 關閉。
 * 由 SheetHost 負責進出場動畫，元件本身只放內容。
 */
export function Sheet({ title, eyebrow, children, footer, headerExtra, onClose, bare, ariaLabel }: SheetProps) {
  const closeSheet = useUI((st) => st.closeSheet);
  const close = onClose ?? closeSheet;
  const controls = useDragControls();
  const labelId = useId();
  // Esc 關閉（呼叫本頁的 onClose，表單可以先確認未儲存的變更）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 600) close();
  };
  return (
    <>
      <motion.div className={s.scrim} onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} />
      <div className={s.sheetWrap}>
        <motion.div
          className={`${s.sheet} ${footer ? s.hasFoot : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={!ariaLabel && (title || eyebrow) && !bare ? labelId : undefined}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 34, stiffness: 380, mass: 0.9 }}
          drag="y"
          dragControls={controls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.04, bottom: 0.9 }}
          onDragEnd={onDragEnd}
        >
          <div className={s.sheetHead} onPointerDown={(e) => controls.start(e)}>
            <div className={s.grab} />
            {!bare && (
              <div className={s.sheetTitleRow}>
                <div className={s.sheetTitles} id={labelId}>
                  {eyebrow && <div className="eyebrow">{eyebrow}</div>}
                  {title && <h2 className={s.sheetTitle}>{title}</h2>}
                </div>
                {headerExtra}
                <button type="button" className={s.sheetClose} aria-label="關閉" onPointerDown={(e) => e.stopPropagation()} onClick={close}>
                  <Icon name="close" size={16} stroke={2.4} />
                </button>
              </div>
            )}
            {bare && (
              <button type="button" className={s.sheetClose} style={{ position: 'absolute', right: 'var(--gutter-r)', top: 14, zIndex: 3 }} aria-label="關閉" onPointerDown={(e) => e.stopPropagation()} onClick={close}>
                <Icon name="close" size={16} stroke={2.4} />
              </button>
            )}
          </div>
          <div className={s.sheetBody}>{children}</div>
          {footer && <div className={s.sheetFoot}>{footer}</div>}
        </motion.div>
      </div>
    </>
  );
}
