import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

export function createExaTools() {
  if (!process.env.EXA_API_KEY) return [];

  return [defineTool({
    name: 'exa_search',
    label: 'Exa Search',
    description:
      'Search the live web with Exa and return relevant pages with concise text extracts. ' +
      'Use for current facts, research, sources, and discovering relevant URLs.',
    parameters: Type.Object({
      query: Type.String({ description: 'Natural-language web search query.' }),
      numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
    }),
    async execute(_id, params, signal) {
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.EXA_API_KEY,
        },
        body: JSON.stringify({
          query: params.query,
          type: 'auto',
          numResults: params.numResults ?? 5,
          contents: { text: { maxCharacters: 1800 } },
        }),
        signal,
      });
      if (!response.ok) throw new Error(`Exa search failed (${response.status}): ${await response.text()}`);
      const payload = await response.json();
      const results = Array.isArray(payload.results) ? payload.results : [];
      const output = results.map((result, index) => [
        `${index + 1}. ${result.title || '(untitled)'}`,
        result.url || '',
        result.publishedDate ? `Published: ${result.publishedDate}` : '',
        String(result.text || '').replace(/\s+/g, ' ').trim().slice(0, 1800),
      ].filter(Boolean).join('\n')).join('\n\n');
      return {
        content: [{ type: 'text', text: output || 'No Exa results found.' }],
        details: { resultCount: results.length },
      };
    },
  })];
}
