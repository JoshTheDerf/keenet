# Releasing & code signing

KeeNet ships from three GitHub Actions workflows:

| Workflow | File | Builds | Trigger |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | typecheck · lint · test · web build · audit | every push / PR |
| Release Desktop | `.github/workflows/release-desktop.yml` | Linux (AppImage + .deb), macOS (universal .dmg), Windows (.msi/NSIS → MSIX for Store) | tag `v*` · manual |
| Release Mobile | `.github/workflows/release-mobile.yml` | Android (APK + AAB), iOS (.ipa) | tag `v*` · manual |

**Cutting a release:**

```bash
# bump "version" in package.json and src-tauri/tauri.conf.json to match, then:
git tag v2.0.0
git push origin v2.0.0
```

Tag builds attach desktop bundles to a **draft** GitHub Release (review, then publish) and upload mobile artifacts. Manual runs (Actions → *Run workflow*) build the same and upload everything as workflow artifacts, without a release.

> **Signing is optional and auto-detected.** Every signing step is gated on its
> secrets existing, so all workflows are green from day one and produce *unsigned*
> builds. Add the secrets below and the next run signs automatically. App IDs:
> desktop `com.thederf.keenet.desktop`, mobile `com.thederf.keenet.app`.

---

## What "unsigned" costs you

| Platform | Without signing |
|---|---|
| Linux | Nothing — AppImage/.deb don't need signing. (Optionally GPG-sign for repos.) |
| Windows | SmartScreen "Unknown publisher" warning; users must click through. |
| macOS | Gatekeeper **blocks** the app ("damaged / unidentified developer"). Effectively undistributable without signing + notarization. |
| Android | Fine for sideloading a debug APK; **Play Store requires** a signed AAB. |
| iOS | Cannot install on a device or ship at all without signing. |

---

## macOS (desktop) — Apple Developer Program ($99/yr)

You need a **Developer ID Application** certificate (for distribution outside the App Store) and an app-specific password for notarization.

1. In the Apple Developer portal, create a **Developer ID Application** certificate; install it in Keychain Access.
2. Export it as `.p12` (with a password). Base64 it: `base64 -i cert.p12 | pbcopy`.
3. Create an app-specific password at <https://appleid.apple.com> → Sign-In & Security.
4. Find your **Team ID** in the developer portal (top-right / Membership).

