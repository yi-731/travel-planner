import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { haptic } from '@/platform';
import { Icon, type IconName } from './Icon';
import s from './ui.module.css';

type Variant = 'go' | 'ghost' | 'soft' | 'plain' | 'danger' | 'accent';

interface Common {
  variant?: Variant;
  size?: 'md' | 'sm';
  block?: boolean;
  /** go 樣式右側圓形裡的圖示；其他樣式顯示在文字左邊 */
  icon?: IconName;
  children?: ReactNode;
  className?: string;
}

const cls = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

function inner(variant: Variant, icon: IconName | undefined, size: 'md' | 'sm', children: ReactNode) {
  if (variant === 'go')
    return (
      <>
        <span>{children}</span>
        <span className={s.goIcon}>
          <Icon name={icon ?? 'arrow'} size={size === 'sm' ? 14 : 17} stroke={2.3} />
        </span>
      </>
    );
  return (
    <>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
    </>
  );
}

/** 主要按鈕。variant="go" 是參考圖的黑色膠囊＋橘色圓形箭頭。 */
export function Button({ variant = 'ghost', size = 'md', block, icon, children, className, onClick, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cls(s.btn, s[variant], size === 'sm' && s.sm, block && s.block, className)}
      onClick={(e) => {
        void haptic('light');
        onClick?.(e);
      }}
      {...rest}
    >
      {inner(variant, icon, size, children)}
    </button>
  );
}

/** 外部連結（開 Google 地圖等），外觀同 Button */
export function LinkButton({ href, variant = 'ghost', size = 'md', block, icon, children, className }: Common & { href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls(s.btn, s[variant], size === 'sm' && s.sm, block && s.block, className)} onClick={() => void haptic('light')}>
      {inner(variant, icon, size, children)}
    </a>
  );
}

export function IconButton({ icon, label, onClick, className }: { icon: IconName; label: string; onClick?: () => void; className?: string }) {
  return (
    <button type="button" aria-label={label} className={cls(s.iconBtn, className)} onClick={() => { void haptic('light'); onClick?.(); }}>
      <Icon name={icon} size={18} />
    </button>
  );
}
