# Closed-source "human typer" extensions for Google Docs: static analysis of shipped code (18 Nov 2026)

## Method and limits

- Each CRX was downloaded from Google's update endpoint (`clients2.google.com/service/update2/crx`), unzipped into its own directory and read only. Nothing was executed, loaded or installed. Minified files were pretty-printed with prettier, run from outside the extension directories.
- Every claim is tagged **[code]** (read directly in the shipped files) or **[inferred]** (my conclusion from what the code does; not tested in a browser).
- Nothing here was run against a live Google Doc, so "works / does not work" statements are inferences from code and from the vendors' own code comments.
- Extraction root: `/private/tmp/claude-501/-Users-berkeaskim-Library-Application-Support-Claude-scratch-workspaces-b50cc8fc-2860-48b9-aedc-dad59c1cddcd-f44f8bf2-86fb-46dc-a984-9f62a9a2387d-scratch-2026-11-18-2eb589/50801c8d-3765-4ed9-b203-31cd513c91ba/scratchpad/crx` (one subdirectory per extension; pretty-printed copies in the sibling `fmt` directory).

All eight downloads succeeded.

| Name | Extension ID | Version | Code state |
|---|---|---|---|
| Duey.ai | `ilamopeagajnekeaogejpdmffneankjf` | 4.0.1 | Minified bundles (Vite/React), readable after formatting |
| Auto Typer | `bgpnjdahpmkaflfpbkdplndklnmghklp` | 3.4.3 | Minified, small, fully read |
| Write It | `agbpbjhbeamdedbialaafmhnjaajacfk` | 3.2.3 | Unminified with extensive comments; very large (1 MB content script), read selectively |
| Human Auto Typer | `ejbpcjfncagifihhndhpbcijnpbkklkb` | 1.0.13 | Unminified typing code; minified paywall SDK |
| Natural Typist | `mfdeophbahbbbonmgbdhchlcjmenhlfd` | 1.5.7 | Minified, small, fully read |
| SynthTyper (extra) | `jndflkicnagegjddbehclbifmkfemgch` | 2.0.1 | Unminified with comments; engine read, UI skimmed |
| Phrasly (extra) | `ekaehdifekfielghgakeoeejngamapbb` | 1.0.1 | Minified; skimmed only |
| HumanTyper (extra) | `emnddjmjlkmgkdcfcpgppmibpekkgifp` | 2.3.14 | Unminified; skimmed only |

## Headline findings

1. **Nobody in the top tier uses `chrome.debugger` in the store build.** No analysed manifest requests the `debugger` permission. Every extension types into Google Docs with synthetic DOM `KeyboardEvent`s dispatched inside `.docs-texteventtarget-iframe`. [code]
2. **Duey ships a complete CDP typing path that is dead in this build.** Its service worker contains `chrome.debugger.attach` + `Input.dispatchKeyEvent` code restricted to Docs URLs, but the manifest has no `debugger` permission (not even optional), so the worker registers a stub that answers `not-supported`. [code] Write It's source says its Slides typer was previously debugger-based and was replaced by plain DOM events. [code comment]
3. **Duey and Auto Typer are the same codebase family.** Auto Typer's content script contains a `[duey multi]` log tag, the same landing-check, list-guard and marker classes as Duey, and its popup posts feedback to a `duey-ai` cloud function and links to Duey Pro. [code]
4. **Human Auto Typer and Natural Typist share one engine.** Identical neighbour-key table, identical delay formula, identical event sequence; Human Auto Typer's comments call it "ORIGINAL logic". [code]
5. **The two revenue leaders moved the human model to a server.** Duey Pro fetches a packed typing plan from a cloud function; Write It fetches action batches from an AWS Lambda for every signed-in run. The local code only executes instructions. [code]
6. **Only Write It has a real "laptop closed" mode, and it is the Google Docs API on their backend**, behind a feature flag. Duey 4.0.1 contains no such code. [code]
7. **Background-tab survival is a solved pattern:** a 10 Hz oscillator at gain 0.001 (tab counts as audible, so timers are not throttled), plus a `document.hidden` / `visibilityState` override, plus optionally moving the timer to the service worker. [code]

---

## 1. Duey.ai (`ilamopeagajnekeaogejpdmffneankjf`, v4.0.1)

