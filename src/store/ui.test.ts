import { afterEach, describe, expect, it } from 'vitest';
import { takeSheetOpener, useUI } from './ui';

afterEach(() => {
  useUI.setState({ sheets: [] });
  takeSheetOpener();
  document.body.innerHTML = '';
});

describe('彈出頁堆疊', () => {
  it('每次開啟都有新的 key：關閉後馬上再開同一頁，不會沿用還在滑出的舊頁面', () => {
    const ui = useUI.getState();
    ui.openSheet({ name: 'itemForm', itemId: 'a' });
    const first = useUI.getState().sheets[0].key;
    ui.closeSheet();
    ui.openSheet({ name: 'itemForm', itemId: 'b' });
    const second = useUI.getState().sheets[0].key;
    expect(first).toBeTypeOf('number');
    expect(second).not.toBe(first);
  });

  it('取代最上層會換新 key，下一層維持原本的 key（返回時畫面不重來）', () => {
    const ui = useUI.getState();
    ui.openSheet({ name: 'weather' });
    const parent = useUI.getState().sheets[0].key;
    ui.openSheet({ name: 'tripSettings' });
    const child = useUI.getState().sheets[1].key;
    ui.replaceSheet({ name: 'tripSettings' });
    const replaced = useUI.getState().sheets[1];
    expect(replaced.name).toBe('tripSettings');
    expect(replaced.key).not.toBe(child);
    ui.closeSheet();
    expect(useUI.getState().sheets).toEqual([{ name: 'weather', key: parent }]);
  });
});

describe('takeSheetOpener', () => {
  it('記住開第一層彈出頁時有焦點的按鈕，取出一次後清空', () => {
    const btn = document.createElement('button');
    document.body.append(btn);
    btn.focus();
    useUI.getState().openSheet({ name: 'appSettings' });
    // 疊上第二層時不覆蓋
    const inner = document.createElement('button');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.append(inner);
    document.body.append(dialog);
    inner.focus();
    useUI.getState().openSheet({ name: 'tripSettings' });
    expect(takeSheetOpener()).toBe(btn);
    expect(takeSheetOpener()).toBeNull();
  });

  it('焦點還在正在關閉的彈出頁裡時（全部關閉後馬上開新頁），保留原本的按鈕', () => {
    const btn = document.createElement('button');
    document.body.append(btn);
    btn.focus();
    useUI.getState().openSheet({ name: 'weather' });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    dialog.append(inner);
    document.body.append(dialog);
    inner.focus();
    useUI.getState().closeAllSheets();
    useUI.getState().openSheet({ name: 'place', itemId: 'x' });
    expect(takeSheetOpener()).toBe(btn);
  });

  it('沒有焦點（body）時不記錄', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    useUI.getState().openSheet({ name: 'weather' });
    expect(takeSheetOpener()).toBeNull();
  });
});
