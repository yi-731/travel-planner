/**
 * App 設定：外觀、AI 助理（API 金鑰、模型、測試連線）、預設本國貨幣、原生功能（觸覺回饋、出發提醒）。
 * 每個設定改了就立即存（沒有「儲存」按鈕），和 iOS 設定 App 一樣。
 */
import { useState } from 'react';
import { AI_MODELS, COMMON_CURRENCIES } from '@/domain/constants';
import type { ThemePref } from '@/domain/types';
import { haptic, isNative } from '@/platform';
import { aiErrorMessage, resolveModel, testConnection } from '@/services/ai';
import { useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Field, Icon, ListGroup, ListRow, Picker, Select, Sheet, Spinner, type PickOption } from '@/ui';
import { Switch } from './Switch';
import { currencyChoices, currencyLabel } from './model';
import s from './more.module.css';

const THEMES: PickOption<ThemePref>[] = [
  { key: 'system', label: '跟隨系統' },
  { key: 'light', label: '淺色' },
  { key: 'dark', label: '深色' },
];
const LEAD_MINUTES = [5, 10, 15, 30, 60];
const KEY_URL = 'https://console.anthropic.com/settings/keys';

type TestState = { status: 'idle' } | { status: 'testing' } | { status: 'ok' } | { status: 'fail'; message: string };