### Manifest [code]
- Permissions: `offscreen`, `storage`, `alarms`, `tabs`, `sidePanel`. No `debugger`, no `scripting`, no `identity`. `optional_permissions` is empty.
- Host permissions: only Google auth/API hosts (`apis.google.com`, `www.gstatic.com`, `www.googleapis.com`, `securetoken.googleapis.com`). Access to Docs comes from content-script matches, not host permissions.
- Content scripts: a loader on `docs.google.com/document/d/*`, `docs.google.com/presentation/d/*` and `*.officeapps.live.com/*` with `all_frames: true`; a separate generic script (`anywhere.iife.js`) on `<all_urls>` excluding those; an auth bridge on `app.duey.ai/extensionGoogleAuth*`.
- `externally_connectable.ids`: one other extension, `oilkflafeapjagghnplcdonbcokdfckd`. The worker accepts external messages only from that ID. What that extension is could not be determined (see "not verified").
- Side panel UI; commands for toggling the panel and an emergency stop (Ctrl/Cmd+Shift+S).
- The offscreen document hosts an iframe to `app.duey.ai/extensionGoogleAuth` and relays Firebase sign-in tokens. It is used for authentication only, not for timing.

### Where the code runs [code]
- The isolated-world loader appends `<script src=chrome-extension://…/index-st5Wnz6A.iife.js>` to the page. The whole typing engine, its UI and its state therefore run in the page's **MAIN world**.
- MAIN world and service worker talk through `window.postMessage` relayed by the loader (message types such as `GENERATE_TYPING_PLAN`, `CHECK_SUBSCRIPTION_STATUS`, `CDP_ATTACH`, `CDP_DISPATCH_KEY`).

### Text insertion [code]
- Target: `document.querySelector(".docs-texteventtarget-iframe").contentDocument.activeElement`.
- Normal character: `keydown` → `keypress` → `keyup`, each with `key`, `code`, `keyCode`, `which`, `charCode`, `shiftKey`. Shifted characters are wrapped in a `ShiftLeft` keydown/keyup. No `beforeinput`/`input` on this path.
- Enter, Backspace, Tab, arrows: mapped keys through the same dispatcher.
- **Non-BMP characters (emoji, surrogate pairs)**: inserted with a synthetic `ClipboardEvent("paste")` carrying a `DataTransfer` with `text/plain`.
- **Lower-case letter at the start of a line**: also inserted via synthetic paste. [inferred] purpose: stop Docs' auto-capitalisation from changing the first letter.
- **List guard**: a small model of the current paragraph. When a space would follow a list-looking prefix (`-`, `*`, `1.`, `a)` …), it backspaces the prefix, types the space, presses ArrowLeft, retypes the prefix, presses ArrowRight. [inferred] purpose: avoid Docs' automatic list detection without touching preferences.
- **"Observable" path (Pro mode)**: per key it first asks the worker for a CDP key event; if that fails it falls back to the synthetic keystroke and additionally fires an `InputEvent("input")` (`insertText` / `deleteContentBackward`). In this store build the CDP request always fails (`not-supported`) and the path is marked dead after the first attempt.
- **Focus guard**: capture-phase listeners on the iframe document cancel real (`isTrusted`) key events during a run, so the user cannot type into the run.
- **Landing verification**: reads the caret overlay position (`.kix-cursor` rectangle plus `.kix-appview-editor` scroll offset). After the first 6 characters, then every 60, it checks that the caret moved; if not, waits 1.5 s, rechecks, and otherwise raises a "typing not landing" error and pauses. Checks are skipped while the tab is hidden.
- Multi-block placement and pause markers use invisible characters and the Find & Replace dialog (same mechanism as Auto Typer, described in section 2).
- A "Replay" feature reads the document's own revision log through Docs' internal `revisions/tiles` and `revisions/load` endpoints using the page token (read-only).

### Timing loop and throttling [code]
- The loop is an async chain in the MAIN world using plain `setTimeout` sleeps.
- While typing: a silent oscillator (10 Hz, gain 0.001) is started; `document.hidden`, `document.visibilityState` and `document.hasFocus` are overridden on the page's own `document` (effective because this is the MAIN world); the real `hidden` getter is captured first so Duey's own logic still sees the truth. Optional `[NN%]` tab-title progress.
- Service worker: a `keepAlive` alarm every 0.5 min. The worker is not on the typing path in standard mode, so worker shutdown does not stop typing. [inferred]
- UI text says the browser will ask to keep the computer awake; no wake-lock or `power` call exists in this package (see "not verified").

