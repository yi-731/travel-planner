import { haptic } from '@/platform';
import s from './more.module.css';

/**
 * iOS 風格開關（51×31）。role="switch" + aria-checked，點擊範圍延伸到 44px 以上。
 * 用法：<Switch checked={on} onChange={setOn} label="觸覺回饋" />
 */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={s.switch}
      onClick={() => {
        void haptic('selection');
        onChange(!checked);
      }}
    >
      <span className={s.knob} aria-hidden />
    </button>
  );
}
