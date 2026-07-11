# Codex Radar — plugin payload

This is the plugin installed by the Codex Radar marketplace. For the project overview, install steps, and methodology, see the [repository README](https://github.com/LeifDiao/codex-radar).

## Use

After installing, start a **new thread** and ask:

```text
Run Codex Radar on this project
```

The skill follows a two-layer flow (mirroring Claude Radar) — a deterministic parser extracts the facts, then **your Codex model** scores them and writes the diagnosis:

1. **Detect** — find the current working directory in local Codex session history (`list-codex-projects.mjs`).
2. **Parse → facts** — extract countable signals from the matching `~/.codex/sessions` and `~/.codex/archived_sessions` JSONL into a facts JSON (`parse-codex-project.mjs`). No scoring happens here.
3. **Score + diagnose** — your Codex model reads the facts + `data/rubric.json`, computes each dimension's formula baseline, applies a bounded ±15 evidence-based adjustment, and writes the diagnosis + paste-ready prompts into a report JSON.
4. **Render** — write a single-file HTML dashboard to `~/.codex-radar/reports/` (`render-report.mjs`).

The analysis runs inside your own Codex session — the plugin makes no network calls of its own and needs no separate API key.

## Scripts

| Script | Role |
| --- | --- |
| `scripts/lib.mjs` | Shared helpers: session discovery, JSONL streaming, paths |
| `scripts/list-codex-projects.mjs` | List Codex projects grouped by cwd, with a current-directory match |
| `scripts/parse-codex-project.mjs` | Extract signals and write the **facts** JSON (no scoring) |
| `scripts/render-report.mjs` | Render the model's report JSON to a self-contained HTML file |

## Data

- **Reads:** `~/.codex/sessions`, `~/.codex/archived_sessions`, `~/.codex/session_index.jsonl`
- **Writes:** `~/.codex-radar/temp/*.json`, `~/.codex-radar/reports/*.html`
- **Scoring rubric:** `data/rubric.json` (dimension definitions, baseline formulas, profiles, grades, diagnosis + suggestion specs)
- **Report template:** `viewer/template.html`

`CODEX_HOME` and `CODEX_RADAR_HOME` environment variables override the default locations.

## License

CC-BY-NC-4.0 — free for non-commercial use. See [LICENSE](../../LICENSE).