### Human model
**Standard (local) mode** [code]
- Presets (WPM / accuracy / correction delay / break frequency / break length): Natural 50 / 0.97 / 1500 ms / 0.08 / 1–2 s; Fast 100 / 0.98 / 800 ms / 0.03 / 0.5–1.5 s; plus age-banded Beginner/Intermediate/Expert presets from 30 to 65 WPM. UI range 15–150 WPM.
- Base delay = 60000 / (WPM × 5), divided by a user "speed nudge" of 0.75–1.25.
- Per-key delay is **log-normal** around the base (sigma 0.3), multiplied by a bigram factor (about 40 common English pairs at 0.72–0.85; awkward pairs such as `qz`, `zx` at 1.22–1.4) and a punctuation factor (space 1.1–1.5, sentence end 1.3–2.0, comma 1.2–1.6, colon/semicolon 1.2–1.7, newline 2–4). Clamped to [max(40 ms, 0.15 × base), 8 × base].
- Errors are **quota-driven**: target count = round((1 − accuracy) × text length); per-character probability = remaining quota ÷ remaining characters, doubled in the last 30% and quadrupled in the last 10%. Wrong character comes from a QWERTY neighbour table that also covers digits, punctuation and space.
- Notice lag: after an error it keeps typing 0–1 more characters (58%), 2–4 (27%), 5–9 (11%) or 10–18 (4%) before fixing.
- Correction delay: log-normal around max(150 ms, 0.6 × correction speed), sigma 0.35.
- Three correction styles: arrow back N, Backspace, retype, arrow forward N ("legacy"); backspace everything and retype (used when ≤5 characters were typed since the error and "enhanced correction" is on); arrow back, Shift+ArrowLeft to select the wrong character, type over it, arrow forward. Cursor steps 120 ms ± 40%, turnaround 360 ms (70/140 in Fast).
- Micro-breaks: same quota mechanism with rate breakFrequency ÷ 5 per character, uniform length within the preset range.
- A long-break scheduler exists (run 2–10 min, then break 1–5 min); I did not trace exactly which modes enable it.
- **Sittings**: with 2 sittings on Docs, the text is split at the paragraph break nearest the middle (never inside the first or last sixth) and a fixed 35-minute break is inserted. UI strings explain this in terms of Docs creating a new version-history entry only after several idle minutes.
- Word Online: typos disabled.

**Pro mode** [code]
- The worker POSTs the text (or a rich "plate" document) and config with a Firebase ID token to `…cloudfunctions.net/generateTypingPlanPro` (or `…ProV2`). The response is a packed binary plan decoded with a per-request nonce.
- Instruction vocabulary: `typeChar` (char + delay), `typeError` (wrong and correct char), `correctError` (characters since error), `pause` (reasons: sentence end, paragraph end, thinking), plus formatting operations (heading, mark toggle, list start, indent/outdent, link).
- Client-side adjustments only: delays divided by a speed multiplier; planned errors are skipped probabilistically according to a few/natural/many mistakes setting.
- The server-side delay and typo model is not in the package.

### Laptop-closed sessions
No Docs API call, no Docs/Drive OAuth scope, no server-typing endpoint in v4.0.1. [code] Whatever the listing means by sessions that survive a closed laptop is not implemented in this extension package.

### Gating [code, high level]
Firebase auth; subscription status from Firestore and `app.duey.ai/api/account/billing`; Pro plan generation, extra blocks and Word Online sessions are gated; a free-session counter exists.

### Turkish / non-US layouts
- Characters outside the built-in map fall back to `key = char`, `code = "Key" + upper(char)`, `keyCode = charCode`. So `ş` is sent as a keypress with charCode 351. [code] Docs appears to take the character from the keypress charCode, so this should insert correctly. [inferred]
- Typo neighbours are US-QWERTY only; Turkish letters never receive a typo, and bigram speed-ups are English-only. [code]
- UI is localised (8 languages); Turkish was not among the bundles I saw. [code]

---

## 2. Auto Typer (`bgpnjdahpmkaflfpbkdplndklnmghklp`, v3.4.3)

### Manifest [code]
- Permissions: `activeTab`, `storage`, `sidePanel`, `scripting`, `tabs`, `declarativeNetRequest`. Host permissions `<all_urls>`.
- One content script on `<all_urls>`, `all_frames: true`, `document_end`, isolated world.
- A declarativeNetRequest rule strips `X-Frame-Options` and CSP headers for ChatGPT, Claude and Gemini when framed by the extension (to embed those sites in the side panel). Unrelated to typing but a notable permission footprint.
- No alarms, no offscreen, no identity, no debugger.

### Text insertion [code]
- Target: the `[contenteditable="true"]` element inside the `.docs-texteventtarget-iframe` document.
- Two engines selectable in the UI (`engineV2` flag):
  - **v1 (default)**: `keydown` → `keypress` → `InputEvent("beforeinput", insertText | insertParagraph)` → `keyup`. On macOS and ChromeOS the `keypress` is skipped. [inferred] reason: avoid double insertion there.
  - **v2**: `keydown` → `keypress` (printable keys only) → `keyup`, no `beforeinput`.
- Backspace: a single `keydown` only. Tab: keydown + keyup.
- v2 on Docs adds the same list guard as Duey; v2 also collapses blank lines in the input.
- After every key it dispatches a fake `focus` on window and iframe and a `visibilitychange` on the document.
- Landing verification identical to Duey (6 characters, then every 60, 1.5 s grace, caret overlay as signal).
- Fallbacks by surface: Word Online uses `document.execCommand("insertText" / "delete")` on `#WACViewPanel_EditingElement` and a synthetic paste of an empty paragraph for Enter, with autocorrect replacement events cancelled; generic contenteditable uses `execCommand`; inputs/textareas set `.value` and fire `input`.
- **Document lock**: capture-phase listeners cancel real mouse, key, clipboard and drag events while typing.
- **Multi-block placement** (up to 62 blocks): the user clicks a spot; the extension types a 6-character code made of invisible characters U+2062/U+2063 there. Later it opens Docs' Find & Replace (synthetic Ctrl+H or Cmd+Shift+H), searches for the code, checks the match counter reads 1 of 1, replaces it with nothing (which leaves the caret there) and closes the dialog. Pause/resume in multi mode uses the same trick with a reserved marker.

