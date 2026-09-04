import path from 'node:path';
import type { AgentArtifact, WorkerStop } from '../shared/worker';

export function detailOf(args: unknown) {
  if (!args || typeof args !== 'object') return '';
  const input = args as Record<string, unknown>;
  const raw = input.command ?? input.path ?? input.file_path ?? input.pattern ?? input.query ?? '';
  const text = String(raw).replace(/\s+/g, ' ').trim();
  return text.length > 72 ? `${text.slice(0, 71)}...` : text;
}

export function resultOf(result: unknown) {
  const value = result as { content?: { type?: string; text?: string }[] } | undefined;
  const text = (value?.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 240 ? `${text.slice(0, 239)}...` : text;
}

export function artifactOf(tool: string, args: unknown, workspace: string | null): AgentArtifact | null {
  if (!workspace || (tool !== 'write' && tool !== 'edit')) return null;
  if (!args || typeof args !== 'object') return null;
  const input = args as Record<string, unknown>;
  const candidate = input.path ?? input.file_path;
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const absolute = path.resolve(workspace, candidate);
  const relative = path.relative(workspace, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return { path: absolute, tool };
}

export function completeStop(stops: readonly WorkerStop[], id: string, result: string, isError: boolean) {
  return stops.map((stop) => stop.id === id
    ? { ...stop, status: isError ? 'error' as const : 'done' as const, result: result || (isError ? 'Tool failed.' : 'Completed.') }
    : stop);
}