export default function AppSettingsSheet() {
  const settings = useData((st) => st.settings);
  const updateSettings = useData((st) => st.updateSettings);
  const toast = useUI((st) => st.toast);
  const [keyInput, setKeyInput] = useState(settings.anthropicApiKey);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const hasKey = !!settings.anthropicApiKey.trim();
  const model = resolveModel(settings.aiModel);
  const leads = LEAD_MINUTES.includes(settings.reminderLeadMin) ? LEAD_MINUTES : [...LEAD_MINUTES, settings.reminderLeadMin].sort((a, b) => a - b);

  const saveKey = (v: string) => {
    const key = v.trim();
    if (key !== settings.anthropicApiKey) {
      updateSettings({ anthropicApiKey: key });
      setTest({ status: 'idle' });
    }
  };

  async function runTest() {
    saveKey(keyInput);
    setTest({ status: 'testing' });
    try {
      await testConnection();
      setTest({ status: 'ok' });
      void haptic('success');
      toast('連線成功，AI 功能可以使用了', 'good');
    } catch (e) {
      const message = aiErrorMessage(e);
      setTest({ status: 'fail', message });
      void haptic('error');
      toast(message, 'bad');
    }
  }

  return (
    <Sheet title="App 設定">
      <ListGroup title="外觀">
        <div className={s.groupPad}>
          <Picker
            ariaLabel="外觀"
            options={THEMES}
            value={settings.theme}
            onChange={(v) => updateSettings({ theme: (Array.isArray(v) ? v[0] : v) ?? 'system' })}
          />
          <p className={s.padHint}>「跟隨系統」會依 iPhone 的淺色／深色模式自動切換。</p>
        </div>
      </ListGroup>

      <ListGroup
        title={
          <span className={s.titleRow}>
            AI 助理
            <span className={`${s.status} ${hasKey ? s.statusOn : ''}`}>{hasKey ? '已設定金鑰' : '未設定金鑰'}</span>
          </span>
        }
      >
        <div className={s.groupPad}>
          <div className={s.aiIntro}>
            <span className={s.aiIcon} aria-hidden>
              <Icon name="spark" size={18} stroke={2.2} />
            </span>
            <p>排程檢查、景點推薦、穿搭建議、收據辨識會用到 Claude。費用依 Anthropic 用量計，由你的 API 金鑰付費，金鑰只存在這支手機。</p>
          </div>

          <Field label="API 金鑰">
            {(id) => (
              <div className={s.keyField}>
                <input
                  id={id}
                  name="anthropic-api-key"
                  className={`${s.input} ${s.keyInput}`}
                  type={showKey ? 'text' : 'password'}
                  value={keyInput}
                  placeholder="sk-ant-…"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  onChange={(e) => {
                    setKeyInput(e.target.value);
                    saveKey(e.target.value);
                  }}
                  onBlur={() => {
                    setKeyInput((v) => v.trim());
                    saveKey(keyInput);
                  }}
                />
                <button type="button" className={s.keyToggle} aria-pressed={showKey} aria-controls={id} onClick={() => setShowKey((v) => !v)}>
                  {showKey ? '隱藏' : '顯示'}
                </button>
              </div>
            )}
          </Field>
          <a className={s.extLink} href={KEY_URL} target="_blank" rel="noopener noreferrer" onClick={() => void haptic('light')}>
            到 console.anthropic.com 建立金鑰
            <Icon name="arrowUpRight" size={14} stroke={2.2} />
          </a>

          <Select
            label="模型"
            value={model}
            onChange={(e) => {
              updateSettings({ aiModel: e.target.value });
              setTest({ status: 'idle' });
            }}
          >
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>

          <div className={s.testRow}>
            <Button variant="ghost" icon={test.status === 'testing' ? undefined : 'refresh'} disabled={!keyInput.trim() || test.status === 'testing'} onClick={() => void runTest()}>
              {test.status === 'testing' ? (
                <span className={s.busyLabel}>
                  <Spinner /> 測試中…
                </span>
              ) : (
                '測試連線'
              )}
            </Button>
            {test.status === 'ok' && (
              <span className={`${s.testMsg} ${s.testOk}`} role="status">
                <Icon name="check" size={15} stroke={2.6} /> 連線成功
              </span>
            )}
            {!keyInput.trim() && <span className={s.testMsg}>先貼上金鑰才能測試</span>}
          </div>
          {test.status === 'fail' && (
            <p className={s.testFail} role="alert">
              {test.message}
            </p>
          )}
        </div>
      </ListGroup>

      <ListGroup title="記帳">
        <div className={s.groupPad}>
          <Select
            label="預設本國貨幣"
            hint="新建立的行程會用這個幣別換算花費"
            value={settings.defaultHomeCurrency}
            onChange={(e) => updateSettings({ defaultHomeCurrency: e.target.value })}
          >
            {currencyChoices(COMMON_CURRENCIES, settings.defaultHomeCurrency).map((c) => (
              <option key={c} value={c}>
                {currencyLabel(c)}
              </option>
            ))}
          </Select>
        </div>
      </ListGroup>

      <div className={s.nativeSec}>
        <ListGroup title="原生功能">
          <ListRow
            icon="spark"
            iconColor="var(--t-transport)"
            title="觸覺回饋"
            subtitle="按下按鈕、完成行程時輕輕震動"
            end={<Switch checked={isNative && settings.haptics} disabled={!isNative} label="觸覺回饋" onChange={(v) => updateSettings({ haptics: v })} />}
          />
          <ListRow
            icon="bell"
            iconColor="var(--accent)"
            title="出發提醒"
            subtitle="每個行程點開始前通知你"
            end={<Switch checked={isNative && settings.reminders} disabled={!isNative} label="出發提醒" onChange={(v) => updateSettings({ reminders: v })} />}
          />
          {isNative && settings.reminders && (
            <ListRow
              icon="clock"
              iconColor="var(--muted)"
              title="提前多久提醒"
              end={
                <select
                  className={s.inlineSelect}
                  aria-label="提前多久提醒"
                  value={settings.reminderLeadMin}
                  onChange={(e) => updateSettings({ reminderLeadMin: Number(e.target.value) })}
                >
                  {leads.map((m) => (
                    <option key={m} value={m}>
                      {m} 分鐘前
                    </option>
                  ))}
                </select>
              }
            />
          )}
        </ListGroup>
        {!isNative && <p className={s.nativeNote}>安裝原生 App 後可用。網頁版的 Safari 不支援震動與背景通知。</p>}
      </div>
    </Sheet>
  );
}
