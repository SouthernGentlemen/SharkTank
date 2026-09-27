# Change management

Git and GitHub are the authority for SharkTank implementation history. Human-controlled changes use the next sequential `ST-###` identifier, one WG-ARCH-001 §16 type, and the structured body required by `AGENTS.md`. Each accepted ST change lands as one non-merge controlled commit on `main`; feature branches remain one controlled commit and are squash-merged when necessary. Published commits and tags are immutable; corrections move forward as new controlled changes.

## Repository acceptance

```sh
npm ci
npm run check
```

`npm run check` is the complete credential-free acceptance gate. It covers TypeScript, tests, the production build, controlled-change policy, sequential history, reconstruction provenance, local public information architecture and evidence HTTP acceptance, GitHub-settings comparison tests, pure dependency-advisory policy cases, and patch whitespace. `npm run audit:dependencies` is the separate live network advisory gate required by CI and release verification.

Pull-request CI supplies event metadata to that same gate and performs the locked install, `npm run check`, and the separate network advisory gate.

## Implementation queue lifecycle

`implementation_plan.md` is a temporary current/future queue, not a historical ledger. While it exists, the first task is the only selectable task; an unmet dependency blocks the queue and must not be bypassed. The controlled change that delivers a task removes that task in the same commit. If no task headings remain, that same delivery deletes the plan rather than leaving an empty placeholder.

If the plan is absent, `do needful` enters fresh planning mode: re-read authoritative repository and provider state, create a new dependency-ordered task wave, and end the turn without starting its first task. Git, pull requests, CI, tags, releases, and provider evidence remain the historical record.

## Provenance exception data

`docs/history/CHANGE-MAP.csv` and `docs/history/NESTED-SOURCE-MAP.csv` are exact validator inputs for imported source lineage. They are not a changelog, release archive, roadmap, or forward implementation ledger. New controlled changes do not add provenance rows merely to duplicate Git history.

## Provider settings

Expected GitHub merge and ruleset configuration is committed in `config/github-repository-settings.json`. SharkTank's repository-specific delivery policy is squash-only so each accepted ST change remains one controlled commit on `main`; merge commits and rebase merges are disabled. `npm run verify:github-settings` is the read-only provider-authenticated verifier. `npm run apply:github-settings` is the explicit administrative mutation path.

Provider administration, release publication, and production deployment remain separate from the credential-free repository gate.
