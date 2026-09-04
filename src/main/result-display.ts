import type { WorkJob } from '../shared/router';
import type { TimelineDisplay } from '../shared/worker';

export const MAX_WIDGET_TEXT_LENGTH = 1_200;

export function createFallbackResultDisplay(
  job: Pick<WorkJob, 'id' | 'request'>,
  content: string,
  createdAt = Date.now(),
): TimelineDisplay {
  return {
    id: `${job.id}-result`,
    widgetId: 'result',
    title: job.request.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Result',
    format: 'markdown',
    content: content.slice(0, MAX_WIDGET_TEXT_LENGTH),
    alt: null,
    caption: null,
    links: [],
    createdAt,
  };
}
