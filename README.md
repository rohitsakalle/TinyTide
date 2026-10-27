# Tiny Tide

A touch-first, one-button endless canal game. You control the water, not the boat:
hold to rise over rocks, release to slip under bridges. Anticipate the next
obstacle; the tide takes time to move. A collision ends your run, with an
immediate retry and a local personal best.

Choose **Easy**, **Medium**, or **Fast** with the Pace selector before starting.
Medium keeps the original pace. Each mode has a separate distance record; old
records are retained as Medium records. Pace is locked while running or paused,
and can be changed after a collision. Speed ramps smoothly over **90 active
seconds** from 105 to 165 world-pixels/s on Easy, 145 to 220 on Medium, and 190
to 275 on Fast. Flow displays ramp progress and the current speed multiplier.
Pause/background time does not advance it; retry resets it.

Newly generated hazards gradually get wider and demand higher water over rocks
and lower water under bridges. Alternation becomes more frequent and the gaps
shrink, but retain a full-height transition, 0.25s reaction allowance, boat
overlap and the first coin's approach distance at the mode's maximum future
speed. The visible world gives at least a full transition plus 0.5s warning at
that speed. Existing obstacles never change shape as they approach.

Gold coin trails follow safe routes over rocks and under bridges. Collect them
with the boat for a floating `+1`, a pickup chime and a run count. The **Coin
bank** saves every pickup immediately, survives retries and is shared across
paces and courses. Spend them only on cosmetic boats in **Boat studio & missions**:
Sunrise paper is free, Mint explorer costs 25 coins, and Berry voyager costs
50. Each has a preview; owned boats can be reselected for free. Selection is
locked during runs and pauses. Hull/sail colors change, not physics, collision
size, coin collection or scoring. There is no cash value, real-money payment or
account sync. Records, coins and sound preference are local to this browser.

Existing coin balances migrate into one versioned progress record containing
bank, owned/selected boats, completed missions and recent daily records. Spending
and ownership are saved together, as are mission rewards and completion flags.
A failed purchase save does not spend coins or grant ownership. Storage failures
show an explicit notice: new rewards last only for that visit and purchases are
disabled. Invalid saved progress is preserved, not silently overwritten. Earlier
coin keys are left intact as migration sources, not continuously mirrored.

## Perfect passes, missions and scenery

The score is **one point per metre plus perfect-pass bonuses**. Finish an obstacle
with 12–38 world-pixels of safe clearance between hull and rock, or sail and
bridge, on the last overlapping physics tick to earn a perfect pass. A dashed
gold bracket beside the next obstacle shows the waterline target band; this is
optional skill play, not a required route. Consecutive perfect passes award
5, 10, 15, 20, then 25 bonus points each (the bonus caps at 25). A safe but
non-perfect pass breaks the combo; every perfect pass has visible feedback and
a chime. Retries reset combos and bonuses. Existing best-distance numbers remain
the initial best-score values for their pace; no previous record is erased.

Three one-time missions track **a single run**, on either course: collect 10
coins (+15), clear 5 obstacles (+10), and make 3 perfect passes (+20). Progress
and completion are shown in the studio, with completion announcements. Rewards
are credited immediately and each goal pays once per browser profile, not once
per retry or day. Unfinished progress resets on retry; completed goals persist.
The coin count for a mission counts actual pickups, not reward coins.

Scenery blends from garden canal to rainy streets, then moonlit water as active
run time advances. Transitions begin at 25 seconds, reach rainy streets at 60,
and moonlit water at 95. Weather stays behind obstacles, hazard/coin/boat shapes
remain consistent, and scenery never changes collision rules. Reduced-motion
preferences remove moving rain and water ripples.

## Daily course

Choose **Daily** before starting for a date-labeled, UTC-seeded endless course.
It always uses the same Medium starting profile and progression; pace selection
is disabled. Everyone on the same game version and UTC date gets the same
obstacle/coin course. Fixed 120Hz physics ticks keep generation independent of
display frame timing. Retry restarts that day's seed, not a fresh random route.

Daily bests are separate from all Endless records, with the most recent 14 dates
retained locally. A run crossing UTC midnight keeps its original date and record
until it ends; the next start uses the new date. Date selection uses the device
clock and works offline, not an online time service. This is a local challenge,
not a verified leaderboard or anti-cheat system. Skins and missions work on both
courses without modifying the course. Course and pace stay locked during play
and pause.

Gentle synthesized notes accompany launch, tide changes, coin pickups and the
end of a run. **Sound on / Sound off** mutes all effects and saves your choice.
Audio is initialized only after a start/resume or sound-button gesture, never
on page load. Muting, pausing and switching away stop scheduled notes; a browser
without working Web Audio can still play, with a visible audio-unavailable notice.
No audio downloads or network services are used.

## Play locally

Public phone-testing preview: **https://rohitsakalle.github.io/TinyTide/**.
Open this HTTPS link in Android Chrome or iPhone Safari; no install is required.

On Windows, no packages or build step are needed:

```powershell
.\serve.ps1
```

Open **http://localhost:4173**. If your PowerShell execution policy blocks local
scripts, review `serve.ps1` and, if permitted by your organization's policy, run
`powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\serve.ps1` to allow
local scripts for that server process only (no system policy change).
Alternatively, use an approved local static server. With Python installed:
`python -m http.server 4173 --bind 127.0.0.1` from this folder.

Touch/hold the game area or the Hold to Rise button. Desktop: hold **Space** or
**Up arrow**, release to lower; **P / Escape** pauses. Start/retry with the button
or Space. Switching apps or tabs pauses automatically; resuming is explicit.