### Timing loop and throttling [code]
- **The loop lives in the service worker.** On start it precomputes the complete schedule (`events[]` with absolute `atMs`), then chains `setTimeout` and sends one `typeChar` message per event to the tab. If a round trip takes more than 50 ms the schedule is shifted by that amount.
- Progress (text, full schedule, index) is written to `chrome.storage.local` every 50 events and on pause, so a run can be resumed with the identical schedule.
- No alarm or explicit keep-alive was found. [code] The worker presumably stays alive because it handles a message every few hundred ms; a user-configured pause longer than the idle limit could let it be terminated mid-pause. [inferred]
- In the tab: silent oscillator (10 Hz, gain 0.001) and `document.hidden` / `visibilityState` / `hasFocus` overrides. These overrides are applied from the isolated world, so they probably do not change what Docs' own code sees (Write It's source states exactly this limitation). [inferred]

### Human model [code]
- Inputs: base delay in ms (default 120), accuracy (default 97), optional em-dash replacement (types `, ` instead), "natural typing" toggle, optional sentence long-break (frequency % and duration), optional line pause.
- Natural off: delay = base × uniform(0.7, 1.3).
- Natural on: multiplier starts at 1; ×1.15 for capitals and shifted symbols; ×1.18 for digits and unshifted punctuation; ×1.3 for newline; ×0.95 for space; ×0.82 for 50 common English bigrams; ×1.28 when two consecutive keys use the same finger (finger map for US QWERTY); then × exp(0.22 × standard normal); clamped to 0.45–2.6.
- Pauses: paragraph 4–12 s; sentence end 1.5–5 s; clause (after `,;:` with 55% chance) 0.4–1.2 s; a "micro" pause of 0.3–1.5 s at a space after every 5–15 characters.
- Typos are **word-level and deterministic in rate**: an accumulator adds (100 − accuracy)/100 per letter; when it reaches 1 at the start of a word of ≥3 ASCII letters, the whole word is typed wrong, then backspaced to the error position and retyped. Types: swap two adjacent letters, double a letter, insert an extra neighbour key, substitute a neighbour key.
- Backspaces are timed at 0.7 × a normal key delay.
- Word Online: accuracy forced to 100.

### Gating
No sign-in, licence or paywall code found; the popup uses Firebase Remote Config and Google Analytics and promotes Duey Pro. [code] Appears to be a free funnel product. [inferred]

### Turkish / non-US layouts
- Word detection and typo eligibility use `[a-zA-Z]` only, so a word containing ç, ğ, ı, ö, ş, ü is split into ASCII fragments; typos land only in fragments of ≥3 ASCII letters. [code]
- Non-ASCII letters are sent with `keyCode = charCode` and `code = "Key" + upper(char)`. [code]

---

## 3. Write It (`agbpbjhbeamdedbialaafmhnjaajacfk`, v3.2.3)

### Manifest [code]
- Permissions: `activeTab`, `storage`, `scripting`, `identity`, `tabs`, `sidePanel`, `contextMenus`, `webNavigation`, `alarms`; optional `clipboardRead`. Host permissions `<all_urls>`.
- `oauth2` block with only email/profile/openid scopes; broader Google scopes (`drive.file`, `documents`) are requested at runtime through `chrome.identity` / `launchWebAuthFlow`.
- Docs content scripts in **both worlds**: MAIN at `document_start` (selection handling) and `document_idle` (visibility bridge); isolated at `document_end` (typing engine and helpers). Separate sets for Slides and Word Online (the latter with `all_frames`).
- CSP `connect-src` lists `docs.googleapis.com`, AWS API Gateway (HTTPS and WebSocket), Lambda URLs and S3.
- `externally_connectable` for `write-it.us` and `write-it.ai`.
- No `debugger`. A source comment states DOM events are "the only way the extension types into those editors; it needs no `debugger` permission". The file `slides-cdp-typer.js` keeps its name from an earlier debugger-based version.

