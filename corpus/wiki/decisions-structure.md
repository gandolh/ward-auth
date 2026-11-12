---
summary: The server's code structure (2026-11-12) — the code-structure skill adopted with domain modules kept beside the features, zod response schemas on every JSON route, request schemas on the 24 plain routes and eleven hand-parsed sites kept on purpose, the console guard in preValidation, Ward's error bodies unchanged, keepAliveTimeout as the only timeout and no trustProxy; what was rejected and why, and how the replies were proved unchanged.
updated: 2026-11-12
---

# Decisions — the server's code structure

The calls made when the API moved to the estate's code structure (the
code-structure skill), on 2026-11-12. Same bar as
[decisions.md](./decisions.md). The earlier build-time calls are in
[decisions-implementation.md](./decisions-implementation.md).

## The skill's structure, with domain modules beside the features
_2026-11-12_ — `server.ts` is the entry and the only file that listens;
`app.ts` builds the app and never listens; `config.ts` stays the one
reader of the environment, validated at import (a `loadConfig()` factory
would have touched every importer and the tests' environment setup, for
nothing rule 3 doesn't already get). `features/<name>/` holds what was
`routes/`, one folder per route file, `admin/` for the console's five
plugins, each used through its `index.ts`, `app.ts` included.

`auth/`, `db/`, `grants/`, `mail/`, `oidc/` and `tokens/` stay where they
were, as **domain modules**: every feature imports them, and they never
import a feature. dependency-cruiser checks both directions, and that
`app.ts` goes through each feature's index.

**Rejected:** folding the domain modules into features. `db/` alone had 67
incoming imports from across the server, and the session, password, lockout
and token code would have moved for no gain while every app signs in
through it. The skill's tree has no place for such modules yet; that question is the
skills library's.

## Response schemas everywhere, request schemas where a 400 is the answer
_2026-11-12_ — Every route that answers JSON declares a zod response schema
for each status its own handler sends, and no other: the console guard's
401 isn't declared on the admin routes, because a declared status encodes
every reply on it, the guard's included. `GET /console/session` declares one
for its own unreachable branch, as `errorReply`, which carries the guard's
body through unchanged; a test checks the guard's 401 byte for byte on every
admin route. Error statuses share `errorReply`, whose optional
`statusCode` and `message` carry Fastify's own 4xx through unchanged. Keys
are listed in the order the handlers build them, so the bytes didn't move.
The JWKS is the one JSON route without a schema: it is a string, serialised
once at boot, and Fastify never runs a schema on a string reply.

Request schemas go through the type provider on the 24 console routes whose
failure was exactly `400 { error: "invalid_request" }`; the error plugin
answers a schema failure with that body and no issue list (zod's issues echo
the submitted values). **Eleven sites stay hand-parsed**, each with a comment
and an exception in `scripts/conventions.json`, because their failure does
something a 400 would replace: `/login`, `/register` and `/account/password`
answer the lockout gate first and spend no budget; `/refresh` and logout
read an optional body; `/console/login` writes its audit row first;
`/session-status` answers a bad credential with a 401 and a bad body with
`{ active: false }`; `/notify` audits and counts a refusal; `/verify` and the
interaction pages render a page.

The console guard moved from `preHandler` to `preValidation`: Fastify
validates between the two, so a signed-out caller's malformed request would
otherwise have got a 400 instead of the 401.

**Rejected:** request schemas on every route (eleven behaviours would have
changed silently); an imposed error envelope (`{ error, message, issues }`):
Ward's `{ error: "<code>" }` is a contract every app and the login page read.

## One timeout, and no `trustProxy`
_2026-11-12_ — `server.ts` sets `keepAliveTimeout` to 125 s, above Caddy's
two-minute idle keep-alive to its upstream, and nothing else.
`connectionTimeout` and `requestTimeout` stay at Fastify's 0: registration
and `/notify` await the mail transport, which sets no limit of its own, and a
slow SMTP server keeps nodemailer's timeouts. `trustProxy` stays unset: the
lockout reads the socket and the forwarded header itself
([decisions-implementation.md](./decisions-implementation.md)), and no
decision reads `request.ip`. Shutdown is `close-with-grace` (8 s, under
Docker's 10), keeping the order the WAL checkpoint needs: `app.close()`,
then `closeDb()`.

## How it was proved
_2026-11-12_ — Before any change, every reply was captured through the real
`buildApp()` on a scratch database: 282 requests over all 44 registrations,
signed out, as an account and as the console, with every error path, the
lockouts, broken JSON, and the audit rows each request wrote. Tokens were
compared by their header and claims. After every step the capture was
byte-identical, and a field removed from a schema on purpose showed in it,
so the schemas are live. No field was dropped, so nothing any vendored
library version (0.3.1, 0.4.0, 0.7.0) reads changed; the library's source
reads `active` and `role` from `/session-status` and `sent` from `/notify`,
all three named in the schemas.
