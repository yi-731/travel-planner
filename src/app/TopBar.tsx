import { useActiveTrip } from '@/store/data';
import { useUI } from '@/store/ui';
import { haptic } from '@/platform';
import { Icon, useBlobUrl } from '@/ui';
import s from './shell.module.css';

export function TopBar() {
  const trip = useActiveTrip();
  const openSheet = useUI((st) => st.openSheet);
  const cover = useBlobUrl(trip?.cover.kind === 'image' ? trip.cover.blobKey : null);
  return (
    <header className={s.top}>
      <div className={s.topIn}>
        <button
          type="button"
          className={s.tripChip}
          onClick={() => {
            void haptic('light');
            openSheet({ name: 'tripPicker' });
          }}
          aria-label="切換行程"
        >
          <span className={s.av} style={cover ? { backgroundImage: `url(${cover})` } : { filter: trip?.cover.hue ? `hue-rotate(${trip.cover.hue}deg)` : undefined }} />
          <span className={s.chipText}>
            <small>我的旅程</small>
            <b>{trip?.name ?? '尚無行程'}</b>
          </span>
          <Icon name="chevronDown" size={14} stroke={2.4} />
        </button>
      </div>
    </header>
  );
}
