---
title: The server-rendered OIDC pages follow the theme
created: 2026-11-11
status: open
tags: [ui, oidc, theme]
---

# The server-rendered OIDC pages follow the theme

Brief 05 gave the sign-in pages a Light / Dark / System switch (`ui/src/theme.ts`, the boot script in `ui/index.html`), kept on the device. The pages the API renders itself during an OIDC flow, from `api/src/oidc/layout.ts`, carry their own inline styles and were out of brief 05's scope, so they stay light. Someone who chose Dark now sees a light page between two dark ones while an app signs them in.

## What to decide, with brief 07 (the redesign)

- Whether `layout.ts` takes the redesign's tokens, and how it learns the choice: the same origin's `localStorage` key, read by a small inline script before first paint (the sign-in pages' way), or `prefers-color-scheme` only.
- Any inline script here meets the same CSP note as the sign-in pages' boot script: Ward sends no `script-src` today; if library brief 25 (the security audit) adds one, both scripts need a hash or a move to a file.
- No route, cookie or token change: only how the page looks.
