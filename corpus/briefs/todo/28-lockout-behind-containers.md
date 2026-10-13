# Brief 28 — The login lockout must see the real client behind a container

## Context

Found on 2026-10-13 while adopting the shared library in prm (brief 24), and
confirmed against the local Ward container. Five failed logins with five
different usernames, then a sixth attempt with a different username and its own
`X-Forwarded-For`, got `429 too_many_attempts` for 900 seconds. **The whole
internet shares one lockout bucket.**

Why: `lockoutKeyFor` (`api/src/auth/lockout.ts`, and its port in
`shared-library/src/core/lockout.ts`) honours `X-Forwarded-For` only when the
socket peer is loopback. That was true when Ward ran under pm2 on the host
([decisions-implementation.md](../../wiki/decisions-implementation.md), "The
lockout is keyed on the forwarded address"). Today every service runs in a
container that publishes `127.0.0.1:<port>`. Host Caddy reaches it through
Docker's proxy, so the peer the service sees is a Docker bridge address, never
loopback. Locally the peer is the Caddy container. The header is then ignored,
and every request is keyed on that one address.

**This is live in production for Ward** (container since the vps-deploy
cutover). Five bad passwords from anyone lock everyone out of Ward's login for
15 minutes. The decision's own text names this outcome as the thing it exists
to prevent. Every app on shared library 0.2.0 inherits the same behaviour.

## Files you OWN

- `api/src/auth/lockout.ts` and its test, `api/src/routes/auth.ts` and
  `api/src/auth/refresh.ts` (only where they call `lockoutKeyFor`),
  `api/src/config.ts`, `.env.example`, `docs/src/content/docs/configuration.mdx`
- `infrastructure/local/compose.yaml` (set the local value)
- `shared-library/src/core/lockout.ts`, its test, `shared-library/src/fastify/plugin.ts`
  (the option), `shared-library/README.md`, `shared-library/CHANGELOG.md`,
  `shared-library/package.json` (version 0.3.0)
- `corpus/wiki/decisions-implementation.md` (a dated revision note on the
  lockout decision), `corpus/log.md`

## What to do

1. **Trusted proxies.** `lockoutKeyFor` takes a list of trusted proxy
   addresses or CIDR ranges (IPv4 and IPv6, including IPv4-mapped IPv6). It
   honours the **last** `X-Forwarded-For` element when the peer is loopback or
   inside a trusted range. Otherwise it uses the peer itself. The default stays
   loopback only, so nothing loosens unless configured.
2. **Ward:** `WARD_TRUSTED_PROXIES` (comma-separated). Fail at boot on a
   malformed entry. Set it in the local compose file to the Caddy container's
   network.
3. **Library:** a `trustedProxies` option on `wardAuth`. When the option is
   absent, the plugin reads `AUTH_TRUSTED_PROXIES` from the environment, so
   apps pick up the fix by re-vendoring with no code change. Document it in the
   adoption guide, and bump to 0.3.0 with a CHANGELOG upgrade note.
4. **Keep the loud failure.** A trusted or loopback peer with no forwarded
   address still fails closed into a shared bucket and warns.
5. **Production value:** the deploy publishes on `127.0.0.1` only, so a
   container's peer is either Docker's proxy on the host or a sibling container
   on the owner's own bridge networks. Recommend the value brief 27 sets
   (Docker's default `172.16.0.0/12` unless the stacks pin another subnet),
   and say how to confirm it on the host.

## Acceptance

- Unit tests:
  - loopback and a trusted range honour the last element;
  - an untrusted peer ignores the header;
  - a spoofed first element is never read;
  - malformed configuration is rejected;
  - IPv4-mapped IPv6 peers match IPv4 ranges.
- Against the rebuilt local container: six bad logins under different
  forwarded addresses do not lock out a seventh caller.
- Ward's suite, typecheck, lint and build pass, and `npm run vendor` still
  writes six files.
