# Implementation plan

## Owner direction — recover the failed ST-132 release under v2.0.0

The owner has corrected the ST-132 release identity: the full-3D SharkTank product remains **v2.0.0**. The attempted v3.0.0 publication is not the intended product version.

Recovery must preserve the repository's immutable release history. Do not move, delete, recreate, or retarget the existing `v2.0.0` or `v3.0.0` tags. Do not weaken tag protection, branch protection, protected-environment approval, or exact-head release/deployment guards.

Work only the first open task. Keep this queue current/future only.

The permanent empty-queue rule that authorized this plan-only refill states: `The queue is empty. Select no implementation task.` That sentence describes the pre-change state only; ST-135 below is now the operative first open task.

## Open tasks

### ST-135 — [FIX] Restore the v2.0.0 release identity after the failed ST-132 publication

**Goal**

Reconcile repository and release automation back to the owner-approved `v2.0.0` product identity without rewriting immutable release history or triggering another unintended release.

**Known failure evidence**

- ST-132 advanced the root package and lockfile to `3.0.0`.
- The resulting `v3.0.0` tag and GitHub Release were published.
- Production deployment later failed its public identity check because `/version.json` reported `v2.0.0` while the workflow expected `v3.0.0`.
- The existing `v2.0.0` tag predates ST-132 and is immutable, so recovery must not retarget it to current `main`.

**Scope**

- Restore root `package.json` and root `package-lock.json` package identity to `2.0.0`.
- Restore current-state tests and documentation that ST-132 changed to assert `3.0.0`, keeping unrelated full-3D acceptance evidence intact.
- Harden release-tag planning with the narrowest repository-controlled reconciliation rule needed so restoring an already-published lower product version cannot attempt to recreate or move that immutable tag. The reconciliation path must require the target version's annotated tag to already exist in current ancestry and must emit no new release tag/output.
- Add or update focused tests proving ordinary release versions still must increase and that only the guarded existing-tag reconciliation is a no-op.
- Preserve the existing `v2.0.0` and `v3.0.0` tags and GitHub Releases as immutable historical provider records. Do not delete, retarget, or rewrite them.
- Do not trigger a production deployment from this repair. If current provider/public state is not safely reconcilable without bypassing a protected gate, stop and report the exact blocker.
- After merge, require post-merge CI green and the Release Tag workflow green as a no-op with no new tag, GitHub Release, or deployment dispatch.

**Acceptance**

- Current `main` declares `2.0.0` consistently in root package metadata and the current-state assertions/docs touched by ST-132.
- Exact-head CI and post-merge CI are green.
- Existing immutable `v2.0.0` and `v3.0.0` tag targets are unchanged.
- No new semantic release tag or GitHub Release is created by the repair.
- The merged-main Release Tag run completes successfully as a guarded no-op.
- Public `/version.json` remains/reports `v2.0.0`; no claim is made about a successful new production deployment unless a later owner-directed release/deployment task explicitly authorizes one.
