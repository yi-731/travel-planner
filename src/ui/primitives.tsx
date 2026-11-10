import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { useId } from 'react';
import { haptic } from '@/platform';
import { Icon, type IconName } from './Icon';
import s from './ui.module.css';

const cls = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');

/** 裝飾用的日落光球 */
export function Orb({ size, style, halo, hue = 0, className }: { size: number; style?: CSSProperties; halo?: boolean; hue?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cls(s.orb, halo && s.orbHalo, className)}
      style={{ width: size, height: size, filter: hue ? `hue-rotate(${hue}deg)${halo ? ' blur(40px)' : ''}` : undefined, ...style }}
    />
  );
}

export function Card({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cls(s.card, className)} style={style}>
      {children}
    </div>
  );
}

/** iOS 設定頁風格的分組清單 */
export function ListGroup({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {title && <div className={s.groupTitle}>{title}</div>}
      <div className={s.group}>{children}</div>
    </div>
  );
}

interface RowProps {
  icon?: IconName;
  iconColor?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  end?: ReactNode;
  chevron?: boolean;
  href?: string;
  onClick?: () => void;
}
export function ListRow({ icon, iconColor, title, subtitle, end, chevron = true, href, onClick }: RowProps) {
  const body = (
    <>
      {icon ? (
        <span className={s.rowIcon} style={iconColor ? { color: iconColor } : undefined}>
          <Icon name={icon} size={18} />
        </span>
      ) : (
        <span />
      )}
      <span className={s.rowText}>
        <span className={s.rowTitle}>{title}</span>
        {subtitle && <span className={s.rowSub}>{subtitle}</span>}
      </span>
      <span className={s.rowEnd}>
        {end}
        {href ? <Icon name="arrowUpRight" size={16} /> : chevron && onClick ? <Icon name="chevron" size={16} /> : null}
      </span>
    </>
  );
  if (href)
    return (
      <a className={s.row} href={href} target="_blank" rel="noopener noreferrer" onClick={() => void haptic('light')}>
        {body}
      </a>
    );
  if (onClick)
    return (
      <button type="button" className={s.row} onClick={() => { void haptic('light'); onClick(); }}>
        {body}
      </button>
    );
  return <div className={s.row}>{body}</div>;
}

interface TileProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  hot?: boolean;
  onClick?: () => void;
  href?: string;
}
export function Tile({ label, value, sub, hot, onClick, href }: TileProps) {
  const body = (
    <>
      <span className={s.tileLabel}>{label}</span>
      <span className={s.tileValue}>{value}</span>
      {sub && <span className={s.tileSub}>{sub}</span>}
    </>
  );
  if (href)
    return (
      <a className={cls(s.tile, hot && s.tileHot)} href={href} target="_blank" rel="noopener noreferrer" onClick={() => void haptic('light')}>
        {body}
      </a>
    );
  return (
    <button type="button" className={cls(s.tile, hot && s.tileHot)} onClick={() => { void haptic('light'); onClick?.(); }}>
      {body}
    </button>
  );
}

/** 有色點的類型標籤；color 傳 CSS 變數名，如 --t-sight */
export function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className={s.chip} style={{ ['--c' as string]: `var(${color})` }}>
      {children}
    </span>
  );
}
export function Pill({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span className={s.pill} style={style}>
      {children}
    </span>
  );
}

export function Empty({ icon, title, children, action }: { icon?: IconName; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      {icon && <Icon name={icon} size={30} stroke={1.6} />}
      {title && <div className={s.emptyTitle}>{title}</div>}
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}

export const Spinner = () => <span className={s.spinner} aria-label="處理中" role="status" />;

export function Note({ tone = 'accent', children }: { tone?: 'accent' | 'warn' | 'info' | 'bad'; children: ReactNode }) {
  return <div className={cls(s.note, tone === 'warn' && s.noteWarn, tone === 'info' && s.noteInfo, tone === 'bad' && s.noteBad)}>{children}</div>;
}

/** 大標題（各分頁頂端） */
export function PageHead({ eyebrow, title, end }: { eyebrow?: ReactNode; title: ReactNode; end?: ReactNode }) {
  return (
    <div className={s.pageHead}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <div className={s.pageHeadRow}>
        <h1 className={s.pageTitle}>{title}</h1>
        <span className="spacer" />
        {end}
      </div>
    </div>
  );
}

/* ---------- 表單 ---------- */
export function Field({ label, hint, children, id }: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={fid}>
        {label}
      </label>
      {children(fid)}
      {hint && <div className={s.hint}>{hint}</div>}
    </div>
  );
}

// React 19：ref 是一般 prop，ComponentProps 已包含 ref
export function TextInput({ label, hint, className, ...p }: { label: ReactNode; hint?: ReactNode } & ComponentProps<'input'>) {
  return <Field label={label} hint={hint} id={p.id}>{(id) => <input {...p} id={id} className={cls(s.input, className)} />}</Field>;
}
export function TextArea({ label, hint, className, ...p }: { label: ReactNode; hint?: ReactNode } & ComponentProps<'textarea'>) {
  return <Field label={label} hint={hint} id={p.id}>{(id) => <textarea rows={3} {...p} id={id} className={cls(s.input, className)} />}</Field>;
}
export function Select({ label, hint, children, className, ...p }: { label: ReactNode; hint?: ReactNode; children: ReactNode } & ComponentProps<'select'>) {
  return (
    <Field label={label} hint={hint} id={p.id}>
      {(id) => (
        <select {...p} id={id} className={cls(s.input, className)}>
          {children}
        </select>
      )}
    </Field>
  );
}
export const Grid2 = ({ children }: { children: ReactNode }) => <div className={s.grid2}>{children}</div>;

export interface PickOption<K extends string> {
  key: K;
  label: ReactNode;
  color?: string;
}
/** 膠囊選擇器（單選或多選） */
export function Picker<K extends string>({
  options,
  value,
  onChange,
  multi,
  ariaLabel,
}: {
  options: PickOption<K>[];
  value: K | K[] | null;
  onChange: (v: K[] | K) => void;
  multi?: boolean;
  ariaLabel?: string;
}) {
  const sel = Array.isArray(value) ? value : value ? [value] : [];
  return (
    <div className={s.picker} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={s.pickBtn}
          aria-pressed={sel.includes(o.key)}
          onClick={() => {
            void haptic('selection');
            if (multi) onChange(sel.includes(o.key) ? sel.filter((x) => x !== o.key) : [...sel, o.key]);
            else onChange(o.key);
          }}
        >
          {o.color && <span className={s.pickDot} style={{ ['--c' as string]: `var(${o.color})` }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
