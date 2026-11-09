/**
 * 時間軸左右滑動切換前一天／後一天。
 * - 只在明顯橫向滑動時接手（直向捲動照常）；搭配 CSS touch-action: pan-y。
 * - 滑動時內容跟著手指輕微位移，放開超過門檻才換天，否則彈回。
 * - 滑動結束後的那一下「點擊」會被吃掉，避免誤開行程點。
 */
import { animate, useMotionValue, type MotionValue } from 'motion/react';
import { useRef, type MouseEvent, type PointerEvent } from 'react';

const LOCK_PX = 10; // 移動多少才判斷方向
const SWITCH_PX = 64; // 放開時超過這個距離就換天
const FLICK_SPEED = 0.45; // px/ms，快速甩動也算
const FLICK_MIN_PX = 24;

interface Gesture {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  axis: 'x' | 'y' | null;
}

export function useDaySwipe(opts: { canPrev: boolean; canNext: boolean; reduce: boolean; onSwipe: (dir: -1 | 1) => void }): {
  x: MotionValue<number>;
  handlers: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
    onClickCapture: (e: MouseEvent<HTMLElement>) => void;
  };
} {
  const x = useMotionValue(0);
  const g = useRef<Gesture | null>(null);
  const swipedAt = useRef(0);
  const latest = useRef(opts);
  latest.current = opts;

  const settle = () => {
    if (latest.current.reduce) x.jump(0);
    else animate(x, 0, { type: 'spring', stiffness: 520, damping: 40 });
  };

  return {
    x,
    handlers: {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), axis: null };
      },
      onPointerMove: (e) => {
        const st = g.current;
        if (!st || st.id !== e.pointerId) return;
        const dx = e.clientX - st.x0,
          dy = e.clientY - st.y0;
        if (!st.axis) {
          if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
          st.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
          if (st.axis === 'x') {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* 不支援就算了 */
            }
          }
        }
        if (st.axis !== 'x' || latest.current.reduce) return;
        const { canPrev, canNext } = latest.current;
        const blocked = (dx > 0 && !canPrev) || (dx < 0 && !canNext);
        x.set(dx * (blocked ? 0.1 : 0.3));
      },
      onPointerUp: (e) => {
        const st = g.current;
        g.current = null;
        if (!st || st.id !== e.pointerId || st.axis !== 'x') return;
        swipedAt.current = performance.now();
        const dx = e.clientX - st.x0;
        const v = dx / Math.max(1, performance.now() - st.t0);
        const far = Math.abs(dx) > SWITCH_PX || (Math.abs(v) > FLICK_SPEED && Math.abs(dx) > FLICK_MIN_PX);
        const dir: -1 | 1 = dx < 0 ? 1 : -1;
        const { canPrev, canNext, onSwipe } = latest.current;
        if (far && (dir === 1 ? canNext : canPrev)) {
          x.jump(0);
          onSwipe(dir);
        } else settle();
      },
      onPointerCancel: () => {
        g.current = null;
        settle();
      },
      onClickCapture: (e) => {
        if (performance.now() - swipedAt.current < 400) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
    },
  };
}
