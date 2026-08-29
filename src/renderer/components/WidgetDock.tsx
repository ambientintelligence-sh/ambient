import type { Worker } from '@/shared/worker';

const documentFor = (html: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:;">
  <base target="_blank">
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 18px; background: #07090c; color: #eef2f6; font-size: 13px; line-height: 1.45; }
    h1, h2, h3, p { margin-top: 0; }
    a { color: #70adff; }
    img { max-width: 100%; height: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 7px 8px; border-bottom: 1px solid rgba(255,255,255,.1); text-align: left; }
  </style>
</head>
<body>${html}</body>
</html>`;

export function WidgetDock(props: {
  workers: readonly Worker[];
  onDismiss: (id: string) => void;
}) {
  return (
    <section className="shrink-0">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="label-xs text-warn">AGENT WIDGETS</span>
        <span className="label-xs text-dimmer">GENERATED RESULTS</span>
      </div>
      <div className="app-scroll flex gap-3 overflow-x-auto pb-2">
        {props.workers.map((worker) => {
          const display = worker.display!;
          return (
            <article
              key={display.id}
              className="flex h-[210px] w-[420px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#07090c] shadow-lg"
            >
              <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="label-xs text-warn">{worker.name}</p>
                  <h2 className="mt-1 truncate text-sm font-medium text-ink">{display.title}</h2>
                </div>
                <button
                  type="button"
                  aria-label={`Dismiss ${display.title}`}
                  onClick={() => props.onDismiss(display.id)}
                  className="ml-3 rounded-full px-2 py-1 text-sm text-dimmer hover:bg-white/5 hover:text-ink"
                >
                  ×
                </button>
              </header>
              <iframe
                title={display.title}
                sandbox=""
                srcDoc={documentFor(display.html)}
                className="min-h-0 flex-1 border-0 bg-[#07090c]"
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
