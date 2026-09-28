# Security policy

## Supported version

Security fixes are made on the latest published release. Older published releases are not maintained release lines.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting feature for this repository. Include the affected route or component, reproduction steps, expected impact, and any suggested containment. Do not include real credentials or production data.

GitHub private vulnerability reporting is the only supported source-repository vulnerability intake. Do not use public issues or running-service endpoints to report source vulnerabilities.

Canonical `npm run check` includes a bounded scan of tracked files and reachable
Git history for credential patterns. It reports only the path/object and finding
type, not matched values. The empty `.env.example` template, explicit
`test-`/`fake-`/`example` values, and source identifiers or regex syntax are
documented noncredential examples; pure cases cover current and older data.