### Text insertion [code]
- Docs typing runs in the **isolated** content script; target is the iframe's active element.
- Printable character: optional Shift keydown, `keydown`, `keypress`, `keyup`, optional Shift keyup, with `keyCode`, `which`, `charCode` set in the event init. Enter: keydown/keypress/keyup then a 50 ms wait. Non-printable keys: keydown + keyup only.
- Source comments record live findings: Docs and Slides accept these events at the iframe's active element; legacy fields must be in the init dictionary because a property defined from one JS world is invisible to handlers in another; a Ctrl chord needs a separate Control keydown first.
- **Verified cursor moves**: because Docs processes synthetic keys asynchronously, every arrow or Backspace used in an in-place correction is confirmed against the caret overlay (`.kix-cursor-caret`): the next key is sent only after the caret has moved and been still for ~60 ms. If the walk back cannot be confirmed, nothing is deleted and it falls back to a plain backspace plan.
- **Autocorrect guard**: before typing, it drives Docs' own Tools → Preferences dialog to switch off automatic spelling correction, capitalisation, smart quotes, link/list detection, Markdown, emoji shortcuts and substitutions, verifies the saved values, records what it changed, and restores them afterwards. Labels are matched per interface language from a table (Turkish included); if labels are unknown it types with autocorrect on and says so.
- **Input lock**: real key and mouse events are cancelled during a run; Esc toggles pause.
- Slides: the loop runs in the service worker and injects one function per character with `chrome.scripting.executeScript`.
- Word Online: `execCommand` plus guards; other websites: a DOM adapter, with frame discovery via a posted token for cross-origin iframes.
- Emoji/surrogate handling exists for deletions (one Backspace may remove two code units). I did not find a paste fallback for non-BMP characters on the Docs path.

### Timing loop and throttling [code]
- Docs loop: in the content script with `setTimeout`.
- Persistence module, per its header: (1) inaudible oscillator, 10 Hz at gain 0.001, which makes the tab audible and exempt from timer throttling, freezing and discard; it must be started while a user gesture is still active or the audio context stays suspended, and it is re-armed on the next trusted gesture; (2) visibility spoof installed by a MAIN-world bridge on request from the isolated world; (3) tab-title progress restored by a MutationObserver.
- **Starvation detector**: an exponential moving average (alpha 0.3) of actual ÷ requested sleep for per-key sleeps only. When the ratio stays above 3 for at least 3 samples the loop emits up to 12 characters (to the next word boundary) per wake, never merging pauses or corrections.
- Service-worker-side loops (Slides) exist because background-tab throttling does not apply there.

### Human model
- **Signed-in runs are planned on the server.** A "typing-action generator" Lambda returns batches of actions; the client refills as it goes. Stage aliases pin a Lambda version to each extension release. Action vocabulary: `sendKeyPress`, `advancedCorrection`, `deleteMistakes`, `changeSpeed`, `sentencePause`, `paragraphPause`, `pauseTyping`. Server-commanded speed changes are clamped to 0.5×–2× of the user's speed. [code] The distribution of delays and typo planning on the server is not in the package. A comment mentions "word-length speed" and "quick doubled letters" as features of the pinned version. [code comment]
- **Client-side pieces** [code]:
  - Base delay 60000 / (WPM × 5); WPM clamp 20–220; UI up to 200.
  - Duration estimate assumes ~400 ms per sentence pause and, per mistake, three key times plus 300 ms (×2.5 when whole-word "advanced" mistakes are on).
  - **Natural breaks** (Docs, signed-in, texts over 300 words): possible stops are paragraph ends at least 40 words after the last stop, or sentence ends after 200 words. Each run draws a break budget of 25–32% of typing time, which is earned as characters are typed. 30% of stops are skipped; short breaks 10–45 s; every 3rd–5th stop a long break of 60–180 s, saved up for if not yet earned. The time estimate replays the planner with 8 fixed seeds.
  - **"Max" features** from one LLM Lambda call per text: per-sentence hesitation of 200 + 1200 × complexity² ms; per-sentence speed of 1.4× down to 0.6× base by relative complexity; and a **rewrite cycle** in which an alternative sentence is typed, followed by a 350 ms pause, a burst of backspaces and the real sentence.
  - **Guest engine** (signed out, fully local): capped at 60 WPM and 3% mistakes; constant delay with no jitter; a mistake is one neighbour key, 200–400 ms, one Backspace, 60 ms, then the right key.
- Planned mistakes are disabled when more than 30% of the letters are non-Latin script, because the server planner only knows a–z. [code]

### Laptop-closed / cloud typing [code]
- A "cloud typing" mode and a "Schedule" action POST the text to the vendor's `/sessions` API; the header comment states the backend types through the Google Docs API so writing continues with tab, browser and laptop closed. Scheduling supports a deadline and allowed hours, spread over hours or days.
- Requires Google consent for `drive.file` and `documents`.
- Hidden unless a feature flag is set and the backend is configured; the comment calls it an advanced tier and says the always-on in-tab background typing covers the common case.
- Multi-spot blocks and list automation are not supported in cloud mode.
- The extension also calls `documents.batchUpdate` directly for its AI quick-edit feature (not for typing).

