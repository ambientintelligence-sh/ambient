import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const MAX_TEXT_LENGTH = 120_000;
const MAX_IMAGE_BYTES = 5_000_000;
const IMAGE_MIME = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function imageSource(input) {
  if (/^https:\/\//i.test(input) || /^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(input)) return input;

  const absolute = resolve('/work', input);
  if (absolute !== '/work' && !absolute.startsWith('/work/')) {
    throw new Error('Image files must be inside the shared /work workspace.');
  }
  const mime = IMAGE_MIME[extname(absolute).toLowerCase()];
  if (!mime) throw new Error('Image must be PNG, JPEG, WebP, or GIF.');
  const metadata = await stat(absolute);
  if (metadata.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 5 MB widget limit.');
  const data = await readFile(absolute);
  return `data:${mime};base64,${data.toString('base64')}`;
}

export function createShowWidgetTool(emit) {
  return defineTool({
    name: 'show_widget',
    label: 'Show Widget',
    description: [
      'Add one result to the user’s scrolling timeline.',
      'Prefer format="markdown" for normal results, comparisons, lists, and tables; keep it concise and mobile-friendly.',
      'Use format="html" only when custom visual layout materially helps, and keep the HTML simple, responsive, and free of fixed widths or oversized typography.',
      'Use format="image" for screenshots or image results. Pass an HTTPS URL, data URL, or a screenshot file saved inside /work.',
      'For map or place results, prefer a useful screenshot with a very short caption and an explicit Google Maps link instead of a long itinerary.',
      'Add links for actions the user can open, such as directions, a source, booking, or a result page. Only HTTP(S) links are accepted.',
      'To refine a widget later, reuse the same widgetId and it will be replaced in place. Omit widgetId to append a new timeline item.',
      'JavaScript, forms, iframes, and event handlers are not supported.',
    ].join(' '),
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 120, description: 'Short title shown above the timeline item.' }),
      widgetId: Type.Optional(Type.String({ minLength: 1, maxLength: 80, pattern: '^[a-zA-Z0-9_-]+$', description: 'Stable ID to update this widget on a later call. Reuse it to replace; omit it to append.' })),
      format: Type.Optional(Type.Union([
        Type.Literal('markdown'),
        Type.Literal('html'),
        Type.Literal('image'),
      ], { description: 'Content format. Defaults to html for legacy html calls, otherwise markdown.' })),
      content: Type.Optional(Type.String({ minLength: 1, maxLength: 7_000_000, description: 'Markdown, HTML, image URL/data URL, or a /work-relative image path.' })),
      html: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH, description: 'Legacy HTML field. Prefer format and content for new calls.' })),
      alt: Type.Optional(Type.String({ maxLength: 300, description: 'Accessible description for image content.' })),
      caption: Type.Optional(Type.String({ maxLength: 2_000, description: 'Optional short Markdown caption, especially useful beneath an image. Keep it to the key takeaway or a few steps.' })),
      links: Type.Optional(Type.Array(Type.Object({
        label: Type.String({ minLength: 1, maxLength: 60 }),
        url: Type.String({ minLength: 8, maxLength: 2_000, pattern: '^https?://' }),
      }), { maxItems: 4, description: 'Tappable external actions or sources. Prefer one primary link.' })),
    }),
    async execute(_id, params) {
      const title = params.title.trim().slice(0, 120);
      const format = params.format ?? (params.html ? 'html' : 'markdown');
      const supplied = (params.content ?? params.html ?? '').trim();
      if (!supplied) throw new Error('Widget content is required.');

      const content = format === 'image' ? await imageSource(supplied) : supplied.slice(0, MAX_TEXT_LENGTH);
      const alt = params.alt?.trim().slice(0, 300) || null;
      const widgetId = params.widgetId?.trim() || null;
      const caption = params.caption?.trim().slice(0, 2_000) || null;
      const links = (params.links ?? []).map(({ label, url }) => ({
        label: label.trim().slice(0, 60),
        url: url.trim().slice(0, 2_000),
      })).filter(({ label, url }) => label && /^https?:\/\//i.test(url));
      emit({ type: 'display', widgetId, title, format, content, alt, caption, links });
      return {
        content: [{ type: 'text', text: widgetId
          ? `The ${format} widget “${widgetId}” was added or updated in the timeline.`
          : `The ${format} result was added to the timeline.` }],
        details: { widgetId, title, format, contentLength: content.length, linkCount: links.length },
      };
    },
  });
}
