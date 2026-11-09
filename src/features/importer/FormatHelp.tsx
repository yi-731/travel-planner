/**
 * 欄位格式說明（可展開）。欄位名稱與 services/importer.ts 的 FIELD_ALIASES、
 * services/exporter.ts 的 ITEM_HEADERS / EXPENSE_HEADERS 對應；改欄位時三處一起改。
 */
import { Icon } from '@/ui';
import s from './importer.module.css';

const ITEM_FIELDS: [name: string, required: boolean, desc: string][] = [
  ['日期', true, '2026-11-20、11/20 或「第1天」'],
  ['時間', false, '09:30，或 09:30-11:00'],
  ['行程', true, '景點、餐廳或活動名稱'],
  ['類型', false, '景點、餐廳、交通、住宿、購物、其他'],
  ['地址', false, '用來在地圖上定位'],
  ['停留', false, '分鐘，或「1.5小時」'],
  ['費用', false, '預估金額（當地貨幣）'],
  ['評分', false, '0–5，例如 4.5'],
  ['備註', false, '任何提醒'],
  ['連結', false, '官網或 Google 地圖連結'],
];

const EXPENSE_FIELDS: [name: string, required: boolean, desc: string][] = [
  ['日期', false, '沒填時記在出發日或今天'],
  ['項目', false, '例如「地鐵一日券」'],
  ['金額', true, '1200、¥1,200 都可以'],
  ['幣別', false, 'JPY、TWD…，沒填用當地貨幣'],
  ['分類', false, '餐飲、交通、住宿、門票、購物、其他'],
  ['付款人', false, '旅伴名字，會自動加入成員'],
];

function FieldTable({ caption, rows }: { caption: string; rows: typeof ITEM_FIELDS }) {
  return (
    <table className={s.fmt}>
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([name, req, desc]) => (
          <tr key={name}>
            <th scope="row">
              {name}
              {req && (
                <span className={s.req} aria-label="必填">
                  ＊
                </span>
              )}
            </th>
            <td>{desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FormatHelp() {
  return (
    <details className={s.help}>
      <summary>
        <span className={s.helpIcon}>
          <Icon name="info" size={17} />
        </span>
        <span className={s.helpTitle}>欄位格式說明</span>
        <Icon name="chevronDown" size={16} className={s.helpChev} />
      </summary>
      <div className={s.helpBody}>
        <p className={s.helpLead}>
          第一列寫欄位名稱，順序不拘，中英文都可以。標 <span className={s.req}>＊</span> 的欄位每一列都要填。
        </p>
        <FieldTable caption="行程表" rows={ITEM_FIELDS} />
        <FieldTable caption="記帳表（放在名為「記帳」的工作表）" rows={EXPENSE_FIELDS} />
      </div>
    </details>
  );
}
