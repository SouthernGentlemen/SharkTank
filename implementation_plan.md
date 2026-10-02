# Implementation plan

## Owner direction — release the accepted full-3D build as product v2.0.0

The owner wants the current accepted full-3D SharkTank build released while keeping the product semantic version at **v2.0.0**.

The existing immutable `v2.0.0` tag points to an older accepted commit and must not be moved, deleted, recreated, or retargeted. The failed historical `v3.0.0` tag/Release also remains immutable history. The release must therefore separate **product version** from **release revision identity** while preserving exact-commit release/deployment proof.

Work only the first open task. Keep this queue current/future only.

The permanent empty-queue rule that authorized this plan-only refill states: `The queue is empty. Select no implementation task.` That sentence describes the pre-change state only; ST-137 below is now the operative first open task.

## Open tasks

### ST-137 — [OPS] Release the accepted full-3D build as a v2.0.0 revision

**Goal**

Publish and deploy the exact accepted full-3D `main` through the protected release path while the public product version remains `v2.0.0`.

**Release identity model**

- Keep root `package.json` and root `package-lock.json` at product version `2.0.0`.
- Introduce the smallest tracked release-revision authority needed to create one new immutable revision tag for this release without changing product SemVer.
- Use a revision-tag form derived from `v2.0.0` and a monotonic revision number, e.g. `v2.0.0-r1`; if that exact revision already exists at execution time, select the next unused revision rather than rewriting history.
- The revision tag is the exact immutable artifact/deployment identity. The public product identity remains `v2.0.0`.
- Existing `v2.0.0` and `v3.0.0` tags and GitHub Releases remain untouched.

**Scope**

- Extend release-tag planning so ordinary changes with unchanged product version still no-op unless the controlled release-revision authority advances.
- Require a revision advance to create exactly one annotated immutable revision tag at the exact accepted merge commit.
- Extend release identity/publication guards to accept the revision-tag form only when its base version matches root package/lock product version.
- Preserve exact accepted-main SHA, annotated-tag, ancestry, release-before-deploy, protected-environment, and zero-bypass guarantees.
- Keep the deployed/public `SHARKTANK_RELEASE` value equal to `v2.0.0`; pass the immutable revision separately (for example `SHARKTANK_RELEASE_REVISION`) so `/version.json` can prove both product version and exact deployed revision.
- Publish one GitHub Release for the immutable revision tag.
- Deploy only through the existing protected `production` environment. Never bypass approval.
- Verify the authenticated Cloudflare deployment is serving the exact uploaded revision at 100%.
- When public HTTP is reachable, verify `/version.json` reports product `v2.0.0` plus the exact revision and verify `/play/` serves the accepted R3F-only full-3D build/assets.
- If the protected production environment requires manual approval, stop at that gate and report it rather than weakening protection.

**Non-goals**

- No product-version bump.
- No retagging or deleting `v2.0.0` or `v3.0.0`.
- No DNS, secret, Durable Object name, migration-tag, schema, or protocol changes.
- No alternate emergency deployment path.
- No direct deployment from an untagged commit.

**Acceptance**

- Root package and lock remain `2.0.0`.
- One new annotated immutable `v2.0.0-rN` revision tag points to the exact accepted release commit.
- GitHub Release, revision tag, accepted-main SHA, and deployed artifact revision agree exactly.
- Public product identity remains `v2.0.0`.
- Existing `v2.0.0` and `v3.0.0` tag targets remain unchanged.
- Exact-head CI, post-merge CI, release verification/publication, and deployment gates are green, except an explicit protected-environment approval may remain as the only blocker.
