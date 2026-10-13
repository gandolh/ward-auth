# Ward on its own subdomain

Captured 2026-10-13. The owner may move Ward to a subdomain later. The OIDC
design ([decisions-oidc.md](../wiki/decisions-oidc.md)) already allows it:
the issuer, redirect URIs and Ward's UI base path are configuration, and local
development runs Ward on its own origin.

What the move would still need: a DNS record, a Caddy site block in vps-deploy,
`WARD_OIDC_ISSUER` changed in every app's env, the redirect URIs re-registered
if any are absolute, and Ward's UI built for `/` instead of `/ward`. Not
briefed until the owner asks.
