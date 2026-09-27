# Security model

## Protected assets

The primary assets are the integrity of public evidence, availability within the fixed spend ceiling, the authoritative game state, operator controls, and the limited player profile data. The service has no account, password, payment, or email store.

## Trust boundaries

- Public HTTP and WebSocket input is untrusted. Body size, message size, origin, name, room, rate, and event type are enforced server-side.
- Operator routes require TLS and constant-time Basic credential verification against platform secrets.
- Browser controls include CSP, HSTS, frame denial, MIME sniffing denial, referrer policy, and Permissions Policy.
- Durable Objects own authoritative state. The browser predicts presentation but cannot authoritatively set score or simulation state.
- Production credentials stay in Cloudflare and GitHub protected-environment secrets. Tracked configuration contains names and limits, never secret values.

## Intentional disclosures and limitations

Logs, incidents, spend, and control receipts are public by design and are redacted before publication. One person holds all operational roles, so segregation of duties is not claimed. The Latin profanity list does not claim semantic moderation for every script.

Repository vulnerabilities use GitHub private vulnerability reporting as described in `SECURITY.md`; running-service reports use the product intake documented by the OpenAPI surface.
