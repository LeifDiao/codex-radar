# Privacy

Codex Radar is designed to run locally.

## Data Read

The plugin reads local Codex history and project metadata:

- `~/.codex/sessions/**/*.jsonl`
- `~/.codex/archived_sessions/*.jsonl`
- `~/.codex/session_index.jsonl`
- metadata in the project working directory, such as whether `AGENTS.md`, `.git`, `.codex`, or test folders exist

## Data Written

The plugin writes local reports and local caches:

- `~/.codex-radar/temp/*.json` — facts and report JSON for the current run
- `~/.codex-radar/reports/*.html` — the rendered dashboards
- `~/.codex-radar/history.jsonl` — one summary line per report run (project name, scores; no message content) so later reports can show trends
- `~/.codex-radar/cache/session-meta.json` — per-file session metadata (cwd, id, source; no message content) so project listing stays fast
- `~/.codex-radar/cache/self-baseline.json` — aggregate per-session metric distributions (counts and ratios only; no message content)

## Network

Codex Radar does not make network calls, does not require an API key, and does not upload telemetry.

## Report Contents

Reports may include short snippets from your own prompts as evidence. Treat generated report files as private unless you intentionally share them.
