# Brief 29 — just-a-bot signs in to atrium's own accounts

## Context

Found while adopting the library in atrium (brief 22). The Discord bot's
Jukebox signs in to atrium as a Ward account: it logs in at Ward, holds
`ward_session` and a rotating `ward_refresh`, and sends the access cookie to
atrium. See `bots/discord/src/jukebox/atrium/session.ts`, `client.ts`,
`config.ts` and `env-rule.ts` in the just-a-bot repo, plus its brief 25.
Atrium no longer reads Ward's cookie (brief 22), so **the Jukebox breaks the
moment atrium's new version deploys.**

The bot should sign in to atrium directly, as a seeded local atrium user with
the `jukebox` role (atrium's D55):
- `POST <atrium-api>/auth/login` with `{username, password}`;
- keep the `atrium_session` cookie it sets (`Path=/atrium-api`, 14-day sliding
  idle, 30-day absolute);
- send it on every request.

Atrium's guard lets a request with no `Origin` header through, and Node's
fetch sends none.

**The bot's local `.env` is production's.** The deploy pushes it. Never run
the bot locally, never register its commands, and never edit `.env`. Change
`.env.example` only. Renaming the variables in the real `.env` is an owner
step.

## Files you OWN

- `just-a-bot/bots/discord/src/jukebox/atrium/**` (session, client, config,
  env rule, errors, check, and their tests)
- `just-a-bot/bots/discord/src/env.ts` (the Jukebox variables only)
- `just-a-bot/.env.example`, any `.env.example` beside the bot, and the docs
  that list the Jukebox variables
- `just-a-bot/corpus/**` (a decision and a log entry)

## What to do

1. Replace the Ward session with an atrium session:
   - Log in once at start or on first use.
   - Keep the cookie in memory, and optionally on disk as the refresh token is
     today. If it goes on disk, say why.
   - On a `401` from atrium, log in again once, single-flight.
   - A wrong password is tried once and not again until a restart. Atrium
     locks an address out after five failures, and the lockout is per address
     at best.
   - Atrium unreachable stays `JukeboxUnavailable`.
2. Variables: `JUKEBOX_ATRIUM_URL` stays. `JUKEBOX_WARD_URL`,
   `JUKEBOX_WARD_USERNAME` and `JUKEBOX_WARD_PASSWORD` become
   `JUKEBOX_ATRIUM_USERNAME` and `JUKEBOX_ATRIUM_PASSWORD`. Keep the env
   rule's all-or-nothing check.
3. Delete the spent `jukebox-session.json` handling if nothing needs it any
   more, and clear any old file at start.
4. Record the change in the bot's corpus. Name the owner steps in the log
   entry, in order:
   1. Seed a `jukebox` user in atrium.
   2. Rename the variables in the bot's `.env`.
   3. Deploy atrium, then the bot.
   4. Remove the bot's old `atrium` grant at Ward.

## Acceptance

- The bot's test suite and typecheck pass, with tests for: login sets the
  cookie; a `401` re-logs in once; a wrong password is not retried; atrium
  down is `JukeboxUnavailable`; the env rule.
- Nothing ran the bot or touched `.env`.

## Outcome (2026-10-13)

Shipped in just-a-bot (`296aa33`).
- The Jukebox logs in to atrium's own `/auth/login` and keeps
  `atrium_session` in memory.
- A 401 re-logs in once, single-flight. A refused password is tried once.
- The variables are `JUKEBOX_ATRIUM_URL`, `JUKEBOX_ATRIUM_USERNAME` and
  `JUKEBOX_ATRIUM_PASSWORD`. **The bot's real `.env` still has the old names,
  so any bot deploy before the owner renames them refuses to boot.**
- Owner steps, in order:
  1. Seed a `jukebox` user in atrium.
  2. Rename the variables in the bot's `.env`.
  3. Deploy atrium, then the bot.
  4. Remove the bot's `atrium` grant at Ward.

62 tests and typecheck pass (with the old URL variable blanked, because the
real `.env` is read by one test).
