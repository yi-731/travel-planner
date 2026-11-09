/**
 * 彈出頁註冊表：SheetRoute.name → 元件。
 * 新增彈出頁：在 src/store/ui.ts 加路由型別，再在這裡加一行。
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { SheetRoute } from '@/store/ui';

type Props<N extends SheetRoute['name']> = Omit<Extract<SheetRoute, { name: N }>, 'name'>;
type Registry = { [N in SheetRoute['name']]: LazyExoticComponent<ComponentType<Props<N>>> };

export const SHEETS: Registry = {
  place: lazy(() => import('@/features/place/PlaceSheet')),
  itemForm: lazy(() => import('@/features/plan/ItemFormSheet')),
  segment: lazy(() => import('@/features/plan/SegmentSheet')),
  weather: lazy(() => import('@/features/weather/WeatherSheet')),
  recommend: lazy(() => import('@/features/ai/RecommendSheet')),
  tripPicker: lazy(() => import('@/features/trips/TripPickerSheet')),
  newTrip: lazy(() => import('@/features/trips/NewTripSheet')),
  tripSettings: lazy(() => import('@/features/more/TripSettingsSheet')),
  expenseForm: lazy(() => import('@/features/money/ExpenseFormSheet')),
  import: lazy(() => import('@/features/importer/ImportSheet')),
  appSettings: lazy(() => import('@/features/more/AppSettingsSheet')),
};
