# Implementation plan

## Open tasks

### ST-099 — [OPS] Enable verified repository auto-merge

- Dependency: ST-098 plan-only queue publication has merged; preserve the current protected-main, CI, release, and deployment authorities.
- Why: GitHub currently disallows per-PR auto-merge even though required exact-head checks and squash-only controls can gate it.
- Scope: Commit `allowAutoMerge: true` in the repository settings authority; compare live `allow_auto_merge` in the read-only verifier, include it in the bounded apply payload, and add a pure drift case. Document that repository auto-merge availability does not enroll individual PRs. Preserve current merge methods, strict current-with-main checks, bypass actors, automatic completed-branch deletion, and immutable release tags. Retire this task into the shared permanent empty queue.
- Non-goals: Do not auto-enroll unrelated PRs, change required check names, create a release, deploy production, or alter application behavior.
- Acceptance: Focused tests reject disabled auto-merge; canonical check and exact-head CI pass; live `allow_auto_merge` is true after independent readback; squash-only/current-main protection and release tags remain unchanged; one ST-099 squash commit lands on main with green post-merge CI and branch cleanup. After exact-head CI is green, apply the committed auto-merge setting and independently re-read the provider state.
- Validation: Pinned npm ci, focused settings cases, canonical credential-free check, separate advisory gate when applicable, committed-range whitespace check, exact-head required CI, live settings verification, post-merge CI, history and branch cleanup.
- Authorities: AGENTS.md, README.md, config/github-repository-settings.json, repository settings verifier/apply scripts and pure cases, current GitHub repository settings and rulesets.
