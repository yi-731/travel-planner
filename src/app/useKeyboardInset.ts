/**
 * 網頁版／加入主畫面的 PWA：iOS 鍵盤打開時只縮小「可見區域」（visualViewport），
 * position: fixed; bottom: 0 的彈出頁會被鍵盤蓋住（「儲存」按鈕、最後幾個欄位看不到）。
 * 這裡量出鍵盤高度寫進 <html> 的 CSS 變數，ui.module.css 用它把彈出頁抬到鍵盤上方：
 * - --kb：鍵盤（＋輸入輔助列）蓋住的高度
 * - --vvh：目前看得到的高度
 * - data-kb：鍵盤開著（底部安全區不用再留白）
 * 原生 App 由 @capacitor/keyboard 的 resize: 'native' 直接縮小 WebView，這裡量到的會是 0，不會重複。
 */
import { useEffect } from 'react';

/** 小於這個高度當作瀏覽器工具列變化，不是鍵盤 */
const MIN_KB = 80;

const isEditable = (el: Element | null) =>
  !!el && (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el instanceof HTMLInputElement || (el instanceof HTMLElement && el.isContentEditable));

/** 在 App 最外層呼叫一次 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    let raf = 0;
    let applied = false;

    const clear = () => {
      if (!applied) return;
      applied = false;
      root.style.removeProperty('--kb');
      root.style.removeProperty('--vvh');
      delete root.dataset.kb;
    };
    const update = () => {
      raf = 0;
      // 只在輸入框有焦點時才算：雙指放大也會讓 visualViewport 變小，那不是鍵盤
      const kb = isEditable(document.activeElement) && vv.scale < 1.01 ? Math.max(0, root.clientHeight - vv.height - vv.offsetTop) : 0;
      if (kb < MIN_KB) return clear();
      applied = true;
      root.style.setProperty('--kb', `${Math.round(kb)}px`);
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.dataset.kb = '';
    };
    // 換到下一個欄位時會先 focusout 再 focusin：等到下一個畫面再算，彈出頁才不會先掉下去再彈上來
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      if (raf) cancelAnimationFrame(raf);
      clear();
    };
  }, []);
}
