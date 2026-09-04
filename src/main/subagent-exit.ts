export function subagentExitError(code: number | null, stderr: string) {
  if (code === 0) return null;
  return stderr.trim() || `Subagent exited with code ${code}`;
}
