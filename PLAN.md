# Tempo prototype

Goal: a flat, responsive parallel timer/stopwatch app with immediate local interaction, optional Google/Supabase sync, and web push.

The workspace is already a linked worktree. Use vanilla JavaScript, CSS, Vite, the Supabase client, native dialogs and pointer events. No UI framework or state library.

- [x] Implement the timestamp-based timer model and a runnable Node test: independent clocks, pause/resume, reset to saved settings, +1 minute, stopwatch, mode change, completion.
- [x] Build the responsive flat interface, editable cards, cloning, ordering, notifications/preferences and persistent guest state. Time settings affect the next reset; changing mode resets immediately.
- [x] Add optional Supabase Google/anonymous sessions, guest import, isolated per-user rows, optimistic interaction with revision conflict detection, realtime updates and reconnect refresh.
- [x] Add PWA assets/service worker and a scheduled push sender with authenticated subscriptions, stale-notification checks and deployment instructions. Connected the dedicated `minimal-timer` project provided by the user.
- [x] Verify with Node tests, production build, actual desktop/mobile browser interactions, reload persistence and offline shell. Live anonymous auth/sync and the server push pipeline passed; Google consent and physical device notification delivery remain user/device checks.

Files: `index.html`, `src/{main,model,cloud}.js`, `src/style.css`, `public/{sw.js,manifest.webmanifest,icon.svg}`, `tests/model.test.js`, `supabase/` migration and push function, `.env.example`, `README.md`.

Prototype defaults: edit name immediately and saved duration on next reset; mode changes reset. A stale cloud edit is rejected with visible refresh rather than overwriting newer work. Signed-in cloud writes require connectivity; guest mode remains local. Settings/clone/delete/+1 controls do not toggle the card. Support keyboard interaction and reduced motion.

Verified: Node model checks, real desktop/mobile browser flows against dev and production builds, offline production shell reload, actual Supabase anonymous session/CRUD/realtime/conflicts, database RLS and input constraints, Cron → Edge invocation and stale notification cancellation. Physical Android/iOS push delivery and the user's Google consent flow require device/user interaction and are not claimed as verified.

Deployment authorized to `philaxis/minimal-timer`, GitHub Pages at `/minimal-timer/`. Keep the repository's existing LICENSE.

Deployed: https://philaxis.github.io/minimal-timer/ . GitHub Actions succeeded, and the public page loaded and ran a timer without browser errors. Rapid start/pause/start in the connected UI saved all three revisions correctly. Temporary integration-test accounts were removed.
