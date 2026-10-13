---
summary: The 2026-10-13 redesign — every app keeps its own accounts and its own login page, "Sign in with Ward" is an OpenID Connect flow against Ward as the provider, Ward-originated app sessions still die within 30 seconds of a Ward revoke, and the shared code ships as a built library each app copies in. Revises Q4, Q21 and the no-shared-package call. Brief 18 added how apps authenticate as clients (private_key_jwt) and what the provider's own session still does.
updated: 2026-10-13
---

# Decisions — local accounts and Ward as an OIDC provider

Decided by the owner on 2026-10-13, in one session, answering "every app should
have its own register/login page, with sign-in with Ward as an extra button".
This page **revises three earlier decisions**; each carries a dated note
pointing here:

- [decisions.md](./decisions.md) Q4: Ward no longer owns every credential.
  Each app owns its own accounts, and a Ward account is an optional second way
  into one.
- [decisions.md](./decisions.md) Q21: there is no longer one login page. Each
  app renders its own, in its own design, and Ward's login page is reached only
  through the "Sign in with Ward" button.
- [integrating.md](./integrating.md), 2026-09-06: there is now a shared
  package. Each app does not install it. It holds a copied, built version.

Briefs 18–27 build it. The wave plan is in [status.md](./status.md).

## Every app owns its accounts; Ward is a linked second way in
_2026-10-13_ — Each app has a users table in its own database, its own
password check, and its own sessions. A person can have a local account in an
app, a Ward account, or both linked. **Apps keep working while Ward is down**,
because local sign-in never calls Ward.

No new sign-up surfaces. An app whose page offers only "Sign in" today still
offers only that, and its local users are created by a seed script.
public-resource-map is the one app with a Register link, and that link now
points at a **local** register page in prm.

**Rejected: keeping Ward as the only credential store** (the Q4 shape). It
makes every app unusable whenever Ward is, and gives every app the same login
page in a look that is not its own. Those are the two things the owner wants
gone.

