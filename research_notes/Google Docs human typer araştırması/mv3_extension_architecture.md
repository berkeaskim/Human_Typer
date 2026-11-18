# Chrome MV3 extension architecture and platform constraints for a slow "human typer" in Google Docs (as of Nov 2026)

Research method note: all pages were fetched live on 2026-11-18 through a summarising fetch tool. Quotes are as returned by that tool; a few pages were only partially readable (flagged in Gaps). Anything not confirmed by a fetched source is placed under Inferences or Gaps, not under Cited Findings.

---

## 1. Which MV3 components are needed, where should the typing loop live, and what are the service-worker lifetime rules?

### Takeaway
An extension service worker dies after 30 s without an event or extension-API call and cannot hold globals, so it should be the coordinator and persistence layer, not the home of a naive hour-long `setTimeout` chain. The loop belongs either in the content script inside the Docs tab (content-script design) or in the service worker only when something officially keeps it alive (an attached `chrome.debugger` session since Chrome 118, or a steady flow of port messages / extension API calls).

### Cited Findings
- Chrome terminates an extension service worker "After 30 seconds of inactivity. Receiving an event or calling an extension API resets this timer"; "When a single request, such as an event or API call, takes longer than 5 minutes to process"; and "When a fetch() response takes more than 30 seconds to arrive." — [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Lifetime-extending changes by version: Chrome 105 `runtime.connectNative()` keeps the worker alive; Chrome 109 "Messages sent from an offscreen document reset the timers"; Chrome 110 "Extension API calls reset the timers" (previously only running event handlers did); Chrome 114 "Sending a message with long-lived messaging keeps the service worker alive" but "Opening a port no longer resets the timers"; Chrome 116 active WebSocket traffic resets the idle timer and more APIs may exceed the five-minute limit; Chrome 118 "Active debugger sessions created using the browser.debugger API now keep the service worker alive"; Chrome 120 "Alarms can now be set to a minimum period of 30s to match the service worker lifecycle." — [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- "Any global variables you set will be lost if the service worker shuts down." "Instead of using global variables, save values to storage." "The Web Storage API is not available for extension service workers." — [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Official stance on keep-alive: "you should design your service worker to be resilient against unexpected termination" and "avoid keeping your service worker alive indefinitely if possible." — [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Side panel: permission `sidePanel`, Chrome 114+; manifest `side_panel.default_path`; `setPanelBehavior({openPanelOnActionClick})` (defaults to false); `sidePanel.open()` (Chrome 116+) "may only be called in response to a user action"; "The side panel remains open when navigating between tabs (if set to do so)"; "As an extension page, side panels have access to all Chrome APIs"; `close()` Chrome 141+, `onOpened` 141+, `onClosed` 142+. — [chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- Offscreen documents: permission `offscreen`, Chrome 109+; "an installed extension can only have one open at a time"; "The runtime API is the only extensions API supported by offscreen documents"; "Offscreen documents can't be focused"; reasons are TESTING, AUDIO_PLAYBACK, IFRAME_SCRIPTING, DOM_SCRAPING, BLOBS, DOM_PARSER, USER_MEDIA, DISPLAY_MEDIA, WEB_RTC, CLIPBOARD, LOCAL_STORAGE, WORKERS, BATTERY_STATUS, MATCH_MEDIA, GEOLOCATION; AUDIO_PLAYBACK "sets the document to close after 30 seconds without audio playing", other reasons have no lifetime limit. — [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- Content scripts can directly use only `dom`, `i18n`, `storage`, and `runtime.connect/getManifest/getURL/id/onConnect/onMessage/sendMessage`; everything else needs messaging to another extension context. — [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

### Inferences
- Recommended component map: (a) service worker = job state machine, persistence, alarms watchdog, tab/debugger ownership; (b) content script(s) in docs.google.com = the actuator that dispatches input (content-script design) and reports progress; (c) side panel = control UI, preferable to a popup because the popup closes on any outside click while the side panel persists across tab switches; (d) `chrome.storage.local` = durable job record; (e) offscreen document = optional, only useful as a timer host or message pump, since it has no API access beyond `runtime` and cannot touch the Docs tab.
- For an hour-long job the 30 s idle rule means: in the content-script design the loop runs in the page and the worker may sleep freely between progress messages (each `runtime.sendMessage`/port message wakes it); in the debugger design the attached session itself keeps the worker alive (Chrome 118+), so a timer loop in the worker is viable, but must still checkpoint because the worker can be killed (browser update, crash, user detaching the debugger).
- The "5 minutes per single request" rule matters if one event handler awaits a long sleep: never `await` a multi-minute delay inside one `onMessage` handler; schedule the next step instead.

### Gaps
- The Chrome MV2 phase-out status was not re-verified in this session. My understanding (unverified here) is that MV2 was disabled for all stable users during 2025; confirm at https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline.
- No official statement found on whether `setTimeout` inside an extension service worker is itself clamped; the lifecycle page only describes the idle/termination timers.

---

## 2. Timer throttling in hidden/background tabs, legitimate workarounds, and focus loss / minimise / sleep

### Takeaway
A content-script loop in the Docs tab runs at full speed only while the page is visible; once hidden its chained timers are checked at most once per second, and after 5 minutes hidden (chain count >= 5, silent 30 s, no WebRTC) only once per minute, and on Energy Saver the tab may be frozen outright. The robust design is to drive timing from outside the throttled page (service worker or debugger design) or to require the Docs tab to stay visible and pause/resume on `visibilitychange`.

### Cited Findings
- Chrome 88 (January 2021) rules. Minimal throttling when "The page is visible" or "The page has made noises in the past 30 seconds" (a silent audio track does not count). Throttling (timers checked once per second) when the chain count is less than 5, or the page has been hidden for less than 5 minutes, or WebRTC is in use ("an RTCPeerConnection with an 'open' RTCDataChannel or a 'live' MediaStreamTrack"). Intensive throttling (checked once per minute) when all of: hidden more than 5 minutes, chain count 5 or greater, silent for at least 30 seconds, WebRTC not in use. — [Heavy throttling of chained JS timers beginning in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- Recommended alternatives in that article are event-driven APIs (observers, WebSockets/SSE/push, media events), not keep-alive tricks; `requestAnimationFrame` "will wait for the page to be visible". — [Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- Chrome 133 (February 2025): with Energy Saver active, Chrome freezes a browsing context group whose pages "have been hidden and silent for more than five minutes" and which is CPU-intensive. Freezing "suspends task execution on a web page" including event handlers, timers and promise resolvers; on return "any queued tasks are executed without loss of state". Exempt: audio/video conferencing (mic, camera, capture), WebRTC with open data channel or live track, external device control (WebUSB/Bluetooth/HID/Serial), and groups that "Hold a Web Lock or an IndexedDB connection that blocks operations outside the group". Service workers are not affected by freezing. Test via `chrome://discards`. — [Freezing on Energy Saver](https://developer.chrome.com/blog/freezing-on-energy-saver)
- Energy Saver can be switched off or sites exempted by the user at chrome://settings/performance (reported in the Blink intent thread summary). — [Intent to Ship: Freezing on Energy Saver](https://groups.google.com/a/chromium.org/g/blink-dev/c/OVoSqEhtpNI)
- `chrome.alarms`: minimum period 30 s since Chrome 120 — [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle). "Alarms continue to run while a device is sleeping. However, an alarm will not wake up a device"; missed alarms fire on wake. `persistAcrossSessions` option added in Chrome 150, default true in Chrome. — [chrome.alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- Dedicated-worker timers: evidence conflicts. A 2018 Blink intent proposed "Throttling background dedicated workers" — [blink-dev intent](https://groups.google.com/a/chromium.org/d/topic/blink-dev/8xpEA-iNHwg); a scheduler-dev thread describes intensive throttling as applying to JS timers and `scheduler.postTask` — [scheduler-dev thread](https://groups.google.com/a/chromium.org/g/scheduler-dev/c/BVQbTtNU8Kw). No current official page confirming a worker exemption was found.
- The offscreen reason `WORKERS` exists ("the offscreen document needs to spawn workers"), and AUDIO_PLAYBACK documents auto-close after 30 s without audio. — [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

### Inferences
- Workaround ranking for a slow typer:
  1. Clock in the service worker, actuation via `chrome.debugger` (`Input.*`): timing is independent of page-timer throttling, and the debugger session keeps the worker alive. Whether Docs processes the input identically when the tab is hidden still needs an empirical test.
  2. Clock in the service worker, per-keystroke `tabs.sendMessage`/port message to the content script: message handlers are not chained timers, so they avoid the chain-count throttle, and each message exchange resets the worker's idle timer. Inter-key gaps are well under 30 s, so the worker stays alive while typing; pauses longer than 30 s need `chrome.alarms` (30 s granularity) to resume.
  3. Clock in the content script with the Docs tab kept visible; listen to `visibilitychange` and auto-pause (or accept 1 s granularity, which is tolerable for slow typing but makes burst rhythm unrealistic; after 5 min hidden it collapses to one wake per minute, which is not acceptable).
  4. Holding a Web Lock in the page avoids Energy Saver freezing per the official exemption list, but does not lift timer throttling.
  5. Audible audio lifts throttling but is user-hostile and silent audio is explicitly not counted; not recommended.
- Tab not focused but window visible in another window/split: page is still "visible", so no throttling. Tab switched away or window minimised: page hidden, rules above apply. Whether a fully covered (occluded) window counts as hidden is platform-dependent and not confirmed here.
- Laptop sleep suspends everything; nothing in an extension can prevent or wake from it except the `chrome.power` API (`requestKeepAwake`), which was not researched in detail. On wake, timers and alarms fire late, so the loop must compute the next action from persisted state plus wall-clock time rather than assume elapsed ticks, and should re-verify the document/caret state before continuing.

### Gaps
- No authoritative current source on whether dedicated Web Worker timers (in a page or in an offscreen document) escape once-per-minute intensive throttling in 2026. Must be measured.
- No source found on whether offscreen documents are treated as hidden pages for timer throttling or freezing.
- `chrome.power.requestKeepAwake` behaviour and its permission warning were not verified (the permissions list reports no warning for `power`, see section 4).
- Maximum number of alarms and unpacked-extension alarm exceptions are not stated on the alarms page.

---

## 3. Injecting into docs.google.com and its iframes; CSP / Trusted Types

### Takeaway
Use a static isolated-world content script on `https://docs.google.com/document/*` with `all_frames` and `match_about_blank`/`match_origin_as_fallback`, and add a MAIN-world script only if page-context access is unavoidable. Docs enforces Trusted Types (fully rolled out August 2023), which constrains MAIN-world code that writes strings into DOM sinks; isolated-world scripts are not subject to the page's Trusted Types headers.

### Cited Findings
- "Content scripts live in an isolated world"; `world` defaults to `ISOLATED`; "When a content script is injected into the main world, the CSP of the page applies." Isolated-world scripts have their own CSP that blocks `eval()` and external script loading. — [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- Manifest keys: `all_frames` (all matching frames vs top frame only), `match_about_blank` (inject into `about:blank` frames whose parent/opener matches; default false), `match_origin_as_fallback` (match on initiator origin; requires path `*`), `run_at` default `document_idle`. — [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- `chrome.scripting`: needs `"scripting"` plus host permission or `activeTab`. `InjectionTarget` = `tabId`, `allFrames`, `frameIds`, `documentIds` (Chrome 106+). `ExecutionWorld` `ISOLATED`/`MAIN` on `executeScript` since Chrome 95; `world` on registered content scripts since Chrome 102; `injectImmediately` Chrome 102+; `registerContentScripts` Chrome 96+; `matchOriginAsFallback` Chrome 119+ covering "about:, data:, blob:, or filesystem:" frames; `persistAcrossSessions` defaults true. `func` "will be serialized, and then deserialized for injection" and must be self-contained. — [chrome.scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- Trusted Types in Workspace: announced 23 Feb 2023; applies to Docs, Sheets, Slides, Forms, Sites, Jamboard, Drawings, Drive, Calendar; paused 26 Apr 2023; "has fully rolled out" as of 2 Aug 2023. It "will require third-party extensions to use typed objects instead of strings"; affected group is developers "relying on any Chrome extensions that modify DOM APIs"; fixes are removing offending code, using a library (google/safevalues), or creating a Trusted Types policy. No admin or user control. — [Trusted Types in Google Workspace](https://workspaceupdates.googleblog.com/2023/02/trusted-types-in-google-workspace.html)
- "Content script isolated worlds are not affected by Trusted Types headers set by the web page"; code injected into the page context is affected. Workarounds: keep DOM work in the content-script world, use non-sink APIs (`textContent` instead of `innerHTML`), use DOMPurify/safevalues, or `trustedTypes.createPolicy`; a `default` policy is discouraged because only one is allowed per document and extensions race for it. — [W3C Trusted Types wiki](https://github.com/w3c/trusted-types/wiki/Effects-of-deploying-Trusted-Types-on-browser-extension-developers)
- Other browsers differ: a WebKit bug reports page Trusted Types affecting Safari extension content scripts, and a Mozilla bug reports Trusted Types blocking WebExtension content scripts in isolated and main worlds (closed). — [WebKit bug 290037](https://bugs.webkit.org/show_bug.cgi?id=290037); [Mozilla bug 1947732](https://bugzilla.mozilla.org/show_bug.cgi?id=1947732)
- Injecting a `<script>` tag from a content script runs in page context and is bound by page CSP; the supported route is `world: "MAIN"` via manifest/`registerContentScripts`/`executeScript`. — [chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/MsNA5ZdN7fs)
- `chrome.debugger` iframe handling: flat sessions since Chrome 125; child targets via `Target.setAutoAttach` with `flatten: true` and `sessionId` on `sendCommand`; auto-attach is not recursive; same-process iframes appear as execution contexts of the same target. — [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)

### Inferences
- A typer only dispatches events and does not write HTML strings into sinks, so Trusted Types should rarely bite; the usual breakage is `innerHTML`, `eval`, `new Function`, or string `setTimeout` in MAIN-world code or in bundler/runtime helpers. Keep any injected UI in the side panel rather than in the Docs DOM.
- Synthetic `KeyboardEvent`s created by script have `isTrusted === false` in any world; only the debugger `Input` domain produces browser-generated input. Which of these Docs accepts is a question for the Docs-internals researcher, but it is the main reason the `debugger` design exists.
- Prefer static `content_scripts` in the manifest for the always-on listener (survives worker restarts, no injection race) and `scripting.executeScript` only for on-demand/after-install injection into already-open Docs tabs.

### Gaps
- The exact CSP header and `require-trusted-types-for` / `trusted-types` directive values currently served by docs.google.com were not captured (the blog shows the directive only as an image). Inspect response headers on a live document.
- The structure of the Docs editor's input iframe (commonly described as an `about:blank`-style text-event-target iframe, which is why `all_frames` + `match_about_blank` are suggested) was not verified against a primary source here.
- Chrome version in which the manifest `content_scripts[].world` key shipped is not stated on the content scripts page (the scripting page gives Chrome 102 for registered scripts).

---

## 4. Permissions per design and Chrome Web Store review implications

### Takeaway
The content-script design needs only no-warning API permissions plus a single-site host permission; the `debugger` design triggers the strongest install warning and extra review scrutiny; the Docs API design moves the burden to Google OAuth verification of the sensitive `documents` scope (or avoids it with the non-sensitive `drive.file`). The Web Store policies have no rule on academic dishonesty, but the deception and single-purpose rules apply.

### Cited Findings
- Install warnings: `debugger` shows "Access the page debugger backend." and "Read and change all your data on all websites."; `tabs` shows "Read your browsing history."; `identity`, `storage`, `alarms`, `offscreen`, `scripting`, `activeTab`, `sidePanel`, `unlimitedStorage`, `power` show no warning. — [Permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- `chrome.debugger` exposes a restricted set of CDP domains that includes `Input` (also DOM, Runtime, Page, Target, Emulation, etc.). `onDetach` fires when the tab closes or DevTools is opened for the attached tab. Enterprise `runtime_blocked_hosts` policy blocks attach with "This page cannot be scripted due to an ExtensionsSettings policy." — [chrome.debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- Review time: "For most extensions, review is completed within a few days, but it can take up to a few weeks"; contact support if pending more than three weeks. Signals for closer review: new developers, new extensions, dangerous permission requests, significant code changes. Broad host permissions (`*://*/*`, `https://*/*`, `<all_urls>`) and sensitive execution permissions lengthen review; "Review must verify that each requested permission is actually necessary and is used appropriately." Obfuscation is disallowed; minification allowed. A rejection leaves the published version untouched and names the violated policy. — [CWS review process](https://developer.chrome.com/docs/webstore/review-process)
- Policies: "An extension must have a single purpose that is narrow and easy to understand." "Request access to the narrowest permissions necessary" and do not "future proof". MV3: "the full functionality of an extension must be easily discernible from its submitted code"; remote logic is only allowed via documented APIs, namely the Debugger API and User Scripts API. "Developers must not obfuscate code or conceal functionality." Deception: "Don't misrepresent the functionality of your product or include non-obvious functionality." The policy page contains no mention of academic dishonesty or of automating user input; nearest rule is no sending messages on a user's behalf without confirmation. — [CWS program policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- Docs API scopes: `https://www.googleapis.com/auth/documents` = Sensitive ("See, edit, create, and delete all your Google Docs documents."); `documents.readonly` = Sensitive; `drive.file` = Non-sensitive, recommended ("only the specific Google Drive files you use with this app"); `drive` and `drive.readonly` = Restricted. Sensitive scopes require additional app verification; restricted scopes require restricted-scope verification and a security assessment if data is stored or transmitted via servers. — [Docs API scopes](https://developers.google.com/workspace/docs/api/auth)
- Sensitive-scope verification "can take up to 10 days" per the current developer page — [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification); an older help page says verification might take several months depending on data sensitivity — [OAuth API verification FAQs](https://support.google.com/cloud/answer/9110914?hl=en-GB). Sources conflict; treat 10 days as the nominal figure.
- Unverified apps show the unverified-app screen and are "limited to 100 new users until it is verified"; the cap is over the project lifetime. — [Unverified apps](https://support.google.com/cloud/answer/7454865?hl=en)
- `chrome.identity`: permission `identity`; `getAuthToken` uses the manifest `oauth2` client ID and scopes, caches tokens in memory and handles expiry; "do not use getAuthToken interactively when your app is first launched"; `launchWebAuthFlow` redirects to `https://<app-id>.chromiumapp.org/*`; `removeCachedAuthToken` for invalid tokens. — [chrome.identity](https://developer.chrome.com/docs/extensions/reference/api/identity)

### Inferences
- Design A (content script only): `permissions: ["storage","alarms","sidePanel","scripting"]`, `host_permissions: ["https://docs.google.com/document/*"]`. Lowest review friction; one site-specific warning.
- Design B (`debugger`): add `"debugger"` (and typically `"tabs"` or `activeTab`). Users see the "all your data on all websites" warning at install, and reviewers must be convinced that trusted input into Docs is the single purpose. Because the Debugger API is also one of two channels where remote logic is permitted, it is a known abuse vector and likely to draw manual review. Expect days-to-weeks, not hours.
- Design C (Docs API `documents.batchUpdate` via `identity`): no page injection at all and immune to tab throttling (calls can be made from the service worker; `fetch` must return within 30 s), but edits arrive as API revisions rather than keystrokes, and public distribution needs OAuth verification (homepage, privacy policy, demo video are typical requirements, not verified here). `drive.file` avoids sensitive-scope verification but only covers files the app created or the user opened with it (e.g. via Picker), which fits "type into a doc the tool creates" but not "any open doc".
- Because the product simulates human typing, the store listing must describe that plainly; hiding it would fall under the deceptive-behaviour and "non-obvious functionality" clauses. The policy does not ban the category, but Google has discretion and this remains a listing risk.

### Gaps
- The exact install-warning string for a single-host permission such as `https://docs.google.com/*` was not on the fetched permissions page. (Expected form is a site-specific "read and change your data on docs.google.com", unverified.)
- The yellow "started debugging this browser" infobar shown while `chrome.debugger` is attached is not described on the API page fetched; its current wording and whether it can be suppressed without the `--silent-debugger-extension-api` flag were not confirmed.
- No published statistics on review-time distribution; no documentation of staged/deferred publishing on the review page.
- Whether `getAuthToken` works in Edge or other Chromium browsers is not stated on the identity page.
- No evidence was found either way about takedowns of existing "auto typer for Google Docs" extensions.

---

## 5. Persisting job state for pause/resume and crash recovery; UI-to-worker communication

### Takeaway
Persist the durable job record (text, cursor index, schedule parameters, status) in `chrome.storage.local` and keep only ephemeral runtime flags in `chrome.storage.session`. Use a long-lived `runtime.Port` for live progress to the side panel and one-shot messages for commands, with every context able to rebuild from storage after a disconnect.

### Cited Findings
- `storage.local`: `QUOTA_BYTES` 10485760 (10 MB; 5 MB in Chrome 113 and earlier), measured on JSON-stringified values plus key lengths; lifted by `unlimitedStorage`; exposed to content scripts by default; cleared only when the extension is removed; over-quota writes reject immediately. — [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- `storage.session`: Chrome 102+, 10 MB (1 MB in Chrome 111 and earlier), held in memory and not written to disk; not exposed to content scripts unless `setAccessLevel("TRUSTED_AND_UNTRUSTED_CONTEXTS")`; cleared when the extension is disabled, reloaded or updated and when the browser restarts. — [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- `storage.sync`: 102400 bytes total, 8192 bytes per item, 512 items, 120 writes per minute, 1800 writes per hour. — [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- Messaging: one-time `runtime.sendMessage()` / `tabs.sendMessage()`; long-lived `runtime.connect()` / `tabs.connect()` returning a `runtime.Port`; `onDisconnect` fires when no receiving port remains, e.g. "The tab containing the port is unloaded (for example, if the tab is navigated)"; "The maximum size of a message is 64 MiB"; Chrome serialises with JSON (other browsers use structured clone); "From Chrome 148, you can return a promise from a message listener to respond asynchronously" (rolling out gradually; otherwise return literal `true`); from Chrome 146 a throwing `onMessage` listener rejects the sender's promise. — [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- Port messages keep the worker alive, but opening a port alone does not (Chrome 114). — [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Alarms persist across browser sessions by default in Chrome (`persistAcrossSessions`, Chrome 150). — [chrome.alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)

### Inferences
- `storage.sync` is unsuitable for job state: 8 KB per item cannot hold a long text and 1800 writes/hour is below a per-keystroke checkpoint rate.
- Checkpoint the cursor index to `storage.local` on a coarse cadence (every N characters or every few seconds, and on pause/`visibilitychange`/`onDisconnect`) rather than per keystroke; an hour of typing at ~5 chars/s is ~18,000 keystrokes, and write-rate behaviour of `storage.local` under that load was not documented in the fetched page.
- Crash recovery cannot trust the saved index alone: after a tab crash or worker kill, some keystrokes may have landed after the last checkpoint. On resume, reconcile against the actual document tail (read back text) before continuing.
- Suggested state machine: `idle -> running -> paused(user|hidden|error) -> running -> done`, stored as one record keyed by job ID with `tabId`/document ID, text hash, index, RNG seed for the timing model, and `updatedAt`. Register a 30 s `chrome.alarms` watchdog while a job is `running` so a dead loop is detected and restarted.
- `tabId` is not stable across browser restarts, so resume by document URL/ID.
- Service worker event listeners must be registered synchronously at top level so wake-ups deliver events (standard MV3 guidance; not quoted from a page fetched here).

### Gaps
- The messaging page does not document port behaviour on bfcache or on service-worker termination; reconnect logic in the content script and side panel must be tested.
- No documented write-rate limit for `storage.local`/`storage.session` was found on the storage page.

---

## 6. Recommended 2026 toolchain and end-to-end testing

### Takeaway
WXT with TypeScript is the best-supported framework choice per the available comparison (which is WXT's own page); Plasmo is reported to be in maintenance mode and CRXJS partially maintained. End-to-end tests run Playwright's bundled Chromium with a persistent context and the unpacked extension, since branded Chrome and Edge no longer accept the side-loading flags.

### Cited Findings
- WXT's comparison table rates WXT as maintained, with all-browser support, MV2 and MV3 output, UI HMR, content-script reload, automated publishing, and all front-end frameworks; Plasmo "Appears to be in maintenance mode with little to no maintainers nor feature development happening"; CRXJS is marked partially maintained, with partial browser support and no automated publishing. Source is the WXT project itself, so it is not neutral. — [WXT comparison](https://wxt.dev/guide/resources/compare.html)
- Playwright: "Extensions only work in Chromium when launched with a persistent context"; launch with `chromium.launchPersistentContext(userDataDir, { channel: 'chromium', args: ['--disable-extensions-except=<path>', '--load-extension=<path>'] })`; the `chromium` channel "allows to run extensions in headless mode"; Google Chrome and Microsoft Edge removed the command-line flags needed to side-load extensions, so use the bundled Chromium. Get the worker with `browserContext.serviceWorkers()` or `waitForEvent('serviceworker')` and the ID from `serviceWorker.url().split('/')[2]`. — [Playwright: Chrome extensions](https://playwright.dev/docs/chrome-extensions)
- Playwright notes MV3 workers "are automatically suspended after ~30 seconds of inactivity and restarted on demand"; it keeps the same Worker handle, and in-flight `evaluate()` calls at the moment of suspension throw "Service worker restarted". — [Playwright: Chrome extensions](https://playwright.dev/docs/chrome-extensions)
- Offscreen `Reason.TESTING` exists for test purposes. — [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

### Inferences
- Test pyramid: (1) unit-test the timing model and state machine in Vitest with fake timers; (2) integration-test the content script against a local stub page that mimics the Docs input surface; (3) a small Playwright suite against a real Google Doc using a dedicated test account and a saved `userDataDir`/storage state, asserting on document text read back through the Docs API or export URL.
- Real-Docs E2E is fragile: Google sign-in tends to challenge automated Chromium, so log in once manually into the persistent profile and reuse it; keep these tests out of the per-commit CI path.
- Throttling behaviour should be tested explicitly: open a second tab to hide the Docs tab for more than 5 minutes and measure keystroke cadence; force worker termination from `chrome://serviceworker-internals` to exercise recovery.
- Because CWS forbids obfuscation but allows minification, keep source maps and a reproducible build to speed up review.

### Gaps
- Puppeteer's current extension-loading guidance was not fetched.
- No independent (non-WXT) 2026 comparison of WXT, Plasmo and CRXJS was retrieved; current release status of CRXJS v2 and Plasmo is unverified.
- Whether WXT's main-world content-script support is first-class was not covered by the comparison page.

---

## 7. Portability to Firefox, Edge and Safari

### Takeaway
The content-script design ports with modest changes (dual `background` keys, sidebar instead of side panel); the `debugger` design is Chromium-only because Firefox does not implement `chrome.debugger`. Firefox MV3 uses event pages rather than service workers, and host permissions there are user-revocable.

### Cited Findings
- `background.service_worker` in MV3: Chrome supported; Firefox not supported (bug 1573659); Safari supported. `background.scripts`/`page`: ignored by Chrome 121+ in MV3 (earlier versions refused to load), supported by Firefox and Safari. Declaring both `"scripts": ["background.js"]` and `"service_worker": "background.js"` works cross-browser (Firefox 121+ starts the event page regardless); Safari uses `scripts` unless `preferred_environment` prefers `service_worker`. Event pages "may be unloaded from memory when idle and recreated when needed". — [MDN: background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- "In Firefox: Chrome's debugger API is not implemented." Firefox uses `sidebar_action`/`sidebarAction`, Chrome uses `side_panel`/`sidePanel`. Chrome exposes the `browser` namespace with promises from Chrome 148. Firefox uses structured clone for messages, Chrome uses JSON. Firefox content scripts see Xray-wrapped page objects and their global is not strictly `window`. — [MDN: Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities)
- Firefox MV3: generally available since Firefox 109; event pages since Firefox 106; from Firefox 127 host permissions in `host_permissions` and `content_scripts` are shown and granted at install, and users can revoke them at any time; `scripting` API replaces `tabs.executeScript`. — [Firefox MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
- Trusted Types interaction with extension content scripts has had browser-specific bugs in Safari and Firefox. — [WebKit bug 290037](https://bugs.webkit.org/show_bug.cgi?id=290037); [Mozilla bug 1947732](https://bugzilla.mozilla.org/show_bug.cgi?id=1947732)

### Inferences
- Edge is Chromium-based, so the Chrome build should run largely unchanged, including `debugger`, `sidePanel` and `offscreen`; the likely exception is `identity.getAuthToken`, which depends on Google account integration, so use `launchWebAuthFlow` for a portable OAuth path. Edge has its own store and review. None of this was verified against Microsoft documentation in this session.
- Firefox port: swap service worker for event page (same idle-unload discipline), `sidePanel` for `sidebar_action`, drop `offscreen` (an event page has a DOM), check host permission at runtime with `permissions.contains`, and re-test timer throttling since Firefox's background-tab rules differ from Chrome's.
- Safari port requires an Xcode-wrapped app and App Store distribution and has the weakest API parity; treat as a separate project.
- A framework such as WXT that emits per-browser manifests reduces this to configuration plus a thin API-adapter layer.

### Gaps
- Apple's Safari compatibility page could not be read (only the title was returned), so Safari support for `scripting` `world: "MAIN"`, `sidePanel`, `offscreen`, `storage.session` and packaging steps is unverified.
- Firefox support and minimum version for `world: "MAIN"`, `storage.session`, and `offscreen` were not confirmed (the migration guide was truncated before those sections).
- Edge-specific documentation was not consulted.
- Firefox's own background-tab timer-throttling rules were not researched.
