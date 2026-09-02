import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkJob } from '@/shared/router';
import type { TimelineDisplay as Display } from '@/shared/worker';

export type TimelineDisplay = Readonly<{ job: WorkJob; display: Display }>;

function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (window.ambient) void window.ambient.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children: label }) => href && /^https?:\/\//i.test(href)
          ? <a href={href} onClick={(event) => { event.preventDefault(); openExternal(href); }}>{label}</a>
          : <span>{label}</span>,
      }}
    >{children}</ReactMarkdown>
  );
}

const documentFor = (html: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:;">
  <base target="_blank">
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 14px; background: transparent; color: #3a3a44; font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
    h1, h2, h3 { margin: 0 0 10px; font-size: 1.1em; color: #1c1c22; }
    p { margin: 0 0 10px; }
    p:last-child { margin-bottom: 0; }
    a { color: #0a6cff; }
    img { display: block; max-width: 100%; height: auto; border-radius: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 7px 6px; border-bottom: 1px solid rgba(20,22,30,.08); text-align: left; }
  </style>
</head>
<body>${html}</body>
</html>`;

function HtmlPreview({ display }: { display: Display }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(180);
  return (
    <iframe
      ref={frame}
      title={display.title}
      sandbox="allow-same-origin"
      srcDoc={documentFor(display.content || (display as Display & { html?: string }).html || '')}
      onLoad={() => {
        const measured = frame.current?.contentDocument?.documentElement.scrollHeight ?? 180;
        setHeight(Math.max(120, Math.min(420, measured)));
      }}
      style={{ height }}
      className="block w-full border-0 bg-transparent"
    />
  );
}

function DisplayContent({ display }: { display: Display }) {
  const legacy = display as Display & { html?: string };
  const format = display.format ?? 'html';
  const content = display.content || legacy.html || '';
  if (format === 'image') {
    return <img src={content} alt={display.alt ?? display.title} className="block h-auto max-h-[70vh] w-full object-contain" />;
  }
  if (format === 'markdown') {
    return <div className="widget-markdown"><Markdown>{content}</Markdown></div>;
  }
  return <HtmlPreview display={display} />;
}

export function WidgetDock(props: {
  items: readonly TimelineDisplay[];
  hasWorkers: boolean;
  onDismiss: (id: string) => void;
  onViewAgents: () => void;
}) {
  if (props.items.length === 0) {
    return (
      <section aria-hidden="true">
        {props.hasWorkers && (
          <div className="grid place-items-center pt-6">
            <button type="button" onClick={props.onViewAgents} className="text-[12px] font-medium text-link hover:underline">
              View active agents →
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="grid gap-3">
      {props.items.map(({ job, display }) => {
        return (
          <article key={display.id} className="glass-card widget-enter overflow-hidden">
            <header className="flex items-start justify-between gap-3 px-4 pb-2.5 pt-3.5">
              <div className="min-w-0">
                <h2 className="truncate text-[13px] font-semibold leading-5 text-ink">{display.title}</h2>
                <p className="mt-0.5 text-[11px] text-dimmer">{new Date(job.createdAt).toTimeString().slice(0, 5)}</p>
              </div>
              <button
                type="button"
                aria-label={`Dismiss ${display.title}`}
                onClick={() => props.onDismiss(display.id)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] text-dimmer transition-colors duration-150 hover:bg-black/[0.05] hover:text-ink"
              >
                ×
              </button>
            </header>
            <div className="border-t border-black/[0.05]">
              <DisplayContent display={display} />
              {display.caption && <div className="widget-caption"><Markdown>{display.caption}</Markdown></div>}
              {display.links.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-black/[0.05] p-3">
                  {display.links.map((link, index) => (
                    <button
                      key={`${link.url}-${index}`}
                      type="button"
                      onClick={() => openExternal(link.url)}
                      className="min-h-9 rounded-full bg-link/10 px-3.5 py-1.5 text-left text-[12px] font-medium text-link transition-colors duration-150 hover:bg-link/15"
                    >
                      {link.label} <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
