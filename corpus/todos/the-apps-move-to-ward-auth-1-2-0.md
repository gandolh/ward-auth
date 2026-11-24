---
title: The apps that vendor ward-auth move to 1.2.0
created: 2026-11-24
status: open
tags: [ward-auth, apps]
---

# The apps that vendor ward-auth move to 1.2.0

Since ward-auth 1.2.0 (2026-11-24), a sign-in the person cancels at Ward reaches the app as `cancelled`, not as a
refusal (`access_denied`). Gatehouse vendors 1.2.0 and shows "Sign-in cancelled." quietly. The other apps that
sign in with Ward still vendor 1.1.0, so a cancel there reads as "this account has no access".

Each app needs: the 1.2.0 build vendored (with its checksums), and one line of words for `cancelled` in its sign-in
page. The wire is unchanged, so Ward itself needs no deploy.

The owner's call on 2026-11-24: leave them for now (mostly only the owner signs in to them, and a cancel is rare);
do it per app at that app's next Ward change, or all at once if cancels start to confuse someone.
