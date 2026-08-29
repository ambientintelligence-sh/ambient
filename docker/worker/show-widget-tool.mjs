import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const MAX_HTML_LENGTH = 120_000;

export function createShowWidgetTool(emit) {
  return defineTool({
    name: 'show_widget',
    label: 'Show Widget',
    description:
      'Present a polished visual result on the user’s dashboard. Use once near completion when structured visual content would be more useful than voice alone. Provide a self-contained HTML fragment with inline CSS; JavaScript, forms, and external app behavior are not supported.',
    parameters: Type.Object({
      title: Type.String({
        minLength: 1,
        maxLength: 120,
        description: 'Short human-readable title for the dashboard panel.',
      }),
      html: Type.String({
        minLength: 1,
        maxLength: MAX_HTML_LENGTH,
        description: 'Self-contained semantic HTML fragment. Use inline CSS or a style tag. Do not include scripts, forms, iframes, or event handlers.',
      }),
    }),
    async execute(_id, params) {
      const title = params.title.trim().slice(0, 120);
      const html = params.html.trim().slice(0, MAX_HTML_LENGTH);
      emit({ type: 'display', title, html });
      return {
        content: [{
          type: 'text',
          text: 'The visual result is ready and will appear on the dashboard when this task finishes.',
        }],
        details: { title, htmlLength: html.length },
      };
    },
  });
}