### Gating [code, high level]
Google sign-in; guests get caps (60 WPM, 3% mistakes, word limit); token/credit checks on the Lambdas (HTTP 402 falls back to plain typing); trial and referral code present.

### Turkish / non-US layouts
- Extension UI and the autocorrect label table both include Turkish. [code]
- Key map has no non-ASCII entries; fallback is `key = char`, `keyCode = charCode`. [code]
- Turkish text is Latin script, so planned mistakes stay on, but the server planner is described as a–z only; behaviour on ç/ğ/ı/ö/ş/ü is not determinable from the package.

---

## 4. Human Auto Typer (`ejbpcjfncagifihhndhpbcijnpbkklkb`, v1.0.13)

### Manifest [code]
- Permissions: `activeTab`, `scripting`, `sidePanel`, `tabs`, `clipboardRead`, `contextMenus`, `offscreen`, `storage`. Host permissions `<all_urls>` and its own app domain.
- Content scripts on `<all_urls>` at `document_idle`, top frame only, isolated world.
- The offscreen document belongs to a third-party paywall SDK (`@monetize.software/sdk-extension`), not to typing.

### Text insertion [code]
- Target: `.docs-texteventtarget-iframe` → `contentDocument.activeElement`, captured once at start.
- Character: `keydown`, 15 ms, `keypress`, 15 ms, `keyup` (`keyCode = which = charCode`; `code` from a US map). Shifted symbols are wrapped in Shift events. Enter uses 30 ms gaps. Backspace sends keydown/keypress/keyup.
- No `beforeinput`, no fallback cascade for Docs, no verification that text landed.
- Other surfaces: `execCommand` for contenteditable, direct `.value` edits for inputs.
- "Fast mode": same events with 5 ms gaps and one eighth of the delay.

### Timing loop and throttling [code]
- Async loop in the content script with `setTimeout`. No oscillator, no visibility handling, no service-worker timer. [inferred] It will slow to a crawl in a background tab.

### Human model [code]
- Delay = (60000 / (5 × WPM)) × uniform(0.8, 1.2) × (0.7 above 100 WPM, 0.8 above 80 WPM), minimum 5 ms; in 30% of keys multiplied again by uniform(0.7, 1.3).
- Extra pause after `, . ? !` of 100–300 ms; after space 25–75 ms; after Enter 100–250 ms.
- Error rate is chosen per run by the side panel as a random 3–7%, then randomised per key to 0.5–1.5× that; never on space or newline.
- Error = neighbour key for a–z (otherwise a random character), 100–250 ms, Backspace, 80–200 ms, correct key, then 200–500 ms. Always corrected immediately; one error type only.
- Break settings exist in the state object but are not used by this loop.

### Gating [code, high level]
Paywall SDK with per-character usage accounting; analytics events to the vendor's domain and a cloud function.

### Turkish
Fallback mapping as above; a typo on a Turkish letter becomes a random ASCII letter, digit or symbol because only a–z has neighbours. [code]

---

## 5. Natural Typist (`mfdeophbahbbbonmgbdhchlcjmenhlfd`, v1.5.7)

### Manifest [code]
- Permissions: `activeTab`, `scripting`. Host permissions only for its own website. One content script on `docs.google.com/document/*`, isolated world; the worker re-injects it on icon click.
- 24 KB total; no remote calls on the typing path.

### Text insertion [code]
Same engine as Human Auto Typer: iframe active element; `keydown` / `keypress` / `keyup` with 15 ms gaps; Shift wrapping with 8–10 ms gaps; Enter with 30 ms gaps; Backspace as three events. No fallback, no verification.

### Timing loop [code]
Content-script `setTimeout` loop; nothing for hidden tabs. Text and settings are kept in the page's `localStorage`.

### Human model [code]
- Same base delay formula as Human Auto Typer, then a context multiplier: 0.6–0.9 inside numbers/operators; 0.9–1.1 in the first 10% of the text; 1.2–1.5 on digits and symbols; 25% of keys get 0.7–1.3; 1.1–1.3 just before sentence-ending punctuation; 0.8–1.1 inside words. A further 30% of keys get another 0.7–1.3.
- Above 100 WPM only 30% of post-key extra pauses are applied.
- Errors (rate 0–20%, default 5%) are suppressed on spaces, newlines and quote characters, inside quotes, inside parentheses, inside years, and in numbers, dates and percentages.
- Error styles: 60% simple neighbour-key slip (100–250 ms, Backspace, 80–200 ms, retype); for word characters 40% "advanced": one wrong key, two wrong keys then two backspaces, or a wrong-case letter.
- Breaks (optional): at word or sentence boundaries with probability 0.1–0.8 depending on a frequency setting, ×1.5 at sentence ends, ×0.1 within 500 characters of the last break; length uniform between user min and max minutes (defaults 1–5).

### Gating
None in the extension; links to a humanizer on the vendor site. [code]

---

