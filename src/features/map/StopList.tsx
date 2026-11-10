/**
 * 地圖下方的站點清單：編號與顏色和地圖標記一致。
 * 點一列 → 地圖移到那一站（沒有座標的開地點詳情）；右側導航鈕直接用 Google 地圖導航。
 * 要用 Apple 地圖：點那一列 → 地圖上的小卡 → 地點詳情。
 */
import { motion } from 'motion/react';
import { haptic } from '@/platform';
import { gmapsNavigate } from '@/services/links';
import { Icon } from '@/ui';
import { navQuery, stopAddress, type Stop } from './model';
import s from './map.module.css';

const cls = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

/** 背景定位狀態：running 定位中、waiting 等待中（剛開啟或連線中斷）、done 已查完 */
export type GeoState = 'running' | 'waiting' | 'done';
const STATUS: Record<GeoState, string> = { running: '定位中…', waiting: '尚未定位', done: '找不到位置' };

interface Props {
  stops: Stop[];
  selectedId: string | null;
  /** 沒座標的站點要顯示什麼：查完才說「找不到位置」 */
  geoState: GeoState;
  onPick: (st: Stop) => void;
  reduceMotion: boolean;
}

export function StopList({ stops, selectedId, geoState, onPick, reduceMotion }: Props) {
  return (
    <ol className={s.list}>
      {stops.map((st, k) => {
        const it = st.item;
        const q = navQuery(it);
        const addr = stopAddress(it);
        const status = st.geo ? null : STATUS[geoState];
        return (
          <motion.li
            key={it.id}
            className={cls(s.stop, it.done && s.isDone, selectedId === it.id && s.isSel, !st.geo && s.noGeo)}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: Math.min(k, 8) * 0.025, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <button
              type="button"
              className={s.stopMain}
              aria-current={selectedId === it.id ? 'true' : undefined}
              aria-label={`第 ${st.n} 站 ${it.title}${it.time ? `，${it.time}` : ''}${st.geo ? '，在地圖上顯示' : '，查看詳情'}`}
              onClick={() => {
                void haptic('selection');
                onPick(st);
              }}
            >
              <span className={cls(s.badge, it.done && s.badgeDone, !st.geo && s.badgeHollow)} style={{ ['--c' as string]: `var(${st.color})` }}>
                {st.n}
              </span>
              <span className={s.stopText}>
                <span className={s.stopTitle}>{it.title}</span>
                {(it.time || addr || status) && (
                  <span className={s.stopSub}>
                    {it.time && <b className="num">{it.time}</b>}
                    {addr && <span className={s.addr}>{addr}</span>}
                    {status && <span className={cls(s.status, geoState !== 'done' && s.statusPending)}>{status}</span>}
                  </span>
                )}
              </span>
            </button>
            <a className={s.nav} href={gmapsNavigate(q)} target="_blank" rel="noopener noreferrer" aria-label={`用 Google 地圖導航到「${it.title}」`} onClick={() => void haptic('light')}>
              <span>
                <Icon name="navigate" size={16} stroke={2.2} />
              </span>
            </a>
          </motion.li>
        );
      })}
    </ol>
  );
}
