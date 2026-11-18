# Programmatic character-by-character text insertion into the Google Docs web editor (state: November 2026)

Research date: 2026-11-18. Evidence labels used below:

- **[CODE]** = I read this in the source of a public GitHub repo (cloned 2026-11-18; commit short-hash in the link). It proves what the project *does*, not that it works against live Docs today.
- **[OFFICIAL]** = Google / Chrome / vendor documentation fetched 2026-11-18.
- **[PROJECT CLAIM]** = a statement in a repo's README/design doc. Not independently verified.
- **[HEARSAY]** = forum post, search-result summary, third-party blog.

Nothing in these notes was tested by me against a live Google Doc. No live test was possible in this research task.

---

## 1. How does the Google Docs editor receive keyboard input today (canvas rendering, `.docs-texteventtarget-iframe`, event flow)?

### Takeaway
Docs draws the page on `<canvas>` (announced May 2021) and takes all keyboard input through a hidden, offscreen, same-origin iframe with class `docs-texteventtarget-iframe` that contains a contenteditable element; every open-source typer found (2021 to Nov 2026) still targets that exact selector. Google has published no documentation of the input path, so everything about how events flow from the iframe into the document model is reverse-engineered.

### Cited Findings
- [OFFICIAL] Google announced on 2021-05-11 that Docs would "migrate slowly from HTML to canvas based rendering over the course of the next several months", warned that extensions relying on the Docs HTML structure "may no longer work as intended", and recommended the Workspace Add-ons framework. An update on 2021-05-26 added accessibility details; assistive-technology support was stated to be unaffected. — [Google Workspace Updates blog](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html)
- [CODE] Chromium's own Reading Mode helper for Docs sets `window['_docs_annotate_canvas_by_ext']` to an extension ID; its comments say Docs renders in canvas without annotations by default and the annotated canvas lets an accessibility tree be built. This flag is for *reading* the document, not for writing. (Seen via search summary of the file, not read line by line.) — [chromium gdocs_script.js](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resources/reading_mode_gdocs_helper/gdocs_script.js)
- [HEARSAY] Annotated-canvas access is allowlisted; developers reported in Nov 2022 and Feb 2023 that Google's allowlist form got "zero response", and that Grammarly/LanguageTool/Wordtune reportedly use annotated canvas. No Google employee statement in the thread. — [chromium-extensions group thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/dLnxATEOcqg)
- [CODE] A 2026 extension's focus guard encodes the current structure: the active element chain must pass through an element matching `.docs-texteventtarget-iframe, .docs-texteventtarget`, descend through `IFRAME.contentDocument.activeElement`, and end on an element with `isContentEditable`. Its comment: "Google Docs routes canvas-editor keyboard input through this editable frame. Fail closed when focus is in the title, menus, comments, or an unknown editor." — [bummah08/doc-typer background.js](https://github.com/bummah08/doc-typer/blob/7d2c9f78baa43ba7f1f236dd16004ad3de2dbc3a/background.js) (last commit 2026-10-03)
- [CODE] Other selectors used by current projects: `[contenteditable="true"]` inside the iframe ([TrickleType content.js](https://github.com/heyitsR1/TrickleType/blob/e018107/content.js), Aug 2026); `iframe.contentDocument.body` focused before sending keys, plus `.kix-canvas-tile-content` or `.kix-appview-editor` as a click target to place the caret ([Helpotron direct_type.py](https://github.com/ronisaguey-ux/Helpotron/blob/d012669/server/typing_engine/direct_type.py), Nov 2026); `.kix-appview-editor` for the editor bounding box ([GitLitAF/Auto-Type UserScript.js](https://github.com/GitLitAF/Auto-Type/blob/c01ee74870532b61d5f747cd451cc969c4ae3b8c/UserScript.js), Jan 2025); Playwright `page.frame_locator('.docs-texteventtarget-iframe').locator('[contenteditable="true"]')` ([typepyyy docs_emitter.py](https://github.com/ahscolan2/typepyyy/blob/e301ac7/docs_emitter.py), Sep 2026).
- [PROJECT CLAIM] An agent-automation project documents (file header: `last_validated: 2026-04-29`, `authored_by: claude-opus-4.7`, i.e. LLM-written) that `.docs-texteventtarget-iframe` is "Stable across years; survives all Docs UI revisions", that the iframe is offscreen (`docs-offscreen-z-index`), that `.kix-cursor-caret` gives the canvas caret rect, and that writing into the iframe's DOM mirror (`Selection.setBaseAndExtent` + `InputEvent`) dirties the iframe DOM but "Docs does not propagate that change to the canvas model". — [Interceptor canvas-rendered-editor-input.md](https://github.com/Hacker-Valley-Media/Interceptor/blob/95c7e93/use-cases/interaction-skills/canvas-rendered-editor-input.md)
- [PROJECT CLAIM] The same document says a `keypress` event carrying a navigation keyCode inserts the ASCII character with that code (keyCode 38 gives `&`, 37 gives `%`, 39 gives `'`, 9 gives a tab), so `keypress` must be sent only for printable keys. — [Interceptor doc](https://github.com/Hacker-Valley-Media/Interceptor/blob/95c7e93/use-cases/interaction-skills/canvas-rendered-editor-input.md)

### Inferences
- The `keypress`-inserts-`&` observation, if accurate, means Docs' handler for printable input reads the character from the legacy `keypress` event (`charCode`/`keyCode`/`which`) on the iframe document, and handles Backspace/Enter/arrows in `keydown`. That matches the event sequences every synthetic-event project sends (section 2).
- Because the selector has been the same from pre-canvas answers through Nov 2026 code, the canvas migration changed *reading* the document (no DOM text) far more than *writing* to it; the input path predates canvas.
- The annotated-canvas allowlist is irrelevant to a typer unless it must also read document text or caret position.

### Gaps
- No official Google description of the text-event iframe or of how key events become model mutations. All of the above is reverse-engineered.
- I could not fetch Stack Overflow (blocked for this tool), so the frequently cited answers ([a/63595176](https://stackoverflow.com/a/63595176), [a/46217408](https://stackoverflow.com/a/46217408)) were seen only as search snippets (`document.querySelector(".docs-texteventtarget-iframe").contentDocument.activeElement`).
- Whether Docs currently inspects `beforeinput`/`input`/composition events in addition to `keypress` is not established by any source I found.

---

## 2. Do synthetic content-script events actually insert text in Docs today? Role of `isTrusted`; exact sequences used by open-source extensions

### Takeaway
Sources conflict, and I could not test it. Several extensions maintained in 2025–2026 still type by dispatching untrusted `keydown` → `keypress` → `keyup` `KeyboardEvent`s on the iframe document (no `execCommand`, no `InputEvent`), and one project claims that worked as of April 2026; other 2026 projects say synthetic events and `execCommand` are unreliable and moved to CDP. The most telling evidence of fragility is that one actively maintained extension tries five different insertion methods in order and verifies each because "None can be trusted to report success".

### Cited Findings

**Pattern A: pure synthetic keyboard events on the iframe *document*, built with the iframe's own `KeyboardEvent` constructor**

- [CODE] GitLitAF/Auto-Type (Tampermonkey userscript, last commit 2025-01-10). Target: `document.querySelector('.docs-texteventtarget-iframe')`, then `frameWindow = iframe.contentWindow`, `frameDoc = iframe.contentDocument`. Dispatch: — [UserScript.js](https://github.com/GitLitAF/Auto-Type/blob/c01ee74870532b61d5f747cd451cc969c4ae3b8c/UserScript.js)
  ```js
  const event = new frameWindow.KeyboardEvent(eventType, {
      ...eventInit, bubbles: true, cancelable: true, composed: true
  });
  Object.defineProperties(event, {
      keyCode: { value: eventInit.keyCode }, which: { value: eventInit.which },
      key: { value: eventInit.key }, code: { value: eventInit.code }
  });
  const dispatched = frameDoc.dispatchEvent(event);
  ```
  Per printable character: `keydown`, wait ≤30 ms, `keypress`, wait, `keyup`, with `keyCode = which = char.charCodeAt(0)`, `code = 'Key' + char.toUpperCase()`, `shiftKey` set for uppercase and wrapped in a separate Shift `keydown`/`keyup` (keyCode 16). Enter: `keydown` + `keypress` + `keyup` with `key:'Enter'`, keyCode 13. Backspace: `keydown` + `keyup` only, keyCode 8, no `keypress`.
- [CODE] asrayg/autofrickinggoogledocstyper (`slowtyper/content.js`, last commit 2026-02-14) uses the same shape: `new win.KeyboardEvent(eventType, …)` then `doc.dispatchEvent(e)`, `keydown`/`keypress`/`keyup` for characters, `keydown`/`keyup` for Backspace, manifest is a plain MV3 content script on `https://docs.google.com/document/*` with no permissions. — [repo](https://github.com/asrayg/autofrickinggoogledocstyper/tree/d159858/slowtyper)
- [CODE] YuvaanshKapila/AutoWriter (2025-05-24): same `frameWindow.KeyboardEvent` + `frameDoc.dispatchEvent`, `keydown`/`keypress`/`keyup`. — [content.js](https://github.com/YuvaanshKapila/AutoWriter/blob/52f7cf2/auto-typer-extension/content.js)
- [PROJECT CLAIM, dated 2026-04-29] "Docs treats events created by the iframe's constructor as legitimate keyboard input even though `event.isTrusted` reads `false`"; using the outer window's `new KeyboardEvent(...)` is rejected because the event's `view` does not match the iframe's `contentWindow`; 30–80 ms between keystrokes is enough and under 20 ms "causes Docs to coalesce or drop events". — [Interceptor doc](https://github.com/Hacker-Valley-Media/Interceptor/blob/95c7e93/use-cases/interaction-skills/canvas-rendered-editor-input.md)
- [PROJECT CLAIM, same doc] `isTrusted` cannot be spoofed: "Chrome installs `isTrusted` as a non-configurable own property on every Event instance at construction time", so overriding it on `Event.prototype` has no effect. The same doc claims overriding `navigator.userActivation.isActive/hasBeenActive` at `document_start` in the MAIN world "unlocks `execCommand`, dispatched `InputEvent`, and trusted-input gates", and that Docs' click handler reads a custom `event.__interceptor_trust` marker. The last claim is implausible on its face (Docs cannot know about a third-party property) and I treat the whole trust-override section as unverified.

**Pattern B: synthetic key events plus `execCommand('insertText')` on the iframe document**

- [CODE] heyitsR1/TrickleType (v1.1.2, last commit 2026-08-26). Target `iframe.contentDocument.querySelector('[contenteditable="true"]')`. Per character: `keydown` on target → `iframe.contentDocument.execCommand('insertText', false, char)` → if that returns false, `InputEvent('beforeinput', {data: char, inputType: 'insertText'})` + `InputEvent('input', …)` → `keyup`. Newline: `keydown`/`keypress`/`keyup` for Enter, then `execCommand('insertText', false, '\n')`, falling back to `execCommand('insertLineBreak')`. Uses the top-level `KeyboardEvent` constructor. — [content.js](https://github.com/heyitsR1/TrickleType/blob/e018107/content.js)
- [CODE] AugustoOM/Human-Typer (extension v0.11.0, last commit 2026-10-07). Target `doc.activeElement || doc.body` of the iframe. Docs branch: `keydown` + `keypress` (with `key`, `charCode`, `keyCode`, `which` all set to `char.charCodeAt(0)`, `bubbles: true`) → `doc.execCommand("insertText", false, char)` → `keyup`. Fallbacks: `beforeinput`/`input` `InputEvent`s; deletion via `doc.execCommand("delete")`. Injected with `chrome.scripting.executeScript` and no `world` option. — [runner.js](https://github.com/AugustoOM/Human-Typer/blob/306c0a5/chrome-extension/runner.js)
- [CODE + PROJECT CLAIM] Leonxlnx/ghost-typer shipped an `execCommand` architecture in v1.2–v1.3 (`injected.js`, "MUST run in main world", with a self-test that inserts `.` and deletes it, and a `CompositionEvent` start/update/end fallback), then abandoned it: the README says the current version "uses CDP exclusively" and the old files "are kept for reference". — [injected.js](https://github.com/Leonxlnx/ghost-typer/blob/2a7f33b/injected.js), [README](https://github.com/Leonxlnx/ghost-typer/blob/2a7f33b/README.md)

**Pattern C: try everything, verify each**

- [CODE] alexey-max-fedorov/dripwriter-origin (cross-browser extension, last commit 2026-11-16) orders its Docs insertion methods as: `beforeinput` (`InputEvent` `insertText`) → `paste` (synthetic paste event on the iframe contenteditable) → `paste-bubbling` → `keyboard` (`keydown`/`keypress`/`input`/`keyup`) → `execCommand`. Source comment: "Insertion methods, ordered most- to least-likely to be honoured. None can be trusted to report success, so every attempt is verified by `attemptMutation`." It also ships an in-product diagnostic that runs eight probes (paste on contenteditable, paste on `activeElement`, bubbling paste, iframe `execCommand`, window `execCommand`, `beforeinput`/`input` `insertText`, key events, `insertFromPaste`) each inserting a distinct marker (`AAA ` … `HHH `). — [src/lib/harness/docs.ts](https://github.com/alexey-max-fedorov/dripwriter-origin/blob/a97fe5b/src/lib/harness/docs.ts)

**Against synthetic events**

- [PROJECT CLAIM, Nov 2026] "Ordinary DOM value manipulation, synthetic DOM dispatch (`element.dispatchEvent(new KeyboardEvent(...))`), and legacy `document.execCommand('insertText')` fail to type reliably into Google Docs… synthetic events are marked `isTrusted = false` by browsers and frequently ignored by web applications." This is a design rationale, not a test report. — [AutoType ADR-001](https://github.com/olegnatruk/AutoType/blob/4bb2fc8/docs/decisions/0001-browser-debugger-input.md)
- [HEARSAY] Forum threads report a synthetic `KeyboardEvent` to the iframe opening Find but not typing, and assert Docs "has pretty aggressive protection against automated input"; no verified fix given. — [Latenode thread 1](https://community.latenode.com/t/javascript-keyboard-simulation-in-google-docs/21569), [Latenode thread 2](https://community.latenode.com/t/real-time-text-replacement-in-google-docs-using-a-chrome-extension-is-it-possible/10312)
- [HEARSAY, Chromium dev] "calling dispatchEvent in javascript is not the same as the UA calling dispatchEvent. The former does not invoke the default event handlers." — [chromium-dev thread](https://groups.google.com/a/chromium.org/g/chromium-dev/c/q7EAxeILS9Q)
- [CODE] Vim-style Docs scripts synthesize only *non-text* keys (arrows, Delete, with modifiers) via legacy `document.createEvent('KeyboardEvent')` / `initKeyboardEvent` with `keyCode` getters overridden, dispatched to `iframe.contentDocument.activeElement` from page context; real typing passes through natively, and paste is done by simulating clicks on the Edit → Paste menu item rather than a paste event. — [DocsKeys v1.3.5 on Greasy Fork](https://greasyfork.org/en/scripts/562026-docskeys-vim-for-google-docs/code)

### Inferences
- `isTrusted=false` is evidently not (or was not, through at least early 2026) an absolute block in Docs: Pattern A projects insert text with nothing but untrusted events, and their code would be pointless otherwise. The untrusted event works only because Docs' own JS listener acts on it; the browser performs no default action for it (no text insertion into the contenteditable, no `beforeinput`), which is why Pattern B projects add `execCommand`.
- Pattern A and Pattern B are mechanistically different bets. A feeds Docs' key listeners. B changes the iframe's DOM and relies on Docs noticing; the Interceptor note that iframe-DOM mutations are "not propagated to the canvas model" contradicts B, while ghost-typer's abandonment of B and dripwriter's verify-everything fallback chain are consistent with B being unreliable. I would rank A above B for a first attempt, and expect neither to be dependable long term.
- Synthetic `paste` events are tried by exactly one project (dripwriter) and ranked second; no project relies on `ClipboardEvent` alone, and paste is in any case whole-chunk, not per-keystroke.
- The practical engineering conclusion from the corpus: build a post-insertion verification step (read back via iframe selection, annotated canvas, or the Docs export) no matter which injection path is chosen.

### Gaps
- No live confirmation, as of Nov 2026, of which of A/B/C currently inserts text. The strongest dated claim is Interceptor's 2026-04-29 validation of Pattern A, from an LLM-authored file.
- Whether Docs' server or client records anything that distinguishes trusted from untrusted input is unknown; no source addresses it.
- Chrome Web Store typers (Human Typer, Auto Typer v3.0.1 updated 2026-05-29, SynthTyper, EzzyTyper, etc.) are closed source; their injection method is unknown. Listing claims such as "works off-tab" are marketing. — [search listing example](https://chromewebstore.google.com/detail/bgpnjdahpmkaflfpbkdplndklnmghklp)

---

## 3. MAIN world vs isolated world vs inside the iframe (`all_frames`, `match_about_blank`); Backspace, Enter, arrows, special characters

### Takeaway
The working pattern in open-source code is a top-frame content script that reaches into the iframe via `iframe.contentDocument` / `iframe.contentWindow` (it is same-origin), so `all_frames`/`match_about_blank` are not required for injection; projects disagree on whether MAIN world is needed. Control keys are sent as `keydown`+`keyup` without `keypress`; Enter gets all three.

### Cited Findings
- [CODE] Isolated-world, top-frame only (no `all_frames`, no `world`): asrayg slowtyper manifest (`content_scripts` on `https://docs.google.com/document/*`, `run_at: document_idle`), AutoWriter, TrickleType (`host_permissions: https://docs.google.com/*`). All access `iframe.contentDocument`. — [asrayg manifest](https://github.com/asrayg/autofrickinggoogledocstyper/tree/d159858/slowtyper), [TrickleType manifest](https://github.com/heyitsR1/TrickleType/blob/e018107/manifest.json)
- [CODE] Tampermonkey userscript with `@grant GM_addStyle` (i.e. sandboxed, not page context) also works through `contentWindow.KeyboardEvent`. — [GitLitAF/Auto-Type](https://github.com/GitLitAF/Auto-Type/blob/c01ee74870532b61d5f747cd451cc969c4ae3b8c/UserScript.js)
- [CODE] MAIN-world proponents: ghost-typer's legacy `injected.js` header says `execCommand('insertText')` "MUST run in main world"; DocsKeys injects a `<script>` element whose text is the stringified page function and bridges with a `CustomEvent('doc-keys-simulate-keypress')`; Interceptor runs via `eval --main`. — [ghost-typer injected.js](https://github.com/Leonxlnx/ghost-typer/blob/2a7f33b/injected.js), [DocsKeys](https://greasyfork.org/en/scripts/562026-docskeys-vim-for-google-docs/code), [Interceptor doc](https://github.com/Hacker-Valley-Media/Interceptor/blob/95c7e93/use-cases/interaction-skills/canvas-rendered-editor-input.md)
- [CODE] `all_frames: true` + `match_about_blank: true` appears in a *listener* extension (plays a note per keystroke): it both runs inside the Docs iframe and, from the top frame, attaches a capture-phase `keydown` listener to `iframe.contentDocument`, with a guard to avoid double handling when `window.frameElement` has class `docs-texteventtarget-iframe`. This shows the iframe is an about:blank-style frame reachable either way. — [song-typer manifest + content/index.ts](https://github.com/harqian/song-typer/tree/89f23b9/src)
- [CODE] Special keys in synthetic implementations: Backspace = `keydown` + `keyup`, `key:'Backspace'`, `code:'Backspace'`, `keyCode: 8`, `which: 8` (GitLitAF, asrayg); Enter = `keydown` + `keypress` + `keyup`, keyCode 13 (GitLitAF); uppercase = Shift `keydown` (keyCode 16) around the letter with `shiftKey: true`. Arrow/Delete codes in DocsKeys: left 37, up 38, right 39, down 40, delete 46, backspace 8, with modifier flags for selection (`shift: true`).
- [PROJECT CLAIM] Rule: `keydown` + `keypress` + `keyup` for printable keys (letters, digits, symbols, Space, Enter); `keydown` + `keyup` only for Tab, arrows, Home, End, Escape, Backspace, Delete, modifiers. Tab in a table moves cells and Tab past the last cell creates a row; Cmd+Z undo works. — [Interceptor doc](https://github.com/Hacker-Valley-Media/Interceptor/blob/95c7e93/use-cases/interaction-skills/canvas-rendered-editor-input.md)
- [CODE] Tabs are a hazard in every approach: doc-typer converts `\t` to four spaces ("Tabs would move focus in Docs") and strips other control characters; AutoType routes literal tabs through `Input.insertText` so they "never send Tab/Enter shortcuts". — [doc-typer typing.mjs](https://github.com/bummah08/doc-typer/blob/7d2c9f78baa43ba7f1f236dd16004ad3de2dbc3a/typing.mjs), [AutoType background.js](https://github.com/olegnatruk/AutoType/blob/4bb2fc8/extension/background.js)

### Inferences
- A content script in the isolated world shares the DOM with the page, so events it dispatches reach Docs' listeners. But `Object.defineProperties(event, {keyCode: …})` done in the isolated world only changes that world's wrapper object; page code will see the native property values. So in an isolated-world script the values must be passed through the `KeyboardEvent` init dictionary (`keyCode`, `charCode`, `which`), which the Pattern A projects also do via `...eventInit`. If Chrome ever stops honouring those legacy init members, isolated-world scripts break and MAIN-world scripts (where `defineProperty` is visible to Docs) keep working. This is my reasoning from how extension worlds work, not something a source states; it is a good reason to prefer `world: "MAIN"` (MV3 `chrome.scripting.executeScript({world:'MAIN'})` or `"world": "MAIN"` in `content_scripts`).
- The Interceptor claim that the outer-window constructor is rejected conflicts with TrickleType and Human-Typer, which use the top-level `KeyboardEvent`; but both of those also call `execCommand`, so their key events may be decorative. Using the iframe's constructor costs nothing and satisfies both views.
- `match_about_blank` / `all_frames` are useful only if the design wants the script to live inside the iframe (e.g. to listen for real keystrokes); injection from the top frame is simpler.

### Gaps
- No source tests isolated vs MAIN world head-to-head on current Docs.
- Arrow-key and selection behaviour for *synthetic* events is evidenced only by vim-mode scripts and the Interceptor doc; none of the typer extensions use arrows.

---

## 4. `chrome.debugger` + CDP `Input.dispatchKeyEvent` / `Input.insertText`

### Takeaway
This is the approach the most recently active open-source typers have converged on (four independent 2026 projects), because CDP input is injected at the browser level and arrives as trusted events; the costs are the `debugger` permission, Chrome's "started debugging this browser" infobar, a focused-tab requirement, and Chrome-only support.

### Cited Findings
- [OFFICIAL] `chrome.debugger` requires the `"debugger"` permission; `Input` is one of the CDP domains extensions may use; `onDetach` fires when the tab closes or DevTools is opened on the attached tab; enterprise policy can block attaching. The reference page does not describe the infobar. — [chrome.debugger reference](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [OFFICIAL] `Input.dispatchKeyEvent` params: `type` ∈ `keyDown | keyUp | rawKeyDown | char`; `modifiers` bitfield Alt=1, Ctrl=2, Meta/Command=4, Shift=8; `text` ("Text as generated by processing a virtual key code with a keyboard layout. Not needed for `keyUp` and `rawKeyDown`"); `unmodifiedText`; `code` (e.g. `KeyA`); `key`; `windowsVirtualKeyCode`; `nativeVirtualKeyCode`; `autoRepeat`; `isKeypad`; `location`; `commands` (editing commands such as `selectAll`). `Input.insertText` is **experimental**: "emulates inserting text that doesn't come from a key press, for example an emoji keyboard or an IME." `Input.imeSetComposition` is also experimental. — [devtools-protocol Input.pdl](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Input.pdl), [rendered docs](https://chromedevtools.github.io/devtools-protocol/tot/Input/)
- [CODE] bummah08/doc-typer v1.3.1 (2026-10-03), permissions `["activeTab","debugger","storage","alarms"]`, `minimum_chrome_version: 118`. `chrome.debugger.attach({tabId}, "1.3")`; before **every** step it runs the focus guard via `Runtime.evaluate`; then: — [background.js](https://github.com/bummah08/doc-typer/blob/7d2c9f78baa43ba7f1f236dd16004ad3de2dbc3a/background.js), [typing.mjs](https://github.com/bummah08/doc-typer/blob/7d2c9f78baa43ba7f1f236dd16004ad3de2dbc3a/typing.mjs)
  ```js
  // printable ASCII: keyDown carrying text, then keyUp
  [{ type: "keyDown", key: text, code: "KeyA"|"Digit1"|"Space", windowsVirtualKeyCode, text, unmodifiedText: text },
   { type: "keyUp", key: text, code, windowsVirtualKeyCode }]
  // newline
  { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" } + keyUp
  // backspace
  { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 } + keyUp
  // anything outside \x20-\x7e (Unicode, emoji)
  chrome.debugger.sendCommand({tabId}, "Input.insertText", { text })
  ```
  It segments text with `Intl.Segmenter` (graphemes), inserts whole `https://…` tokens in one `Input.insertText`, and stops on tab switch, window blur, navigation, or `chrome.debugger.onDetach`.
- [CODE] olegnatruk/AutoType (2026-11-13), permissions `["debugger","storage","activeTab","scripting"]`: identical split: Enter as `keyDown` with `text:'\r'`, printable ASCII (`/^[\x20-\x7e]$/u`) as `Input.dispatchKeyEvent`, everything else via `Input.insertText`. — [extension/background.js](https://github.com/olegnatruk/AutoType/blob/4bb2fc8/extension/background.js)
- [CODE] Leonxlnx/ghost-typer v1.7.0 (2026-03-16), permissions `["activeTab","storage","debugger"]`, uses the three-event form: `rawKeyDown` → `char` (with `text`, `unmodifiedText`) → `keyUp`, `modifiers: 8` for Shift; non-ASCII falls back to `code: ''` with `windowsVirtualKeyCode = char.charCodeAt(0)`; Ctrl shortcuts via `modifiers: 2`. While typing it injects a full-screen overlay and a capture-phase key blocker that swallows only `e.isTrusted` events, with the comment "CDP events bypass this". — [background.js](https://github.com/Leonxlnx/ghost-typer/blob/2a7f33b/background.js)
- [PROJECT CLAIM] Banner text and trade-off: "Chrome displays a visible infobar ('AutoType started debugging this browser') during active typing. This visible indicator is explicitly accepted as an intentional product trade-off." — [AutoType ADR-001](https://github.com/olegnatruk/AutoType/blob/4bb2fc8/docs/decisions/0001-browser-debugger-input.md). Cancelling the banner stops the run, DevTools must be closed on that tab, and the debugger permission "is a powerful permission and Chrome displays a visible debugging banner". — [doc-typer README](https://github.com/bummah08/doc-typer/blob/7d2c9f78baa43ba7f1f236dd16004ad3de2dbc3a/README.md)
- [PROJECT CLAIM] "Since Chrome 118, an active `chrome.debugger` session prevents service worker suspension during long typing runs." — [AutoType ADR-001](https://github.com/olegnatruk/AutoType/blob/4bb2fc8/docs/decisions/0001-browser-debugger-input.md); doc-typer README says the same and links Chrome's service-worker lifecycle page.
- [CODE + PROJECT CLAIM] External CDP (Chrome launched with remote debugging, no extension): Helpotron drives Docs tabs over the browser-level CDP websocket and reports that `Input.dispatchKeyEvent` is target-scoped, but background tabs report `document.hasFocus() === false` / `visibilityState === "hidden"` and "Docs degrades on that: measured 1 of 10 background tabs accepting text"; calling `Emulation.setFocusEmulationEnabled {enabled: true}` took it "1/10 -> 10/10". It also focuses `iframe.contentDocument.body` first: "that body must have focus or every dispatch is discarded". — [Helpotron direct_type.py](https://github.com/ronisaguey-ux/Helpotron/blob/d012669/server/typing_engine/direct_type.py)
- [CODE] Playwright variant: typepyyy opens Docs in `chromium.launch_persistent_context`, waits for `.docs-texteventtarget-iframe [contenteditable="true"]`, presses `Meta+ArrowDown` / `Control+End`, then sends raw `Input.dispatchKeyEvent` payloads through `page.context.new_cdp_session(page)` with separate key-down/key-up timing and Shift modifier bit 8; characters outside US QWERTY use virtual-key 0 with text carried by the `char` event. — [docs_emitter.py](https://github.com/ahscolan2/typepyyy/blob/e301ac7/docs_emitter.py)
- [HEARSAY] A third-party guide says use of sensitive APIs such as `debugger`, `proxy`, `tabCapture`, `webRequest` triggers manual review in the Chrome Web Store. Not an official source. — [third-party review guide](https://theluckystrike.github.io/chrome-extension-guide/docs/guides/chrome-extension-review-process)

### Inferences
- Two valid CDP encodings exist for a printable key: `keyDown` with `text` (Chrome synthesizes keydown + keypress) or `rawKeyDown` + `char` + `keyUp`. Both appear in maintained code; the first is simpler.
- `Input.insertText` produces no key events at all (it is the IME/emoji path), so a per-character stream of `insertText` for Turkish letters will look different to any page-side keystroke logger than the ASCII letters around it. If uniform key events matter, use the `char`-event form with virtual-key 0 (ghost-typer, typepyyy) instead.
- The extension form needs the Docs tab active and focused (doc-typer aborts otherwise). Background-tab typing appears achievable only with focus emulation, which Helpotron uses over external CDP; `Emulation` is in the extension-allowed domain list, so an extension could try it, but no extension in the corpus does.
- All of the open-source CDP typers are distributed as unpacked/"Load unpacked" extensions; none shows a Web Store listing, so the corpus gives no evidence either way on review outcomes for `debugger`-based typers.

### Gaps
- No official Chrome documentation found (in the pages fetched) describing the infobar, whether it can be suppressed (other than the `--silent-debugger-extension-api` command-line switch, which the official page mentions only for attaching to extension background pages), or how long it persists after detach.
- No authoritative source on Chrome Web Store review treatment of the `debugger` permission; only a third-party guide.
- doc-typer's own README states: "Live Google Docs compatibility requires a signed-in browser smoke test; it has not been verified in this delivery." So even the cleanest CDP implementation is not self-certified against live Docs.

---

## 5. Google Docs REST API (`documents.batchUpdate` with `insertText` / `deleteContentRange`)

### Takeaway
The API is the only officially supported write path and works with no browser tab open, but the per-user write quota (60 requests/minute) caps one-request-per-character typing at about one character per second, and the natural Docs scope is "sensitive" (requires Google verification for public apps).

### Cited Findings
- [OFFICIAL] Quotas: read 3,000/min per project and 300/min per user per project; **write 600/min per project and 60/min per user per project**. Exceeding returns `429: Too many requests`; use exponential backoff. The page also states: "Exceeding the quota request limits is planned to incur charges to your Google Cloud billing account later in 2026." — [Docs API usage limits](https://developers.google.com/workspace/docs/api/limits)
- [OFFICIAL] `InsertTextRequest`: inserting `\n` "will implicitly create a new Paragraph at that index"; control characters U+0000–U+0008, U+000C–U+001F and Private Use Area U+E000–U+F8FF are stripped; text style is generally inherited from the text before the index; `location.index` is "zero-based… in UTF-16 code units"; `endOfSegmentLocation` appends at end of body/header/footer/footnote; `tabId` selects a document tab (defaults to first). `DeleteContentRangeRequest` returns 400 for invalid ranges such as half a surrogate pair or the segment's final newline. `UpdateTextStyleRequest` takes a field mask (e.g. `"bold"`). — [Docs API Request reference](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request)
- [OFFICIAL, via search summary] `https://www.googleapis.com/auth/documents` and `documents.readonly` are classified **Sensitive**; `drive.file` is the recommended **non-sensitive** per-file scope. Sensitive-scope verification "typically takes 3-5 business days" and requires a justification per scope. — [Choose Docs API scopes](https://developers.google.com/docs/api/auth), [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [CODE] Example of the API used alongside OS typing (an old script that calls `pyautogui.typewrite` and then `documents().batchUpdate` with `insertText` at `index: 1` using a service account). — [anbaphish/DocsType main](https://github.com/anbaphish/DocsType/blob/master/main) (2023)
- [HEARSAY] A 2026-11-01 vendor blog describes 200 writes in a minute hitting the 60/user limit. — [Activepieces blog](https://www.activepieces.com/blog/google-docs-api-rate-limits-for-developers-2026)

### Inferences
- 60 write requests/min/user ⇒ at one `batchUpdate` per character, ≤1 character/second ≈ 12 WPM (5 chars/word), with zero headroom for typo-and-backspace cycles (each `deleteContentRange` is another write). Batching several characters per request raises throughput but those characters land in one revision step, defeating per-keystroke granularity.
- A typo/backspace simulation needs index bookkeeping in UTF-16 code units; Turkish letters (ş, ğ, ı, İ) are single BMP code units, emoji are two.
- Being a server-side REST call, it needs no open tab and can run from a backend or an extension service worker (`chrome.identity`); a collaborator watching the doc would see text appear without a moving user caret from an active editing session. That last point is my expectation, not sourced.
- The "charges later in 2026" notice means quota behaviour may be changing right now; re-read the limits page before committing.

### Gaps
- No measured per-request latency found.
- No official statement found on how API edits are attributed or grouped in Docs version history compared with typed edits.
- I did not confirm from the scopes page itself (only a search summary) that `drive.file` is sufficient for `documents.batchUpdate` on files the app created or the user picked.

---

## 6. Apps Script (bound script or add-on, time-driven triggers, 6-minute limit)

### Takeaway
Apps Script can insert text server-side with no OAuth verification for a personal bound script, but its scheduling granularity (triggers at most once per minute; once per hour for add-ons) and runtime caps (6 min per execution; 90 min/day of trigger runtime on consumer accounts) make sustained keystroke-paced typing impractical.

### Cited Findings
- [OFFICIAL] Quotas (consumer / Workspace): script runtime 6 min per execution (both); triggers total runtime 90 min/day vs 6 hr/day; 20 triggers per user per script; 30 simultaneous executions per user. — [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [OFFICIAL] Time-driven triggers can run "as frequently as every minute"; "The time might be slightly randomized"; "An add-on can use a time-driven trigger once per hour at most"; installable triggers "always run under the account of the person who created them"; script executions and API requests don't cause triggers to run. — [Installable triggers guide](https://developers.google.com/apps-script/guides/triggers/installable)
- [OFFICIAL] Google's recommended replacement for broken Docs extensions is the Workspace Add-ons framework. — [Workspace Updates blog, May 2021](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html)
- [HEARSAY] A Chromium-extensions thread notes an add-on is a separate product from a Chrome extension (not in the Chrome Web Store), and suggests an add-on that talks to the extension as a bridge. — [chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/dLnxATEOcqg)

### Inferences
- A single 6-minute execution that loops `insertText` + `Utilities.sleep()` can pace characters, but on a consumer account trigger-driven runs total at most 90 min/day, and chaining requires minute-granularity triggers with randomized start times, producing visible burst/gap patterns.
- A sidebar (HTML service) calling `google.script.run` per chunk from client-side timers avoids trigger limits while the document is open, at the price of one server round trip per insertion; I found no source measuring that latency.

### Gaps
- No source found on per-call latency of `DocumentApp` text insertion or on how many edits per minute Apps Script can make to a Doc before throttling.
- No open-source Apps Script "human typer" was found in this search; evidence here is documentation-only.
- Whether time-driven triggers edit a closed document reliably is not stated on the pages fetched (it is implied by their server-side nature).

---

## 7. OS-level approaches (pyautogui, AutoHotkey, AppleScript, nut.js)

### Takeaway
OS-level injection produces genuine trusted browser events and is immune to Docs DOM changes, but it types into whatever has focus, monopolizes the machine, and (for pyautogui in particular) is tied to the active keyboard layout, which breaks non-ASCII text.

### Cited Findings
- [CODE] Minimal pyautogui typers for Docs: countdown, then `pyautogui.typewrite(word, interval=TYPING_SPEED)` word by word with random sleeps. — [logi-89/GoogleDocsTyper main.py](https://github.com/logi-89/GoogleDocsTyper/blob/main/main.py) (2025-08)
- [OFFICIAL] pyautogui `write()` types a string with an optional per-character `interval`; "You can only press single-character keys with `write()`"; `press`/`keyDown`/`keyUp`/`hotkey` handle named keys. The docs say nothing about Unicode. — [PyAutoGUI keyboard docs](https://pyautogui.readthedocs.io/en/latest/keyboard.html)
- [HEARSAY] pyautogui output depends on the active OS keyboard layout (e.g. `!` typed as `§` on a French layout); the common workaround for non-ASCII is clipboard paste via pyperclip, which loses per-keystroke timing; a user reported `pynput` working for Thai where pyautogui failed. A Stack Overflow question titled "turkish characters in pyautogui" exists (title seen only). — [search results incl. SO mirrors](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/75075901/turkish-characters-in-pyautogui), [codegenes summary](https://www.codegenes.net/blog/input-unicode-string-with-pyautogui/)
- [OFFICIAL] AutoHotkey v2: `{U+nnnn}` sends a Unicode character via `SendInput()` or `WM_CHAR` and "usually do[es] not trigger shortcut keys or hotkeys"; when "the current keyboard layout does not contain a key or key combination which produces that character", SendEvent/SendInput fall back to `SendInput()` with the `KEYEVENTF_UNICODE` flag; `SendText`/`{Text}` sends characters literally; for fallback characters "Any press duration set by SetKeyDelay is ignored"; `{Enter}`, `{Backspace}`/`{BS}` are the key names. — [AutoHotkey v2 Send docs](https://www.autohotkey.com/docs/v2/lib/Send.htm)
- [CODE] Human-Typer pairs a desktop app with its extension (extension has `host_permissions` for `http://127.0.0.1/*`; README describes sending "text and formatting" from the desktop app to the Docs tab and says to "Keep Google Docs in the foreground"). — [AugustoOM/Human-Typer](https://github.com/AugustoOM/Human-Typer/tree/306c0a5)

### Inferences
- On Windows, AutoHotkey can emit any Turkish character regardless of layout (KEYEVENTF_UNICODE), but such packets arrive in the browser without a meaningful physical key code, the same asymmetry as CDP `Input.insertText` vs key events.
- OS-level tools cannot target a background tab or a specific document; a focus change mid-run types into the wrong window. CDP with a focus guard (doc-typer) is strictly safer.

### Gaps
- No sources gathered for AppleScript (`System Events` `keystroke`) or nut.js Unicode behaviour; the search returned nothing on either. Both are unverified here.
- No open-source Docs typer using AutoHotkey or nut.js was found.

---

## 8. Which approaches have historically broken when Google changed Docs, and how do maintained projects cope?

### Takeaway
The 2021 canvas migration broke DOM-*reading* extensions; for *writing*, the documented breakage pattern is `execCommand`/DOM-mutation approaches being abandoned for CDP, while the iframe selector itself has stayed stable. Maintained projects cope with fallback chains, per-step verification, fail-closed focus guards, and explicit "may need an update" disclaimers.

### Cited Findings
- [OFFICIAL] The canvas change (2021) was expected to break extensions depending on Docs' HTML structure. — [Workspace Updates blog](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html)
- [HEARSAY] A Docs utility library's README carries "WARNING: this project may no longer work after July 2021" because of the canvas switch; a Stack Overflow comment says the `_docs_force_html_by_ext` HTML fallback "has been deprecated, but the annotated canvas is still available". — [Amaimersion/google-docs-utils](https://github.com/Amaimersion/google-docs-utils), [SO mirror a/71321036](https://kaweah.freedombox.rocks/kiwix/stackoverflow.com_en_all_2023-11/a/71321036)
- [CODE + PROJECT CLAIM] ghost-typer: `execCommand` architecture (v1.2–1.3) replaced by CDP-only (v1.7.0, Mar 2026). — [README](https://github.com/Leonxlnx/ghost-typer/blob/2a7f33b/README.md)
- [CODE] dripwriter: five ordered insertion methods, each verified by observing a document change, plus a user-facing eight-probe diagnostic. — [docs.ts](https://github.com/alexey-max-fedorov/dripwriter-origin/blob/a97fe5b/src/lib/harness/docs.ts)
- [CODE] TrickleType and Human-Typer: `execCommand` first, check its boolean return, fall back to `beforeinput`/`input` `InputEvent`s. — [TrickleType](https://github.com/heyitsR1/TrickleType/blob/e018107/content.js), [Human-Typer runner.js](https://github.com/AugustoOM/Human-Typer/blob/306c0a5/chrome-extension/runner.js)
- [PROJECT CLAIM] doc-typer: "Focus detection depends on Google's current editor markup and may need an update if Google changes it." — [README](https://github.com/bummah08/doc-typer/blob/7d2c9f78baa43ba7f1f236dd16004ad3de2dbc3a/README.md)
- [PROJECT CLAIM] Helpotron found that an injected page widget stole focus so "every keystroke [was] stolen", and fixed it inside the single focus function. — [direct_type.py](https://github.com/ronisaguey-ux/Helpotron/blob/d012669/server/typing_engine/direct_type.py)

### Inferences
- Robustness ranking by dependency on Docs internals: OS-level (none) > CDP (needs only focus in the editor; selector used just for a guard) > synthetic key events (needs the iframe selector and Docs' untrusted-event tolerance) > `execCommand`/`InputEvent` on the iframe (needs Docs to sync iframe DOM mutations) > DOM reading (needs annotated canvas allowlisting).
- The official API and Apps Script are the only paths with a compatibility commitment.

### Gaps
- No dated changelog or issue thread found that pins a specific Google release to a specific typer breakage after 2021; the evidence is architectural pivots in repos, not incident reports. GitHub code search was rate-limited during this research, so issue trackers were not mined.

---

## 9. Non-ASCII text (Turkish ş, ğ, ı, İ), IME, autocorrect/smart quotes, formatting (bold, headings)

### Takeaway
Only CDP (`Input.insertText` or `char` events with virtual-key 0), the REST API, Apps Script and AutoHotkey handle Turkish characters by construction; the synthetic-event typers found are written for US-QWERTY ASCII and would generate malformed key data for ş/ğ/ı/İ. Docs' own autocorrect/smart-quote/auto-list features apply to every keystroke-style path and must be disabled or tolerated; only the API and Apps Script offer first-class formatting.

### Cited Findings
- [CODE] CDP typers send any character outside `\x20-\x7e` through `Input.insertText` after grapheme segmentation with `Intl.Segmenter`. — [doc-typer](https://github.com/bummah08/doc-typer/blob/7d2c9f78baa43ba7f1f236dd16004ad3de2dbc3a/typing.mjs), [AutoType](https://github.com/olegnatruk/AutoType/blob/4bb2fc8/extension/background.js)
- [PROJECT CLAIM] "Emoji and other Unicode text use Chrome's text-insertion input path. Rich formatting is not transferred." and "Google Docs can apply its own autocorrections, smart quotes, substitutions, and list formatting. Disable unwanted automatic substitutions in Docs preferences if you need closer fidelity." Suggested smoke-test string includes `café 😊`. — [doc-typer README](https://github.com/bummah08/doc-typer/blob/7d2c9f78baa43ba7f1f236dd16004ad3de2dbc3a/README.md)
- [CODE] ghost-typer and typepyyy instead keep key events for non-layout characters: `code: ''`, virtual-key 0 (typepyyy) or `char.charCodeAt(0)` (ghost-typer), with the character in the `char` event's `text`. typepyyy's docstring: "Characters outside US QWERTY fall back to vk 0 with the text carried by the char event alone." — [typepyyy docs_emitter.py](https://github.com/ahscolan2/typepyyy/blob/e301ac7/docs_emitter.py), [ghost-typer background.js](https://github.com/Leonxlnx/ghost-typer/blob/2a7f33b/background.js)
- [CODE] Synthetic typers derive key data arithmetically: `keyCode = char.charCodeAt(0)`, `code = 'Key' + char.toUpperCase()`, uppercase detected by `char !== char.toLowerCase()`; typo models and hand maps cover only `a–z`. — [GitLitAF UserScript.js](https://github.com/GitLitAF/Auto-Type/blob/c01ee74870532b61d5f747cd451cc969c4ae3b8c/UserScript.js), [Human-Typer runner.js](https://github.com/AugustoOM/Human-Typer/blob/306c0a5/chrome-extension/runner.js)
- [CODE] Typo simulation everywhere uses a hard-coded QWERTY adjacency table (e.g. doc-typer `nearby = { a: "sq", b: "vn", … }`), applied only to English letters. — [doc-typer typing.mjs](https://github.com/bummah08/doc-typer/blob/7d2c9f78baa43ba7f1f236dd16004ad3de2dbc3a/typing.mjs)
- [CODE] IME: ghost-typer's legacy path dispatched synthetic `compositionstart`/`compositionupdate`/`compositionend` as a fallback when `execCommand` failed; CDP offers experimental `Input.imeSetComposition`. No current project uses real composition for typing. — [ghost-typer injected.js](https://github.com/Leonxlnx/ghost-typer/blob/2a7f33b/injected.js), [Input.pdl](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Input.pdl)
- [CODE] Formatting via keystroke paths: ghost-typer has a `pressCtrl(key)` helper (`modifiers: 2`) for Docs shortcuts; Human-Typer calls `doc.execCommand("removeFormat")` and other `execCommand` formatting commands on the iframe document and its README has an "Apply formatting in Google Docs" option. — [ghost-typer background.js](https://github.com/Leonxlnx/ghost-typer/blob/2a7f33b/background.js), [Human-Typer runner.js](https://github.com/AugustoOM/Human-Typer/blob/306c0a5/chrome-extension/runner.js)
- [OFFICIAL] API formatting: `UpdateTextStyleRequest` with field mask (e.g. `bold`); `UpdateParagraphStyleRequest` updates all paragraphs overlapping a range; inserted text inherits neighbouring style; index unit is UTF-16 code units. — [Docs API Request reference](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request)
- [OFFICIAL] AutoHotkey falls back to `KEYEVENTF_UNICODE` for characters not on the active layout. — [AHK Send docs](https://www.autohotkey.com/docs/v2/lib/Send.htm)

### Inferences
- For Turkish in a Pattern A synthetic typer, `'ş'.charCodeAt(0)` is 351 and `'Key' + 'Ş'` is not a valid `code`; whether Docs still inserts `ş` depends on it reading only the `keypress` char code. Untested; treat as a risk and test ş, ğ, ı, İ, ö, ü, ç explicitly.
- JavaScript case mapping is locale-independent and wrong for Turkish dotted/dotless i: `'i'.toUpperCase()` gives `I` (not `İ`), `'ı'.toUpperCase()` gives `I`, and `'İ'.toLowerCase()` gives `i` + U+0307 (two code units). Any typer that derives Shift state or "the wrong-case typo" via `toUpperCase()/toLowerCase()` will mis-handle these; use `toLocaleUpperCase('tr')` or treat Turkish letters as atomic. This is standard JS behaviour, not from a cited source.
- A Turkish typer needs a Turkish-Q adjacency table for realistic typos (ş next to l/i, ğ next to p/ü, etc.); none of the projects provides one.
- With CDP, mixing key events (ASCII) and `Input.insertText` (Turkish letters) yields two different event signatures inside one word. Using the `rawKeyDown` + `char` + `keyUp` form with `key` set to the Turkish letter and a plausible `code` for the Turkish-Q physical key (e.g. `Semicolon` for ş, `BracketLeft` for ğ, `KeyI` for ı, `Quote` for i) would be uniform; no project does this, so it is a design suggestion.
- Formatting through keystroke paths means sending Docs shortcuts (Ctrl/Cmd+B, Ctrl+Alt+1..6 for headings) with the right modifier bit (Ctrl=2, Meta=4 on macOS); ghost-typer hard-codes Ctrl, which would be wrong on macOS.
- Docs autocorrect interacts with simulated typos: an injected wrong letter may be auto-corrected by Docs before the simulated Backspace arrives, corrupting the text. Disabling Tools → Preferences substitutions for the run is the conservative choice.

### Gaps
- No official Google Docs help page on autocorrect/smart quotes/auto-capitalization/list detection was successfully fetched (the URL tried returned 404); the only source is a project README.
- No source tests Turkish text through any of these typers.
- No source establishes how Docs treats dead keys / real IME composition from synthetic events.

---

## Cross-cutting comparison (synthesis of the sections above; each cell is supported by the citations in the named section)

| Approach | Event trust | Needs Docs tab open/focused | Per-char pacing | Non-ASCII | Formatting | Main fragility | Evidence quality |
|---|---|---|---|---|---|---|---|
| Synthetic `keydown/keypress/keyup` on iframe document (§2 A) | `isTrusted=false` | Open; focus in editor | Yes, any delay (claimed ≥20–30 ms) | Risky, US-ASCII assumptions | Shortcuts only | Docs may stop honouring untrusted events; selector | Code in 3+ repos through Feb 2026; one LLM-written validation claim Apr 2026; contradicted by one ADR |
| `execCommand('insertText')` / `InputEvent` on iframe (§2 B) | n/a | Open; focus | Yes | Any string | `execCommand` formatting (one project) | iframe DOM changes not synced to model; abandoned by one project | Code in 3 repos through Oct 2026; conflicting claims |
| `chrome.debugger` + CDP (§4) | Trusted | Open, active, focused (or focus emulation) | Yes | `Input.insertText` or `char` events | Shortcuts with modifiers | Infobar; `debugger` permission; Chrome ≥118 only | Code in 4 repos through Nov 2026; official protocol docs |
| External CDP / Playwright (§4) | Trusted | Dedicated Chrome instance | Yes | Same as CDP | Shortcuts | Requires launching Chrome with remote debugging | Code in 2 repos, 2026 |
| Docs REST API (§5) | n/a (server) | No | ≤1 write/s/user | Full Unicode | First-class | 60 writes/min/user; sensitive scope; billing change "later in 2026" | Official docs |
| Apps Script (§6) | n/a (server) | No for triggers | Within 6-min runs | Full Unicode | First-class | 1-min trigger floor; 90 min/day (consumer); add-ons hourly | Official docs only; no typer project found |
| OS-level (§7) | Trusted | Focused window, machine occupied | Yes | Layout-dependent (pyautogui); AHK ok | Shortcuts | Wrong-window typing; no background use | Small scripts; official AHK/pyautogui docs; AppleScript/nut.js unverified |