## 6. Extras

### SynthTyper (`jndflkicnagegjddbehclbifmkfemgch`, v2.0.1) — engine read, UI skimmed [code]
- Permissions: `storage`, `power`. Content scripts only on Docs and Slides. No remote calls found; no paywall found.
- Insertion: `keydown` (charCode 0, physical keyCode) → `keypress` (charCode = code point) → `InputEvent("input")` with `insertText` / `insertParagraph` / `deleteContentBackward` → `keyup`. Arrows as keydown/keyup.
- **Throttling**: while the tab is hidden, waits are requested from the service worker over a port (`synth-timer`), in chunks of at most 20 s so the worker is never idle long enough to be shut down. `chrome.power.requestKeepAwake('display')` while any tab is typing, refreshed by a 20 s heartbeat.
- **Planner** produces an action iterator; every action carries a `safe` flag meaning "stopping here leaves the document an exact prefix of the final text", which is what pause/stop uses.
- Model: log-normal delay around the midpoint of a user min/max range; faster on common bigrams and hand alternation, slower on same-hand pairs, capitals, digits and symbols; a slow per-word drift; warm-up and fatigue terms; common words typed 15% faster; pre-word planning time growing with word length; **burst typing** with thinking pauses at clause/sentence ends; occasional 4–20 s attention drifts; **re-reading pauses** proportional to words written since the last read.
- Slip types with weights: neighbour substitution 45, transposition 15, skipped letter 15, doubled letter 10, missed Shift 15; noticed after 0 (50%), 1 (30%) or 2 (20%) more letters; also space-bar slips.
- **Revision behaviour**: types a near-synonym or draft word first and replaces it; leaves out optional adverbs, adjectives, parentheticals or whole sentences and goes back with arrow keys to insert them later. Cursor travel is only planned across text Docs will not autocorrect. English word lists drive this; quotes, names, numbers and links are locked from edits.
- Sittings: text divided into N sittings ending at sentence starts.
- **Keyboard layouts: `Türkçe Q`, `Türkçe F` and `QWERTY`** are built in and drive both neighbour-key typos and hand detection.

### Phrasly (`ekaehdifekfielghgakeoeejngamapbb`, v1.0.1) — skimmed [code]
- Permissions `storage`, `activeTab`, `scripting`, `<all_urls>`; one generic content script.
- Docs target is the iframe document's `body`. Uses KeyboardEvents plus `beforeinput`/`input` and `execCommand` on other editors (exact order not traced).
- Model: log-normal burst model with burst length, lull pauses, bigram speed-up, hesitation probability, sentence-length-dependent pauses, and a word-level "revision" (backspace the last word and retype it).

### HumanTyper (`emnddjmjlkmgkdcfcpgppmibpekkgifp`, v2.3.14) — skimmed [code]
- Permissions include `alarms`, `notifications`, `contextMenus`; host permissions for ExtensionPay and PostHog.
- Multi-method insertion (KeyboardEvents, `beforeinput`, `execCommand("insertText")`), an AudioContext keep-alive, ExtensionPay licence.
- Free limits in code: 250 characters per run (one bonus run of 1000), 10 runs per day, top speed level reserved for paid users.

---

## Comparison

| | Duey 4.0.1 | Auto Typer 3.4.3 | Write It 3.2.3 | Human Auto Typer 1.0.13 | Natural Typist 1.5.7 | SynthTyper 2.0.1 |
|---|---|---|---|---|---|---|
| Docs insertion | keydown/keypress/keyup | keydown/keypress/beforeinput/keyup (v1) or without beforeinput (v2) | keydown/keypress/keyup | keydown/keypress/keyup, 15 ms apart | same as HAT | keydown/keypress/input/keyup |
| World | MAIN (injected script) | Isolated | Isolated + MAIN bridge | Isolated | Isolated | Isolated |
| `debugger` permission | No (CDP code present, inert) | No | No (removed) | No | No | No |
| Non-BMP characters | Synthetic paste | Not handled specially | No paste fallback found | Not handled | Not handled | Not traced |
| Landing verification | Caret overlay, every 60 chars | Same | Caret-verified cursor moves | None | None | Not traced |
| Docs autocorrect handling | List guard, line-start paste | List guard (v2) | Turns off Docs preferences via UI, restores | None | None | Avoids cursor travel over autocorrectable text |
| Timing loop | Page | Service worker, precomputed schedule | Content script (Docs); worker (Slides) | Content script | Content script | Content script; worker timer when hidden |
| Hidden-tab handling | Oscillator + MAIN-world visibility override | Oscillator + isolated override; worker timing | Oscillator + MAIN-world override + starvation detector | None | None | Worker timer + keep-awake |
| Delay model | Log-normal + bigram + punctuation | Log-normal + finger/bigram factors | Server-planned; local constants for guests | Uniform jitter | Uniform jitter + context | Log-normal + hand/bigram + drift/fatigue/bursts |
| Typo model | Quota-based neighbour key, delayed notice, 3 fix styles | Whole-word, 4 types, immediate fix | Server-planned; neighbour key for guests | Neighbour key, immediate fix | Neighbour key + 3 advanced styles | 5 slip types, delayed notice, space slips |
| Revision behaviour | None locally (Pro unknown) | None | Rewrite cycle from LLM (paid) | None | None | Synonym drafts, go-back insertions |
| Long breaks / sessions | 2 sittings with 35 min gap; long-break scheduler | Paragraph 4–12 s; optional user pause | Natural breaks 10–180 s on a time budget; cloud schedule | None | Random breaks, 1–5 min | Breaks, sittings |
| Laptop closed | Not in package | No | Yes: backend + Docs API (flagged) | No | No | No |
| Model location | Local (standard), server (Pro) | Local | Server (signed-in), local (guest) | Local | Local | Local |
| Turkish awareness | None | None | UI + preference labels | None | None | Turkish Q and F layouts |

