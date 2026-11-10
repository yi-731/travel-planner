/**
 * 「安裝到 iPhone 主畫面」三步驟圖解（只在瀏覽器、尚未安裝時顯示）。
 * 上方提醒：主畫面 App 和 Safari 的資料分開存，要先安裝再輸入，或用備份檔搬過去。
 * 圖都是用 CSS 畫的示意圖，跟著淺色／深色主題變色。
 */
import { Icon } from '@/ui';
import s from './more.module.css';

function SafariBar() {
  return (
    <span className={s.illoSafari} aria-hidden>
      <Icon name="back" size={13} stroke={2.4} />
      <Icon name="chevron" size={13} stroke={2.4} />
      <span className={s.illoHot}>
        <Icon name="share" size={14} stroke={2.4} />
      </span>
      <Icon name="list" size={13} stroke={2.4} />
    </span>
  );
}

function ShareSheet() {
  return (
    <span className={s.illoSheet} aria-hidden>
      <span className={s.illoSheetRow}>
        <span>拷貝</span>
      </span>
      <span className={`${s.illoSheetRow} ${s.illoSheetHot}`}>
        <span>加入主畫面</span>
        <span className={s.illoPlus}>
          <Icon name="plus" size={9} stroke={3} />
        </span>
      </span>
    </span>
  );
}

function HomeScreen() {
  return (
    <span className={s.illoHome} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={s.illoApp} />
      ))}
      <span className={`${s.illoApp} ${s.illoMine}`} />
    </span>
  );
}

const STEPS = [
  { art: <SafariBar />, title: '點 Safari 下方的「分享」', sub: '請用 Safari 開啟這個網頁' },
  { art: <ShareSheet />, title: '往下滑，點「加入主畫面」', sub: '在分享選單的動作清單裡' },
  { art: <HomeScreen />, title: '按右上角「加入」就完成了', sub: '從主畫面開啟：全螢幕、可離線使用' },
];

export function InstallGuide() {
  return (
    <div className={s.installWrap}>
      {/* iOS 的主畫面 App 和 Safari 各有各的資料，不會互通 */}
      <p className={s.installNote}>
        <b>請先加入主畫面，再開始輸入行程。</b>
        在 Safari 裡輸入的資料不會帶到主畫面的 App。已經輸入了的話，先在這頁按「備份全部資料」存檔，從主畫面打開 App 後再按「從備份還原」。
      </p>
      <ol className={s.install} aria-label="安裝步驟">
        {STEPS.map((st, i) => (
          <li key={i} className={s.step}>
            <span className={s.illo}>{st.art}</span>
            <span className={s.stepText}>
              <span className={`serif num ${s.stepNum}`}>{i + 1}</span>
              <b>{st.title}</b>
              <small>{st.sub}</small>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
