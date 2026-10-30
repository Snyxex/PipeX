# PipeX AI agent skills

These are repository-local, versioned instructions for coding assistants using PipeX. They are not executable and do not automatically become part of the npm package (the npm tarball includes runtime output and selected public documentation, not repository-local skills).

## Skill catalog

### Start & API

- [getting-started](getting-started/SKILL.md)
- [api-reference-navigation](api-reference-navigation/SKILL.md)
- [pipex-core](pipex-core/SKILL.md)
- [configuration](configuration/SKILL.md)

### Transformation

- [binary-transformations](binary-transformations/SKILL.md)
- [file-processing](file-processing/SKILL.md)
- [streaming](streaming/SKILL.md)
- [compression](compression/SKILL.md)
- [hashing-integrity](hashing-integrity/SKILL.md)

### Security

- [encryption](encryption/SKILL.md)
- [kms-providers](kms-providers/SKILL.md)
- [validation-schemas](validation-schemas/SKILL.md)
- [security-review](security-review/SKILL.md)

### Plugins & runtime

- [pipex-plugin-development](pipex-plugin-development/SKILL.md)
- [performance-worker-pools](performance-worker-pools/SKILL.md)
- [retries-cancellation](retries-cancellation/SKILL.md)
- [failure-sinks](failure-sinks/SKILL.md)

### Integration & operations

- [transport-integration](transport-integration/SKILL.md)
- [observability](observability/SKILL.md)
- [error-handling](error-handling/SKILL.md)
- [troubleshooting](troubleshooting/SKILL.md)

### Quality

- [testing-examples](testing-examples/SKILL.md)
- [migration-compatibility](migration-compatibility/SKILL.md)
- [pipex-release-review](pipex-release-review/SKILL.md)

## How agents should use these skills

1. Read [AGENTS.md](../AGENTS.md) for routing and repository rules.
2. Select the skill whose description matches the task; load `skills/<name>/SKILL.md` before generating code.
3. For API questions, always consult [api-reference-navigation](api-reference-navigation/SKILL.md) and the checked-out source.
4. Confirm the installed PipeX version and public exports; never rely solely on skill prose.
5. Run applicable tests and report results accurately. Do not publish packages or change CI without authorization.

### Agent compatibility

- **Codex / AGENTS.md readers:** start at [AGENTS.md](../AGENTS.md), which points to this catalog. Tools with native skill discovery may need configuration to index this folder.
- **Claude Code:** use [CLAUDE.md](../CLAUDE.md) as a project entrypoint; manually load the relevant skill files if the tool does not discover repository-local skills.
- **Other coding agents:** read [AGENTS.md](../AGENTS.md) and the Markdown skill files as normal repository documentation. Automatic loading is tool-specific, not guaranteed.

## Verification

Run `node scripts/validate-ai-skills.mjs` to check catalog coverage, required frontmatter and local Markdown links. Jenkins can execute the same command. This structural check does not prove that every code example or API statement is correct.
