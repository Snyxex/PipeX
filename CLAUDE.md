# PipeX guidance for Claude Code

Follow [AGENTS.md](AGENTS.md) for repository rules and [skills/README.md](skills/README.md) for the complete skill catalog.

When working on an integration, load the relevant `skills/<topic>/SKILL.md` and always consult `skills/api-reference-navigation/SKILL.md` for API correctness. These repository-local files are plain Markdown instructions; Claude Code's automatic skill discovery depends on its configuration. Do not assume that a `skills/` directory alone is auto-discovered.

Prefer exact current source and executable tests over remembered APIs. Use Jenkins, not GitHub Actions, for new CI workflows. Never publish or merge without explicit approval.
