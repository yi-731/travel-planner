/**
 * 尚未設定 AI 金鑰時的提示卡（各功能共用）：說明用途與費用，按鈕開啟 App 設定。
 * 已設定金鑰時不顯示任何東西（會跟著設定即時更新）。
 *
 * 用法：<AiKeyNotice feature="AI 推薦" />
 */
import { Button, Icon } from '@/ui';
import { useData } from '@/store/data';
import { useUI } from '@/store/ui';
import s from './ai.module.css';

/** 是否已設定 AI 金鑰（React 版的 aiReady()，設定改變時會重新渲染） */
export function useAiReady(): boolean {
  return useData((st) => !!st.settings.anthropicApiKey?.trim());
}

function AiKeyNotice({ feature }: { feature?: string }) {
  const ready = useAiReady();
  const openSheet = useUI((st) => st.openSheet);
  if (ready) return null;
  return (
    <section className={s.keyNotice} aria-label="需要 AI 金鑰">
      <span className={s.keyIcon} aria-hidden>
        <Icon name="spark" size={18} stroke={2.2} />
      </span>
      <div className={s.keyText}>
        <h3 className={s.keyTitle}>{feature ? `${feature}需要 AI 金鑰` : '這個功能需要 AI 金鑰'}</h3>
        <p className={s.keyBody}>
          會用你自己的 Anthropic API 金鑰呼叫 Claude，依用量付費，通常每次只要台幣幾元。金鑰只存在這台裝置。
        </p>
        <Button variant="soft" size="sm" icon="key" className={s.keyBtn} onClick={() => openSheet({ name: 'appSettings' })}>
          設定 API 金鑰
        </Button>
      </div>
    </section>
  );
}

export { AiKeyNotice };
export default AiKeyNotice;
