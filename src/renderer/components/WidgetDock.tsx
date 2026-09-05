import { LiveActivityCard } from './LiveActivityCard';
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
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; --foreground: #283438; --secondary: #5e6d73; --accent: #536b86; --surface: #e8edee; background: var(--surface); }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 4px 22px 20px; background: transparent; color: var(--foreground); font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
    h1, h2, h3 { margin: 0 0 10px; font-size: 1.1em; color: var(--foreground); }
    p { margin: 0 0 10px; }
    p:last-child { margin-bottom: 0; }
    a { color: var(--accent); }
    img { display: block; max-width: 100%; height: auto; border-radius: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 7px 6px; border-bottom: 1px solid rgba(45,65,75,.12); text-align: left; }
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
        const measured = frame.current?.contentDocument?.body.scrollHeight ?? 180;
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
    return <img src={content} alt={display.alt ?? display.title} className="widget-image" />;
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
      <section>
        {props.hasWorkers && (
          <div className="grid place-items-center pt-6">
            <button type="button" onClick={props.onViewAgents} className="text-[12px] font-medium text-link hover:underline">
              View active agents
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="widget-stack">
      {props.items.map(({ job, display }) => {
        if (display.format === 'activity') return <LiveActivityCard key={display.id} job={job} display={display} onDismiss={() => props.onDismiss(display.id)} />;
        return (
          <article key={display.id} className="result-card widget-enter" data-format={display.format}>
            <header className="result-header">
              <button
                type="button"
                aria-label={`Dismiss ${display.title}`}
                onClick={() => props.onDismiss(display.id)}
                className="card-dismiss"
              >×</button>
              <h2>{display.title}</h2>
              <time dateTime={new Date(display.createdAt).toISOString()}>{new Date(display.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </header>
            <div className="result-content">
              <DisplayContent display={display} />
              {display.caption && <div className="widget-caption"><Markdown>{display.caption}</Markdown></div>}
              {display.links.length > 0 && (
                <div className="result-links">
                  {display.links.map((link, index) => (
                    <button
                      key={`${link.url}-${index}`}
                      type="button"
                      onClick={() => openExternal(link.url)}
                      className="result-link"
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
