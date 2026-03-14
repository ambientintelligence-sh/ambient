# Prompt Files

All model prompts are editable Markdown files in this folder.

Rules:
- Keep placeholders in `{{double_braces}}` unchanged unless you also update code.
- You can rewrite wording, examples, and policy guidance around placeholders.
- Empty prompt files fall back to built-in defaults.

## Files

- `summary/system.md`
- `insights/system.md`
- `analysis/request.md`
- `task/extract.md`
- `task/from-selection.md`
- `task/shared.md`
- `task/size-classifier.md`
- `agent/system.md`
- `agent/initial-user.md`
- `transcription/audio-auto.md`
- `transcription/audio-source-target.md`
- `transcription/post-process.md`
- `transcription/paragraph-decision.md`

## Placeholders

- `analysis/request.md`
  - `{{summary_system_prompt}}`
  - `{{insights_system_prompt}}`
  - `{{transcript}}`
  - `{{previous_key_points_section}}`
- `task/extract.md`
  - `{{transcript}}`
  - `{{existing_tasks_section}}`
  - `{{historical_suggestions_section}}`
  - `{{task_creation_shared_rules}}`
- `task/from-selection.md`
  - `{{selected_text}}`
  - `{{user_intent_section}}`
  - `{{existing_tasks_section}}`
  - `{{task_creation_shared_rules}}`
- `task/shared.md`
  - (no placeholders)
- `task/size-classifier.md`
  - `{{task_text}}`
- `agent/system.md`
  - `{{today}}`
  - `{{transcript_context}}`
- `agent/initial-user.md`
  - `{{task}}`
  - `{{context_section}}`
- `transcription/audio-auto.md`
  - `{{summary_block}}`
  - `{{context_block}}`
  - `{{lang_list}}`
  - `{{code_list}}`
  - `{{translate_rule}}`
  - `{{source_lang_name}}`
  - `{{target_lang_name}}`
- `transcription/audio-source-target.md`
  - `{{summary_block}}`
  - `{{context_block}}`
  - `{{source_lang_name}}`
  - `{{target_lang_name}}`
  - `{{english_note}}`
- `transcription/post-process.md`
  - `{{summary_block}}`
  - `{{context_block}}`
  - `{{transcript}}`
  - `{{detected_lang_hint}}`
  - `{{translation_rule}}`
- `transcription/paragraph-decision.md`
  - `{{transcript}}`
