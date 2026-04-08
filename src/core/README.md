# Core Module Layout

- `agents/`: Agent execution and orchestration.
- `analysis/`: Summary/task analysis prompts and task-size classification.
- `audio/`: Audio helpers, VAD logic, and audio module re-exports.
- `db/`: SQLite access layer and schema.
- `text/`: Text normalization and related helpers.
- `transcription/`: Transcription utilities.
- Root files (`session.ts`, `types.ts`, `language.ts`, etc.): shared orchestration and cross-domain contracts.
