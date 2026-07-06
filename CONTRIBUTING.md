# Contributing

Contributions are welcome.

## Development checks

Run these before opening a pull request:

```bash
# Validate the plugin manifest against the Codex plugin-creator schema
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/codex-radar

# Syntax-check the scripts
for f in plugins/codex-radar/skills/analyze/scripts/*.mjs; do node --check "$f"; done

# Run the fixture test suite (parser across both rollout formats, classifiers, renderer)
node --test tests/*.test.mjs
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

Then start a new thread so Codex picks up the updated skill. For parser changes, test at least one small project, one long-running project, and (if you have them) one `codex exec` automation project — and keep the fixture tests green.

## Design principles

- Keep the plugin local-first — no network calls, no API key.
- Keep the facts parser deterministic (same input → same facts, same `computedBaselines`); the Codex model only applies the bounded adjustment and writes the diagnosis/suggestions.
- Message classifiers and proof/exit-code extractors live in `signals.mjs` — changes there must pass the labeled set in `tests/classifier.test.mjs`.
- Avoid external dependencies unless they remove meaningful complexity.
- Do not print raw session logs in normal output.
- Make scoring changes explainable in `data/rubric.json` or parser comments, and update the methodology docs to match.
