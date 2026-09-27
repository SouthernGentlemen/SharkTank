## Change

<!-- What changed? -->

## Reason

<!-- Why is this needed? -->

## Impact

<!-- What behavior or evidence changes? -->

## Risk

<!-- Rate the delivery risk. -->

## Controls

<!-- Name the boundaries, safeguards, or rollback controls. -->

## Validation

- [ ] `npm ci`
- [ ] Focused tests for every touched area
- [ ] `npm run check`
- [ ] `npm run audit:dependencies`
- [ ] `git diff --check`
- [ ] `npm run verify:github-settings` when repository settings or rulesets changed
- [ ] `npm run check:evidence -- http://127.0.0.1:8787` when public evidence or MVP routes changed
- [ ] No credentials, production exports, or private identifiers were added

## Evidence

<!-- Link or describe exact-head CI and focused acceptance evidence. -->

## Source

<!-- List the plan task and authoritative files used. -->

## Release

<!-- State whether this creates a tag or GitHub Release. -->

## Release/deployment effect

<!-- State the production deployment effect. -->
