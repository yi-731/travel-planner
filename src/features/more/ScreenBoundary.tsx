/**
 * 畫面出錯時的保護（React Error Boundary）：一個畫面壞掉不會讓整個 App 變空白。
 * 給 app/AppShell（每個分頁）與 app/SheetHost（每個彈出頁）包在外面用：
 *   <ScreenBoundary key={tab + tripId}><View /></ScreenBoundary>
 *   <ScreenBoundary key={sheetKey} kind="sheet"><C {...props} /></ScreenBoundary>
 *
 * 備援畫面不讀任何行程畫面：只用 store 與 exportBackup（只讀 store，畫面壞掉也能備份）。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { haptic } from '@/platform';
import { useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Empty, Sheet } from '@/ui';
import { errorText, exportBackup } from './actions';
import s from './more.module.css';

interface Props {
  children: ReactNode;
  /** 'sheet'：彈出頁裡出錯，備援畫面也用彈出頁呈現 */
  kind?: 'screen' | 'sheet';
}

export class ScreenBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[travel-planner] 畫面出錯', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    const body = <CrashFallback onReset={this.reset} inSheet={this.props.kind === 'sheet'} />;
    return this.props.kind === 'sheet' ? <Sheet title="出了點問題">{body}</Sheet> : body;
  }
}

function CrashFallback({ onReset, inSheet }: { onReset: () => void; inSheet: boolean }) {
  const activeTripId = useData((st) => st.activeTripId);
  const otherTrip = useData((st) => Object.keys(st.trips).find((id) => id !== st.activeTripId) ?? null);
  const hasTrips = useData((st) => Object.keys(st.trips).length > 0);
  const busy = useUI((st) => !!st.busy['crash:backup']);

  const goHome = () => {
    const ui = useUI.getState();
    ui.closeAllSheets();
    ui.setTab('home');
    onReset();
  };
  const switchTrip = () => {
    if (!otherTrip) return;
    useData.getState().setActiveTrip(otherTrip);
    goHome();
  };
  const backup = async () => {
    const ui = useUI.getState();
    if (ui.busy['crash:backup']) return;
    ui.setBusy('crash:backup', true);
    try {
      const { result, count } = await exportBackup();
      if (result !== 'cancelled') {
        void haptic('success');
        ui.toast(result === 'downloaded' ? `已下載備份檔（${count} 個行程）` : `已備份 ${count} 個行程`, 'good');
      }
    } catch (e) {
      void haptic('error');
      ui.toast(errorText(e, '備份沒有完成，請再試一次。'), 'bad');
    } finally {
      useUI.getState().setBusy('crash:backup', false);
    }
  };

  return (
    <div className={inSheet ? undefined : s.crash} role="alert">
      <Empty
        icon="warning"
        title="這個畫面出了問題"
        action={
          <div className={s.crashBtns}>
            <Button variant="go" icon="home" block onClick={goHome}>
              {inSheet ? '關閉，回到首頁' : '回到首頁'}
            </Button>
            {otherTrip && activeTripId && (
              <Button variant="soft" icon="exchange" block onClick={switchTrip}>
                換別的行程
              </Button>
            )}
            {hasTrips && (
              <Button variant="ghost" icon="download" block disabled={busy} onClick={() => void backup()}>
                {busy ? '備份中…' : '備份全部資料'}
              </Button>
            )}
          </div>
        }
      >
        你的行程資料都還在手機裡。可以先回到首頁或換一個行程；擔心的話，先把全部資料備份起來。
      </Empty>
    </div>
  );
}
