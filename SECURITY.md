# Security policy

## Supported version

Security fixes are made on the latest published release. Older published releases are not maintained release lines.

## Game security boundary

Public HTTP and WebSocket input is untrusted. The Worker enforces HTTPS/host handling through the shared shell, validates the gameplay room, rejects cross-origin socket upgrades, bounds request/message handling, applies response security headers, and keeps competitive authority on the server.

The Room Durable Object decides movement, score, prey consumption, combat, death/respawn and round state. Client prediction and presentation cannot author those values.

Player name, skin, best score and settings stay in browser-local storage. They are not sent as a server profile or client telemetry stream.

Repository checks scan tracked files and reachable Git history for credential patterns without printing matched values. Real credentials must stay in GitHub or provider secret storage.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository. Include the affected route or component, reproduction steps, expected impact and any suggested containment. Do not include real credentials or production data in the report.

Do not use public issues or running game endpoints to report a vulnerability.
