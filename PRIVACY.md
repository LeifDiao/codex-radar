# Privacy

Codex Radar is designed to run locally.

## Data Read

The plugin reads local Codex history and project metadata:

- `~/.codex/sessions/**/*.jsonl`
- `~/.codex/archived_sessions/*.jsonl`
- `~/.codex/session_index.jsonl`
- metadata in the project working directory, such as whether `AGENTS.md`, `.git`, `.codex`, or test folders exist

## Data Written

The plugin writes local reports:

- `~/.codex-radar/temp/*.json`
- `~/.codex-radar/reports/*.html`

## Network

Codex Radar does not make network calls, does not require an API key, and does not upload telemetry.

## Report Contents

Reports may include short snippets from your own prompts as evidence. Treat generated report files as private unless you intentionally share them.
