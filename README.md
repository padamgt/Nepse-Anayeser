# NEPSE Analyzer (Android)

A personal NEPSE analysis app: it pulls **live prices** from the unofficial
`NepseAPI` feed and ranks your watchlist by a 50/50 blend of **fundamentals
(accounting)** and **support/resistance positioning**. Signal states:
**Accumulate · Hold · Trim · Breakout · Breakdown** — derived from where the
last traded price sits inside each stock's band.

- **Picks** — your watchlist ranked best-first by composite score.
- **Watch** — live price vs your bands, cost P/L, and above/below alert flags. Add / edit / remove holdings.
- **Market** — live top gainers & losers (a discovery list for new band candidates).
- **Settings** — point the app at the hosted or your self-hosted feed; set the NEPSE index band.

Built with Expo (SDK 51 / React Native 0.74), plain React Native — no extra native modules beyond AsyncStorage.

---

## What the feed does and doesn't give you

Data source: **surajrimal07/NepseAPI-Unofficial** (REST).
- The feed provides **live price / volume / index / movers**.
- It does **not** provide support/resistance or EPS/PE/PB/ROE — those are **yours**, entered per holding in the app and stored on the device. Price is merged onto your bands to compute signals.

> ⚠️ The feed is licensed for **educational / personal, non-commercial use only**, sources data unofficially, and gives **no accuracy or uptime guarantee**. This app is analysis tooling, **not investment advice**. Verify every figure against official NEPSE and company disclosures before trading.

---

## Get it on your Android phone

You need **Node.js 18+** (20+ recommended) on your computer. From this folder:

```bash
npm install
npx expo install --fix   # aligns native dep versions to the Expo SDK
```

### Option A — Real installable APK (recommended)

This builds an APK in Expo's cloud (no Android Studio needed).

```bash
npm install -g eas-cli
eas login                                   # free Expo account
eas build -p android --profile preview      # builds an APK (see eas.json)
```

When the build finishes, EAS prints a download URL (also in your Expo dashboard).
Open that link **on your phone**, download the `.apk`, tap it, allow
“Install unknown apps” for your browser/Files app when prompted, and install.

### Option B — Fastest, no build (for trying it out)

```bash
npx expo start
```
Install **Expo Go** from the Play Store, scan the QR. This runs the app inside
Expo Go (not a standalone install, but instant).

### Option C — Local APK without EAS (advanced)

Needs Android SDK + JDK installed locally:
```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# APK at android/app/build/outputs/apk/release/app-release.apk
```

---

## Point it at a data source (Settings tab)

- **Hosted (default):** `https://nepseapi.surajrimal.dev` — free, rate-limited, may be down without notice.
- **Self-host (reliable):** run the feed yourself, then set the URL to your machine's **LAN IP** (not `localhost`, since the phone is a different device):

```bash
# from the NepseAPI-Unofficial repo
docker run -p 8000:8000 -p 5555:5555 surajrimal/nepseapi:latest
# then in the app: Settings -> http://<your-computer-LAN-IP>:8000 -> Test connection -> Save
```

Use **Test connection** to hit `/health` and confirm reachability.

---

## How it works (and where to tune it)

- **Signal logic** — `src/signals.js`, `computeSignal()`. Lower 25% of the band → Accumulate; upper 25% → Trim; mid → Hold; above resistance → Breakout; below support → Breakdown.
- **Scoring** — `src/signals.js`. `qualityScore()` rewards higher ROE, lower P/E and P/B, decent EPS (neutral 50 when fundamentals are blank). `technicalScore()` maps the signal to a number. `compositeScore()` blends them 50/50 — change the weights there.
- **API client / field mapping** — `src/data.js`. `normalizeQuote()` reads price from several possible key names so it survives feed schema differences; extend it if your instance returns different keys.
- **Seed watchlist** — `src/data.js`, `SEED_WATCHLIST` (RFPL, MMKJL, HRL, SAHAS, NABIL with starter bands). Edited entries persist on the device and override the seed.

---

## Project layout
```
App.js              UI: tabs, screens, edit sheet, styles
src/theme.js        colour palette
src/signals.js      signal + scoring engine
src/data.js         live API client + AsyncStorage persistence
src/components.js    BandGauge (signature), SignalBadge, ScoreBar, fmt
app.json / eas.json  Expo + build config (preview profile = APK)
```

---

## Build the APK in the cloud, no local Android tools (GitHub Actions)

This repo includes `.github/workflows/build-apk.yml`. Once the project is on GitHub:

1. Push it to a GitHub repo (`git init && git add . && git commit -m init && git push`).
2. Go to the repo's **Actions** tab → **Build Android APK** → **Run workflow** (it also runs on every push to `main`).
3. When the run finishes (~10 min), open it and download the **`nepse-analyzer-apk`** artifact at the bottom. Unzip it to get `app-debug.apk`.
4. Copy `app-debug.apk` to your phone, tap it, allow "install unknown apps", install.

The workflow builds a **debug-signed** APK, which installs on any phone for personal use — no keystore setup, no Expo account. For a Play-Store / release-signed build, use the EAS path above instead.
