import type { WorkJob } from '@/shared/router';
import type { TimelineDisplay } from '@/shared/worker';
import { activityState, readLiveActivity } from '@/shared/live-activity';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function LiveActivityCard({ job, display, onDismiss }: {
  job: WorkJob; display: TimelineDisplay; onDismiss: () => void;
}) {
  const activity = readLiveActivity(display.content);
  const state = activity ? activityState(activity, job) : { status: 'failed', summary: 'This update could not be loaded.' } as const;
  const label = { running: 'In progress', blocked: 'Needs attention', complete: 'Complete', failed: 'Interrupted', cancelled: 'Stopped' }[state.status];
  return (
    <article className="live-activity" data-status={state.status} aria-label={`${display.title}: ${label}`}>
      <header className="activity-header">
        <button type="button" onClick={onDismiss} aria-label={`Dismiss ${display.title}`} className="card-dismiss">×</button>
        <h2>{display.title}</h2>
        <span className="activity-state">{label}</span>
      </header>
      <div className="activity-body">
        <p role="status">{state.summary}</p>
        <span className="activity-symbol" aria-hidden="true">
          {state.status === 'running' ? (
            <span className="activity-signal"><i /><i /><i /><i /></span>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {state.status === 'complete' ? <path d="m6 12 4 4 8-9" /> : state.status === 'cancelled' ? <path d="M8 8h8v8H8z" /> : <><path d="M12 6v7" /><circle cx="12" cy="18" r=".7" fill="currentColor" /></>}
            </svg>
          )}
        </span>
      </div>
      {activity && activity.history.length > 0 && (
        <details className="live-activity-history">
          <summary><span>Activity history</span><span className="history-count">{activity.history.length}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4" /></svg></summary>
          <ol>
            {activity.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`}><time dateTime={new Date(entry.at).toISOString()}>{time(entry.at)}</time><span>{entry.summary}</span></li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}