For a phone on the same trusted Wi-Fi, run `.\serve.ps1 -Lan`, then open
`http://YOUR-PC-LAN-IP:4173`. Allow only necessary private-network firewall
access. This is sufficient for online gameplay, but **offline caching requires
HTTPS** on phones. `localhost` is a secure-context exception only on the device
running the server. The bundled server is for local development, not public hosting.

## Offline / hosting

Publish `index.html`, `style.css`, `app.js`, `engine.js`, `sound.js`, `progress.js`, `sw.js`,
`manifest.webmanifest`, and `icon.svg` to any HTTPS static host (including GitHub
Pages). No backend or external assets are needed. Relative URLs work under a
repository subpath.

Wait for **Offline ready** after the first online visit; the service worker
precaches the entire game. Subsequent visits to that URL work offline, unless
the browser clears/evicts site data. Don't open `index.html` as a local `file:`
URL: ES modules and service workers need a web server.

The manifest supports standalone use where the browser offers it. On iPhone,
Safari's Share menu, then Add to Home Screen, is optional; no app-store install is needed.
This prototype uses an SVG icon; platform-specific install artwork and store
packaging are outside this milestone. For future releases, bump the cache
version in `sw.js` whenever changing cached assets.
The cache is isolated by service-worker scope so repository-subpath deployments
do not replace caches belonging to other Tiny Tide previews on the same origin.

## Checks

With the server running, open **http://localhost:4173/tests.html**. The browser
runner covers bounded water motion, both collision types, scoring/reset,
frame-rate independence, warning distance, and seeded procedural reachability
at maximum speed, plus responsive layout, keyboard/pointer input state,
pause/resume, failure, retry, coin pickups and persistence, best-score migration,
all three paces and late-run coin-trail reachability, measurable speed/geometry
ramps, perfect combos, cosmetic spending and failed-save safety, one-time mission
rewards, daily reproducibility at multiple frame rates, UTC dates and separate
daily records, scenery, and sound unlock/mute/error flows in an isolated game
frame. The UI tests restore the prior local data afterward; don't play in another
tab while the isolated tests run. Sound lifecycle tests use a deterministic Web
Audio double, plus real Web Audio offline rendering to check non-silent output
and cancellation. Real-device speaker quality and browser gesture policy still
need device testing.
Pointer checks synthesize touch intent, not physical-device capture.
No test dependencies are needed. `engine.js` contains pure
gameplay; `app.js` handles rendering, input, lifecycle and browser storage.

To check offline behavior, first wait for Offline ready on the game page, stop
the local server, then reload the game URL and play a run. Restart the server
afterward. The test-runner page itself is intentionally not cached.

## Prototype scope

Endless play with three paces, one fixed-profile daily course, responsive canvas,
progressive procedural obstacles, collectible coins, cosmetic boat spending,
perfect combos, three missions, changing scenery, synthesized sound, quick
restart, per-pace/daily local bests, pause, and offline core play.
No ads, real-money purchases, accounts, analytics,
external fonts, or third-party assets. Best scores belong to this browser, not
an account. Clearing site data removes records, coins and sound preference.

This is a **fun-validation prototype**, not evidence of demand or revenue.
Try several short attempts on real Android Chrome and iPhone Safari devices:
are failures understandable, does anticipation improve, and do you want another
run? Device testing, retention measurement, monetization experiments, native
packaging, and store publishing remain future decisions.

## Next milestone: small player study

The next step is **fun and comprehension validation**, not ads or native apps.
Recruit 20–30 people who enjoy short mobile games, including both Android Chrome
and iPhone Safari users. Use anonymous participant codes, not names or accounts.
Plan a five-minute session and let each person stop whenever they want.

1. Open a shared HTTPS preview on their phone. Don't explain the controls first:
   ask them to try the game and say what they think holding/releasing does.
   Record whether they understand within their first minute, which help they
   needed, their first chosen pace, and any confusion about coins or obstacles.
2. Observe the first few runs without coaching. Record whether each failure's
   cause was understood and whether transitions felt achievable. Ask them to
   try another pace only after the initial unprompted segment.
3. Give them one minute of free choice: replay, change pace, or stop. Record
   voluntary retries separately from requested test runs. Ask: "What made you
   want another try, or stop?" and "What felt unfair or unclear?"
4. On both phone platforms, test hold/release, dragging a finger off the canvas,
   cancelled/multiple touches, portrait/landscape, tab/app switching, resume,
   sound on/off, device silent mode, and reload persistence of bank, records and
   mute. After Offline ready, switch off network access, reopen the same URL
   and confirm a run, coin pickups and sound still work.

Use a simple sheet with: participant code, device/browser/version, chosen pace,
unaided understanding, failures understood, voluntary retries, unfair moments,
sound preference, bugs and one verbatim comment. Collect only what the person
agrees to share; no analytics backend or personal data is required. Report
counts with denominators, separate prompted from voluntary actions, and separate
platform bugs from fun feedback. This small convenience sample cannot establish
market demand, retention or revenue. Review recurring friction before choosing
the next change; do not treat any results as collected until real sessions occur.

### Sharing the prototype

The static release consists only of the nine files listed in Offline / hosting.
Serve them from a single HTTPS directory; no build, dependencies or credentials.
Do not send `file:` URLs or the local development server as a public service.
The approved GitHub Pages preview uses the repository root of
`rohitsakalle-tiny-tide-prototype` as its publishing source.
`.nojekyll` serves the static game directly, without a build or dependencies.
Pushing updates to that branch republishes the preview. If publishing from a
different branch later, change the Pages source in the repository settings.

Before sharing, smoke-test the approved public URL in Android Chrome and iPhone
Safari, verify Offline ready, and ensure the preview is the intended version.
Further publishing changes should remain owner-approved. Real devices and
access to consenting target players are needed to complete this milestone;
desktop responsive checks are not a substitute.
