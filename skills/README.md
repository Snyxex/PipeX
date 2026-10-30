# PipeX AI agent skills

Repository-local, version-controlled skills for AI coding agents.

| Skill | Purpose |
| --- | --- |
| [pipex-core](pipex-core/SKILL.md) | Integrate the PipeX data engine safely |
| [pipex-plugin-development](pipex-plugin-development/SKILL.md) | Implement and test plugins |
| [pipex-release-review](pipex-release-review/SKILL.md) | Review changes and npm artifacts |

Each skill has a YAML frontmatter with `name` and `description`, followed by task-specific instructions. Agents that support the `SKILL.md` convention can load them; others can read these files as ordinary Markdown. The skill files are not executable and do not install dependencies.

These instructions must be checked against the API and source at the currently selected commit. Do not treat them as a substitute for tests.
