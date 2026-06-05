# Contributing

Contributions are welcome.

## Development checks

Run these before opening a pull request:

```bash
# Validate the plugin manifest against the Codex plugin-creator schema
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/codex-radar

# Syntax-check the scripts
node --check plugins/codex-radar/skills/analyze/scripts/lib.mjs
node --check plugins/codex-radar/skills/analyze/scripts/list-codex-projects.mjs
node --check plugins/codex-radar/skills/analyze/scripts/parse-codex-project.mjs
node --check plugins/codex-radar/skills/analyze/scripts/render-report.mjs
```

## Testing locally

Run the scripts directly against your own Codex history:

```bash
node plugins/codex-radar/skills/analyze/scripts/list-codex-projects.mjs --cwd "$PWD"
node plugins/codex-radar/skills/analyze/scripts/parse-codex-project.mjs "$PWD"
node plugins/codex-radar/skills/analyze/scripts/render-report.mjs ~/.codex-radar/temp/<report>.json
```

To test the installed experience, add this repo as a marketplace and reinstall:

```bash
codex plugin marketplace add .
codex plugin add codex-radar@codex-radar-marketplace
```

Then start a new thread so Codex picks up the updated skill. For parser changes, test at least one small project and one long-running project.

## Design principles

- Keep the plugin local-first — no network calls, no API key.
- Keep the facts parser deterministic (same input → same facts); the Codex model does the scoring + diagnosis from facts + rubric.
- Avoid external dependencies unless they remove meaningful complexity.
- Do not print raw session logs in normal output.
- Make scoring changes explainable in `data/rubric.json` or parser comments, and update the methodology docs to match.
