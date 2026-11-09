import { useUI } from '@/store/ui';
import { Button, Orb } from '@/ui';
import s from './shell.module.css';

/** 沒有任何行程時的首畫面 */
export function NoTrip() {
  const openSheet = useUI((st) => st.openSheet);
  return (
    <>
      <div style={{ display: 'grid', gap: 6 }}>
        <div className="eyebrow">開始規劃</div>
        <h1 style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1 }}>你的下一趟旅程</h1>
      </div>
      <div className={s.noTrip}>
        <Orb size={260} halo style={{ right: -70, top: -60 }} />
        <Orb size={240} style={{ right: -60, top: -50 }} />
        <div className={s.glass}>
          <b style={{ fontSize: 19 }}>把行程試算表丟進來就好</b>
          <span style={{ color: 'var(--ink-2)', fontSize: 14 }}>支援 Excel、CSV、Google 試算表連結，也可以手動一站一站建立。</span>
          <div className="row" style={{ marginTop: 6 }}>
            <Button variant="go" icon="sheet" onClick={() => openSheet({ name: 'import' })}>
              匯入試算表
            </Button>
            <Button variant="ghost" onClick={() => openSheet({ name: 'newTrip' })}>
              手動建立
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
