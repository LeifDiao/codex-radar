# Security

Codex Radar reads local Codex session logs and renders local HTML reports.

## Reporting Issues

If you find a security issue, please open a private report through GitHub security advisories when available, or contact the maintainer through the GitHub profile linked in this repository.

## Scope

Security-sensitive areas include:

- accidental exposure of private prompt content
- unsafe handling of local paths
- unexpected network access
- report HTML injection bugs

Codex Radar intentionally avoids network calls and escapes report content before rendering HTML.
