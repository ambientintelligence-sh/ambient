Shared task creation standard (applies to every task):
- Every task must be atomic: exactly one primary action.
- Keep `taskTitle` imperative, specific, and under 12 words.
- Do not combine multiple actions with "and", commas, or slash-separated steps.
- `taskDetails` must use this exact structure:
  Rough thinking:
  - 1-3 bullets on why this task matters and key assumptions.
  Rough plan:
  - 2-4 high-level steps or options (not rigid implementation steps).
  - Prefer uncertainty-aware wording when information is incomplete.
  Questions for user:
  - 1-3 clarification questions that unblock execution.
  - If none, write: `- None right now.`
  Done when:
  - 1-3 measurable completion criteria.
  Constraints:
  - Names, dates, scope boundaries, and non-goals from context.
- Preserve concrete facts from transcript and user intent.
- If critical details are missing, state assumptions explicitly.
