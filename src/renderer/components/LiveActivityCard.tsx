import type { WorkJob } from '@/shared/router';
import type { TimelineDisplay } from '@/shared/worker';
import { activityState, readLiveActivity } from '@/shared/live-activity';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function LiveActivityCard({ job, display, onDismiss }: {
  job: WorkJob; display: TimelineDisplay; onDismiss: () => void;
}) {
  const activity = readLiveActivity(display.content);
  if (!activity) return <article className="glass-card p-4">Progress unavailable.</article>;
  const state = activityState(activity, job);
  const attention = state.status === 'blocked' || state.status === 'failed';
  const label = { running: 'In progress', blocked: 'Needs attention', complete: 'Complete', failed: 'Interrupted', cancelled: 'Stopped' }[state.status];
  return (
    <article className={`live-activity ${attention ? 'live-activity-attention' : ''}`} aria-label={`${display.title}: ${label}`}>
      <header className="flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-white/55">
          <span aria-hidden="true" className={`live-activity-dot ${state.status === 'running' ? 'live-activity-pulse' : ''}`} />
          <span className="truncate">{display.title}</span>
          <span className="sr-only">{label}</span>
        </h2>
        <button type="button" onClick={onDismiss} aria-label={`Dismiss ${display.title}`} className="h-6 w-6 shrink-0 rounded-full text-white/35 hover:bg-white/10 hover:text-white">×</button>
      </header>
      <p className="mt-1 text-[14px] font-medium leading-snug text-white/95" role="status">{state.summary}</p>
      {attention && <p className="mt-1 text-[10px]">{label}</p>}
      {activity.history.length > 0 && (
        <details className="live-activity-history">
          <summary>Past activity <span className="text-white/25">· {activity.history.length}</span></summary>
          <ol>
            {activity.history.map((entry, index) => (
              <li key={index}><time dateTime={new Date(entry.at).toISOString()}>{time(entry.at)}</time><span>{entry.summary}</span></li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}