## "Sign in with Ward" is OpenID Connect, with Ward as the provider
_2026-10-13_ — The button starts an authorization code flow with PKCE against
Ward. Ward runs [`oidc-provider`](https://github.com/panva/node-oidc-provider)
(panva, OpenID certified) rather than a hand-written protocol. Each app is a
confidential client, and the app's server finishes the flow. Ward's login page
is the provider's login step, so the person sees Ward's login page on Ward's
own host and comes back to the app signed in.

Nothing in the flow may assume Ward shares the app's origin. Ward may move to a
subdomain later. The issuer, the redirect URIs and Ward's UI base path are
configuration, and local development already runs Ward on its own origin
(`localhost:8792`), which exercises the cross-origin case on every dev run.

**Rejected: the same-origin cookie handoff** (redirect to Ward's login with
`?next=`, then read Ward's cookie in the app's callback). It is cheaper and
breaks the day Ward moves to a subdomain. **Also rejected: a hand-written
provider.** Authorization codes, PKCE, client authentication and ID token
signing are exactly the code that should come from a certified library.

## Ward's grant decides who may use the button; the app owns the role
_2026-10-13_ — Ward completes an authorization only if the account holds a
grant for that client's app. Without one, the app receives `access_denied` and
shows its own message. The **role** a person holds in an app lives in the app's
own users table. A user created from a first Ward sign-in starts with the role
their Ward grant names, and from then on the app's row is the only truth.

This revises the roles clause of [decisions.md](./decisions.md)'s "Ward owns
access grants". Ward still decides *whether* a Ward account may get in, not
what it may do once inside.

## A first Ward sign-in creates the local user; linking never guesses
_2026-10-13, owner answer 1(a)_ — When a Ward sign-in arrives for a subject the
app has never seen and Ward vouched for a grant, the app creates a local user
linked to that subject. The grant is the operator's approval, so this is not a
new sign-up surface.

A person who already has a local account links Ward **from their own settings
while signed in**. **Never link by matching a username or email.** On a shared
origin that is account takeover: whoever controls the Ward account named
`alice` would walk into the local `alice`.

A user created from Ward has no local password. The library offers a "set a
local password" action in account settings so that person can still get in
while Ward is down. Unlinking Ward is refused while the user has no local
password, because it would lock them out.

## Ward-originated sessions still end within 30 seconds of a Ward revoke
_2026-10-13, owner answer 4_ — Revoke-everywhere is kept for sessions that
began with Ward. The app stores the **Ward session id** (the refresh family id,
the `sid` of [decisions-tokens.md](./decisions-tokens.md)) on its own session
row, and asks Ward at most every 30 seconds whether that Ward session is live
and the grant still held. Sign-out at Ward, a console revoke, a password change
or a grant removal ends the app session within 30 seconds, exactly as today.
Sessions that began with a local password are never checked against Ward.

The authority is **Ward's refresh family, not oidc-provider's own session**.
The provider keeps a session of its own, and two notions of "signed in at Ward"
would let one end while the other lives on. Ward passes the family id to the app
in a custom ID token claim, `ward_sid`. The provider's own `sid` is left alone.

**Failing closed still holds** ([integrating.md](./integrating.md) rule 5).
When Ward cannot answer, a Ward-originated session is rejected, and the app
tells the person to sign in with their local password. Local sessions are
unaffected.

**Rejected: back-channel logout** (Ward calls each app). It turns a pull the
app controls into a push that must reach every app, and needs retry and failure
handling in Ward for no gain over a 30-second pull.

## Calls settled while building

How clients authenticate, why Ward's refresh family outranks the provider's
own session, the prefix and logout details, and the local half's build calls
live in [decisions-oidc-build.md](./decisions-oidc-build.md).

## Mail stays a Ward service, for Ward-linked users only
_2026-10-13, default accepted_ — `POST /notify` stays, authenticated by the
app's client credentials. It can reach only users linked to Ward, since only
Ward holds verified addresses. Local-only users get no mail until an app grows
its own.

## The shared code is a built library each app copies in
_2026-10-13, owner answers 3 and 9_ — The shared code lives in this repo at
`shared-library/`. Each app holds a **copied, built** version in
`vendor/ward/`, with one README that names the source (`ward/shared-library`)
and the version and says nothing else: no local paths, no domain. Upgrading
means copying a newer build in and adapting the app's code, like vendoring a C
library. No registry, no git dependency, no npm link.

**Built, not minified.** The copy is compiled TypeScript bundled into plain ES
modules. Its third-party dependencies (`openid-client` and its own) are bundled
in, so the copy has no install step of its own and drops into sports-app's
plain `.mjs` server as-is. Every server in the estate is `"type": "module"`, so
one output format serves all of them. It is not minified: it is security code
that an app owner must be able to read, step through and diff between versions,
and size does not matter on a server. React and Fastify are peer dependencies
taken from the app, never bundled.

**What a copy holds** (owner, 2026-10-13): the bundle, its types, a
`README.md` and a `LICENSE`, and nothing else.
- Two bundles, not one: `ward-auth.js` for the server and `ward-auth-react.js`
  for the hooks. The server bundle must not import React.
- `ward-auth.d.ts` and `ward-auth-react.d.ts` beside them.
- The README gives the version and the source, linking the remote repository
  (`https://github.com/gandolh/ward-auth`, folder `shared-library/`), plus where
  the upgrade notes are.
- The LICENSE is MIT, as Ward's `package.json` declares.
- No source maps, which would carry build paths, and no `package.json`. An app
  imports the bundle by relative path.

**Customizable, not duplicated.** The library owns the logic: password
hashing, lockout, sessions, the Ward sign-in, linking, the 30-second check and
seeding. Apps own their screens. Login, register and settings pages are each
app's own components, built on the library's unstyled React hooks. Storage goes
through a small interface with a built-in SQLite implementation that runs on
the app's own database handle.

**Rejected: minifying** (unreadable security code) and **shipping TypeScript
source** (each app would compile it under its own `tsconfig`, and sports-app
has no TypeScript build).

## imbatranimOS stays out
_2026-10-13, owner answer 6_ — imbatranimOS keeps its own sign-in (its brief
157) and gets no Ward button for now. Nothing here may assume Fastify in the
library's core, so a NestJS adapter stays possible later.
