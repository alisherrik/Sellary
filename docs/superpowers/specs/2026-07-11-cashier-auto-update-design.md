# Sellary Cashier — Auto-Update (Tauri v2 + GitHub Releases): Design & Runbook

Distribute the desktop cashier **once**, then update it automatically whenever a version tag is pushed — no manual `.exe` handoff per release.

## Design (decided with the user)
- **Mechanism:** Tauri v2 updater plugin (`tauri-plugin-updater` + `@tauri-apps/plugin-updater`) + `tauri-plugin-process` (relaunch). The app checks a signed manifest, downloads the new NSIS installer, verifies its signature, installs, relaunches.
- **Distribution:** **public GitHub Releases.** The repo is made **public**; the updater endpoint is `https://github.com/alisherrik/Sellary/releases/latest/download/latest.json`. (Private repos can't serve release assets without embedding a token in the app — insecure — hence public.)
- **Signing:** a minisign keypair. The **public** key is in `tauri.conf.json` (`plugins.updater.pubkey`); the **private** key + password live ONLY in GitHub Actions secrets. Every release artifact is signed at build time; the app rejects unsigned/mismatched updates.
- **Update UX:** on startup the app checks and shows a non-blocking banner «Доступно обновление X — Обновить / Позже» (`src/components/UpdateBanner.tsx`); Settings has a manual «Проверить обновление» button. Never forces a mid-shift restart.
- **Release trigger:** push a tag `v*` (or run the workflow manually). CI (`.github/workflows/release.yml`, `tauri-apps/tauri-action` on `windows-latest`) builds + signs + publishes the installer + `latest.json`.

## Files
- `src-tauri/Cargo.toml` — `tauri-plugin-process`; `tauri-plugin-updater` (desktop-only target).
- `src-tauri/src/lib.rs` — registers both plugins (updater under `#[cfg(desktop)]`).
- `src-tauri/capabilities/default.json` — `updater:default`, `process:default`.
- `src-tauri/tauri.conf.json` — `bundle.createUpdaterArtifacts: true`, `targets: ["nsis"]`, `plugins.updater` (endpoint + pubkey + `windows.installMode: passive`).
- `src/lib/updater.ts` — `checkForUpdate()` (never throws) + `applyUpdate()`.
- `src/components/UpdateBanner.tsx` — startup prompt; wired in `src/App.tsx`.
- `src/pages/SettingsPage.tsx` — manual check button.
- `.github/workflows/release.yml` — the release build. `ci.yml` manual Tauri-build step gets the signing env (normal push CI skips the Tauri build, so it's unaffected).

---

## Runbook

### One-time setup (owner)
1. **Add two GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions → New repository secret):
   - `TAURI_SIGNING_PRIVATE_KEY` = the FULL contents of the generated private-key file.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password chosen at generation.
   > The private key was generated locally and handed over out-of-band; it is **never** committed. If lost, generate a new keypair (`npx tauri signer generate`), replace the `pubkey` in `tauri.conf.json`, and re-release — old installers won't accept the new key, so re-distribute once.
2. **Make the repo public** (Settings → General → Danger Zone → Change visibility). Do this only after the secrets scan; **rotate any accounts seeded with `seed_admin.py` defaults (`admin123` / `cashier123`) first** — going public reveals those defaults.
3. **First release + first install:** cut a release (below), download the installer from that GitHub Release once, install it on each cashier PC. All later versions auto-update.

### Cutting a release (each new version)
1. Bump the version to the SAME `X.Y.Z` in all three:
   - `sellary-cashier/package.json`
   - `sellary-cashier/src-tauri/tauri.conf.json`
   - `sellary-cashier/src-tauri/Cargo.toml`
2. Commit, then tag + push:
   ```
   git commit -am "release: v0.2.0"
   git tag v0.2.0
   git push origin main --tags
   ```
   (Or run the **Release Cashier** workflow manually from the Actions tab with the tag.)
3. The workflow builds + signs + publishes the GitHub Release (installer `.exe`, `.sig`, `latest.json`). Within a minute the tag's release becomes "latest".
4. Open cashiers check on next launch (or via Settings) → banner «Доступно обновление» → Обновить → auto-installs + relaunches.

### Notes
- Windows only (NSIS). macOS/Linux would need those runners + targets added later.
- The updater compares the running app version to `latest.json`'s version — so the tag/version bump is what makes clients update.
- `createUpdaterArtifacts: true` means `tauri build` now requires the signing key; the release workflow and the (manual-only) CI Tauri-build step supply it. Normal push CI does not build the desktop app, so it is unaffected.