## Five design lessons for a new extension

1. **Synthetic key events into the Docs event iframe are sufficient; plan the edge cases, not the transport.** All leaders ship without `debugger`, and two abandoned or disabled CDP. The work is in the edges: set `keyCode`/`which`/`charCode` in the event init (not via defineProperty across worlds), wrap shifted keys in Shift events, use a synthetic paste for non-BMP characters, and decide deliberately between `keypress`-only and `beforeinput` variants per platform (Auto Typer skips `keypress` on macOS/ChromeOS in its `beforeinput` engine).
2. **Treat Docs as asynchronous and verify.** The caret overlay (`.kix-cursor` / `.kix-cursor-caret`) is the only feedback channel the leaders found. Use it to detect "typing is not landing" early (first 6 characters, then periodically) and to confirm every arrow/Backspace before the next one in a correction. Blind bursts of arrow keys are documented in Write It's source as corrupting documents.
3. **Neutralise Docs' auto-formatting explicitly.** Auto-capitalisation, smart quotes, automatic lists, link detection and substitutions all change text length under the typer. Options seen: switch the preferences off through Docs' own dialog and restore them (Write It, needs per-language labels), or dodge case by case (Duey's list-prefix retyping and line-start paste), or forbid cursor travel across risky text (SynthTyper). Any go-back-and-edit behaviour depends on this.
4. **Design for hidden tabs and worker shutdown from day one.** The proven kit: silent oscillator started inside a user gesture; visibility override installed in the MAIN world (an isolated-world override does not affect Docs); a timing source that is not throttled (service-worker timer in ≤20 s chunks, or a precomputed absolute-time schedule that self-corrects); persisted schedule + index so a run can resume exactly; a starvation detector that degrades gracefully to word-sized bursts. Add an input lock with a documented escape key so the user cannot move the caret mid-run.
5. **Plan the whole run up front as data, and make the model layout-aware.** Auto Typer, Duey Pro, Write It and SynthTyper all separate "plan" (a list of key/pause/correction actions with times) from "execute". That gives accurate time estimates, pause/resume, safe stop points and testability. For Turkish, almost every competitor is weak: neighbour tables, finger maps, bigram lists and word regexes are US-English only, so Turkish letters either never get typos or get implausible ones. A planner with Turkish Q/F adjacency, Turkish bigram statistics and Unicode-aware word detection (`\p{L}`) is a real differentiator; only SynthTyper has started on it.

## Not verified

- No behaviour was tested in a browser; whether each event sequence currently inserts text in Docs (including Turkish and other non-ASCII characters) is inferred from code and vendor comments.
- Duey: the server-side Pro typing model; what extension `oilkflafeapjagghnplcdonbcokdfckd` is and what it adds; how the "laptop closed" sessions and the "keep your computer awake" prompt advertised in listing/UI text are implemented (no such code in v4.0.1); exactly which modes enable the long-break scheduler; why a lower-case line start is pasted (purpose inferred).
- Auto Typer: service-worker survival during long user-configured pauses (no keep-alive found; risk inferred); whether its isolated-world visibility override has any effect; UI ranges for speed and pauses (popup not fully read).
- Write It: the Lambda's delay distribution, typo planning and correction rules; the backend's Docs API pacing for cloud sessions; large parts of the 24,000-line content script and the 9,600-line worker were not read (agent, research, referral, telemetry features ignored).
- Human Auto Typer: the paywall SDK internals and exact free quota.
- Phrasly and HumanTyper: skimmed only; event order, fallback order and full model parameters were not traced.
- SynthTyper: UI, DOCX import and Slides paths were not read; absence of remote calls is based on a URL/`fetch` search of the four main scripts.
- Version numbers are those served by the update endpoint on 18 Nov 2026 for a Chrome 131 user agent string; other browsers or staged rollouts may receive different builds.
