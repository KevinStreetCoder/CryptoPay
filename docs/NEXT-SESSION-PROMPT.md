# Next session — startup prompt

Copy/paste the block below into the next Claude Code session to get a
fast, correctly-scoped start.

---

I'm picking up from the 2026-04-20 session. Before you touch anything,
read these memory files and confirm each rule in your first reply:

- `MEMORY.md` (index)
- `feedback_never_commit_secrets.md` — there's still a pending action:
  the `EXPO_TOKEN` leaked to GitHub earlier (`8uhy…InEn`) and was
  scrubbed via `git filter-repo`. Confirm with me before doing any
  build work that the token has been **rotated at expo.dev** and the
  new one is in `/root/.android_env` on WSL.
- `feedback_sidebar_toggle_design.md` — the web sidebar collapse
  toggle is LOCKED (`top: 31, right: -15`, emerald fill, same row as
  logo). Do not redesign.
- `feedback_back_button_convention.md` — payment sub-page Back
  buttons must match `pay.tsx`'s `hPad` (48 / 32 / 16). Any new
  payment screen must follow it.
- `feedback_no_em_dash.md` — no em-dashes anywhere. Middot (·) is the
  brand separator.
- `project_session_20260420.md` — what landed last session + deploy
  coordinates.

Then check current state:
1. `git log --oneline -10` — confirm you're up to date with `origin/main`
2. `curl -s -o /dev/null -w '%{http_code}\n' https://cpay.co.ke/` —
   should return 200
3. `curl -s -o /dev/null -w '%{http_code}\n' https://cpay.co.ke/download/cryptopay.apk` —
   should return 200
4. `docker compose exec -T web python manage.py showmigrations referrals | tail -2` —
   `0001_initial` should be applied

## Known unfinished / follow-ups

- **EXPO_TOKEN rotation** (user action) — I exposed it and the user
  acknowledged but didn't confirm rotation. Ask before first APK build.
- **Full auth-flow verification on production** — I was never able to
  sign in end-to-end via the preview during the last session (static
  bundle couldn't hit the backend). Worth a live smoke test:
  - Login as `+254701961618` → dashboard renders, wallet balances show
  - Generate an M-Pesa STK deposit quote → M-Pesa receipt PDF looks
    like the new `ReceiptTemplate` (emerald stripe, Coin-C watermark,
    `SETTLED` pill, JetBrains Mono numbers)
  - `/settings/referrals` loads + shows user's code
  - `/r/{some-real-code}` public landing shows the first-name preview
- **Design components still unwired on app surfaces** (low priority):
  `EmptyNoWallet`, `ErrorState`, `SuccessCheck`, `HandoffIcon` — they
  exist in `src/components/brand/PolishAssets.tsx` but aren't surfaced
  on any screen yet.
- **Expo Metro WSL watcher issue** (dev-only nuisance) — the `expo
  start --web` dev server needs `--clear` between edits or it serves
  stale bundles. Document in `feedback_deploy_method.md` if it comes
  up again.

## When making changes

- If you touch sidebar / back-button code, verify against the locked
  specs in the memory files listed above. If the user asks for a
  change that contradicts them, confirm explicitly that they want to
  break the locked shape.
- Before any `git commit`, grep the staged diff for token-shaped
  strings: `git diff --cached | grep -iE 'token=|api[_-]?key|secret=|bearer'`.
  If anything matches and isn't already gitignored, stop.
- Deploy pattern stays the same:
  - Web: `cd mobile && npx expo export --platform web --output-dir dist`
    → tar → scp to VPS `/tmp/` → extract into `/var/www/cpay/` →
    `chown -R www-data:www-data .` → `systemctl reload nginx`
  - APK: WSL-only (`scripts/_build-apk-wsl.sh`), uploads via `scp` to
    `/var/www/cpay-downloads/cryptopay.apk`

---

After reading the memory files, tell me:

1. Is the EXPO_TOKEN rotated?
2. Any gaps between the memory files and the current code you notice
   when you skim `mobile/src/components/WebSidebar.tsx` + one payment
   screen (e.g. `app/payment/paybill.tsx`)?

Then wait for my task.