GitHub secrets (repo → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your 10-char Team ID |

Tauri picks these up automatically and notarizes the `.dmg`. (For **Mac App Store** distribution instead, you'd use an *Apple Distribution* cert + a different provisioning flow — not covered here.)

---

## Windows (desktop)

### Recommended: Microsoft Store (no code-signing cert, no annual fee)

This is the cheapest way to ship a trusted Windows app. **The Store signs your
package for you** with a Microsoft-trusted certificate during certification, so
you never buy or manage a code-signing cert. Cost is a **one-time** Partner
Center registration (~$19 individual / ~$99 company) — not the ~$200–$400/yr an
OV/EV cert runs.

The catch: the fee-avoidance only applies to the **MSIX** package format (which
the Store signs). Tauri emits `.msi` + NSIS `.exe`, **not** MSIX, so there's a
repackaging step. Flow:

1. **Reserve the app** in [Partner Center](https://partner.microsoft.com/dashboard) → Apps and games → get your **Identity**:
   - `Package/Identity/Name` (e.g. `12345Publisher.KeeNet`)
   - `Package/Identity/Publisher` (e.g. `CN=ABCD1234-…` — the exact value Partner Center assigns)
   - Publisher display name
2. **Build** the app in CI as usual (produces the payload under `src-tauri/target/release/`).
3. **Package as MSIX**: generate an `AppxManifest.xml` carrying the identity from step 1, then run the Windows SDK's `MakeAppx.exe pack` over the app payload + assets. (Assets = Store logos: `Square44x44Logo`, `Square150x150Logo`, etc.)
4. **Submit** the resulting `.msix` in Partner Center. You upload it **unsigned** — Microsoft signs it. Do **not** self-sign for submission; the manifest `Publisher` must match your assigned identity exactly or certification rejects it.

> For local testing before submission you can self-sign the MSIX with a
> throwaway cert and sideload it; that cert is irrelevant to the Store.

Because MSIX packaging needs *your* reserved identity values, it isn't wired
into CI yet. Once you've reserved the name and have the identity strings, I can
add an MSIX job (Windows SDK is preinstalled on `windows-latest`, so it's just a
manifest + `MakeAppx` step gated on those values as repo variables).

> **Note on submitting the plain `.exe`/`.msi` instead.** The Store also accepts
> unpackaged Win32 installers, but those are **not** Microsoft-signed — you'd
> still need your own cert to avoid SmartScreen. So for the no-cert goal, use MSIX.

### Alternative: sign it yourself (outside the Store)

- **Azure Trusted Signing** — cheapest self-signing option, no hardware token; sign in CI with `azure/trusted-signing-action` or Tauri's `bundle.windows.signCommand`.
- **OV/EV certificate** from a CA — set `bundle.windows.certificateThumbprint` + `timestampUrl` in `tauri.conf.json` and import the cert into the runner from a base64 secret. EV clears SmartScreen immediately but needs a hardware token (awkward in CI).
- **Ship unsigned** — users get a one-time SmartScreen click-through.

---

## Android (mobile)

Generate an **upload keystore** once and reuse it:

```bash
keytool -genkey -v -keystore keenet-upload.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias keenet
base64 -i keenet-upload.jks    # copy into the secret below
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of the `.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `keenet` (or your alias) |
| `ANDROID_KEY_PASSWORD` | key password |

With these set, the workflow builds a signed `assembleRelease` APK **and** `bundleRelease` AAB. For the Play Store, upload the **AAB** and enroll in **Play App Signing** (Google re-signs with the app key; your keystore is only the *upload* key — keep it safe, but it's recoverable via Play support if lost). **Keep the keystore forever** — a Play listing can only ever be updated by the same upload key.

---

## iOS (mobile) — Apple Developer Program ($99/yr)

The hardest one, because signing identity + provisioning profile must match the bundle id `com.thederf.keenet.app`.

1. Register the App ID `com.thederf.keenet.app` in the developer portal.
2. Create an **Apple Distribution** certificate; export as `.p12` (with password); base64 it.
3. Create a **provisioning profile** (App Store or Ad Hoc) for that App ID + your distribution cert; download the `.mobileprovision`; base64 it.
4. Note the profile's **name** (as shown in the portal) and your **Team ID**.

| Secret | Value |
|---|---|
| `IOS_DIST_CERT_P12` | base64 of the distribution `.p12` |
| `IOS_DIST_CERT_PASSWORD` | the `.p12` password |
| `IOS_PROVISION_PROFILE_BASE64` | base64 of the `.mobileprovision` |
| `IOS_PROVISION_PROFILE_NAME` | the profile's exact name |
| `IOS_EXPORT_METHOD` | `app-store`, `ad-hoc`, or `development` |
| `APPLE_TEAM_ID` | your Team ID (shared with macOS) |

With these set, the workflow archives and exports a signed `.ipa`. Without them it only does an unsigned simulator **compile check** (so PRs still validate the iOS build).

> **Tip — Fastlane match.** For teams, managing certs/profiles by hand across
> machines is painful. [`fastlane match`](https://docs.fastlane.tools/actions/match/)
> stores them in a private git repo and syncs them into CI; consider it once more
> than one person cuts iOS builds.

---

## Optional: Tauri auto-updater signing

Only if you enable the Tauri updater (not currently configured). Generate a keypair with `npm run tauri -- signer generate`, then set `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as secrets and add the public key to `tauri.conf.json`. This is **separate** from OS code signing — it authenticates update payloads, it doesn't satisfy Gatekeeper/SmartScreen.

---

## Secret checklist

- **Minimum to publish everywhere:** macOS (6) + Windows (varies) + Android (4) + iOS (5, + shared `APPLE_TEAM_ID`).
- **Zero secrets:** everything still builds; Linux/Android(debug) are usable, macOS/iOS/Windows are unsigned.
- Nothing here is committed — all signing material lives in GitHub Actions secrets and is decoded at build time only.
