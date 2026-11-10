import { Map as LeafletMap } from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapAlive, runWhenIdle, type IdleTask } from './whenIdle';

let maps: LeafletMap[] = [];
afterEach(() => {
  for (const m of maps) if (mapAlive(m)) m.remove();
  maps = [];
  document.body.innerHTML = '';
});

function makeMap() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const m = new LeafletMap(el, { center: [35, 135.76], zoom: 13 });
  maps.push(m);
  return m;
}
const setZooming = (m: LeafletMap, on: boolean) => void ((m as unknown as { _animatingZoom: boolean })._animatingZoom = on);
const slot = () => ({ current: null as IdleTask | null });

describe('runWhenIdle', () => {
  it('runs right away when the map is idle', () => {
    const m = makeMap();
    const fn = vi.fn();
    runWhenIdle(m, slot(), fn);
    expect(fn).toHaveBeenCalledWith(m);
  });

  it('does nothing without a map', () => {
    const fn = vi.fn();
    runWhenIdle(null, slot(), fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('waits for zoomend while zooming and only runs the latest request', () => {
    const m = makeMap();
    const pending = slot();
    const a = vi.fn();
    const b = vi.fn();
    setZooming(m, true);
    runWhenIdle(m, pending, a);
    runWhenIdle(m, pending, b);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    setZooming(m, false);
    m.fire('zoomend');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(pending.current).toBeNull();
  });

  it('skips a removed map (user left the map tab while locating)', () => {
    const m = makeMap();
    m.remove();
    expect(mapAlive(m)).toBe(false);
    const fn = vi.fn();
    runWhenIdle(m, slot(), fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('drops a queued move when the map is removed before the zoom animation ends', () => {
    const m = makeMap();
    const fn = vi.fn();
    setZooming(m, true);
    runWhenIdle(m, slot(), fn);
    m.remove();
    // Leaflet 的動畫結束計時器在 remove() 之後仍可能觸發 zoomend
    m.fire('zoomend');
    expect(fn).not.toHaveBeenCalled();
  });
});
