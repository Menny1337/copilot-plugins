# Outlook on the web (OWA) — one-shot playbook

Read this **before** touching Outlook in a browser. Improvising against OWA is the single
biggest source of retry loops in this skill: the DOM is dynamic, several controls are
ambiguous, and two of the obvious "safe" moves silently destroy the user's draft.

The fast path is the bundled driver:

```bash
SKILL_SCRIPTS="$(dirname "$0")/../scripts"   # or the skill's scripts/ dir
node "$SKILL_SCRIPTS/owa-compose.mjs" draft --spec /tmp/mail.json
```

One command opens the compose, fills To/Cc/Bcc, sets the subject, injects rich HTML,
verifies every field, and leaves a saved draft. It replaces roughly a dozen hand-rolled
`playwright-cli` calls and all of the snapshot-grep loops.

---

## 1. One-shot path (use this first)

Write a spec file, then run one command.

```jsonc
// /tmp/mail.json
{
  "to":      ["someone@contoso.com", "other@contoso.com"],
  "cc":      ["watcher@contoso.com"],
  "bcc":     ["archive@contoso.com"],
  "subject": "Weekly performance update",
  "bodyHtmlFile": "/tmp/body.html"     // or "bodyHtml": "<p>…</p>"
}
```

```bash
node scripts/owa-compose.mjs draft --spec /tmp/mail.json
```

Success prints a verification block — read it back to the user rather than claiming success:

```json
{
  "ok": true,
  "action": "draft",
  "state": {
    "toPills": 2, "ccPills": 1, "bccPills": 1,
    "subject": "Weekly performance update",
    "bodyChars": 205, "bodyAnchors": 1,
    "savedIndicator": "Draft saved at 10:09 PM"
  }
}
```

`ok: false` with a non-zero exit means **nothing was silently half-done** — the error names
the field that failed. Do not retry blindly; read the error, then run `probe` (§7).

### Command surface

| Command | Effect |
|---|---|
| `attach` | Attach to the browser, failing fast on a stale token (§6) |
| `probe` | Dump the live compose DOM contract — run when a selector misses |
| `draft --spec <file>` | Open, fill, verify, leave saved as a draft |
| `reply --spec <file> --mode reply\|reply-all\|forward` | Same, from the open message |
| `read [--index <n>]` | Read the open message, or open list item `n` first |
| `list-drafts` | List drafts, to confirm a draft landed |
| `close` | Leave compose, **keeping** the draft |
| `discard` | Destroy the draft, confirming the OK dialog |
| `send --confirm` | Send the compose that is **already open** — the `draft` → review → send path |
| `send --spec <file> --confirm` | Compose and send in one shot. Requires the explicit flag (§5) |

Useful flags: `--session <name>` (profile/token selector, §6), `--timeout <ms>` (per
`playwright-cli` call, default 45000), `--json` (suppress the stderr progress log so stdout
is pure JSON).

---

## 2. Verified DOM contract

Verified live against `outlook.cloud.microsoft`, **2026-07-25**. If a selector misses, run
`probe` and update this table with a fresh date rather than guessing.

| Purpose | Selector |
|---|---|
| Open compose | `button[aria-label="New mail"]` |
| To / Cc | `div[aria-label="To"\|"Cc"][contenteditable="true"]` |
| Bcc | `div[aria-label="Bcc"][contenteditable="true"]` — **absent until revealed**, see §3 |
| Subject | `input[aria-label="Subject"]` (placeholder "Add a subject") |
| Body | `[aria-label="Message body"][contenteditable="true"]` (role=textbox) |
| Send | `button[aria-label="Send"]` (title "Send (⌘+Enter)") |
| Discard | `#discardCompose` (aria-label "Discard", title "Discard (Esc)") |
| Message list | `[role=option]` — the full summary is in `aria-label` |
| Reply / Reply all / Forward | `button[aria-label="Reply"\|"Reply all"\|"Forward"]` |

Element **ids are dynamic** (`MSG_<suffix>_SUBJECT`, `fui-InteractionTagSecondary-r4h`,
recipient ids `"0"`,`"1"`,`"2"` or `"3"`,`"4"`). Never hardcode an id except `#discardCompose`,
which is stable.

**Host drift:** `outlook.office.com/mail/` redirects to `outlook.cloud.microsoft/mail/`.
Accept both in any URL assertion.

### Filling fields that actually work

- **Recipients** are not inputs. Click the contenteditable, type **one** address, press
  `Enter`, then confirm a pill appeared before typing the next one.
- **Subject** is a real `<input>` — `fill` works.
- **Rich body**: focus the editor, collapse a range to the desired end, then
  `document.execCommand('insertHTML', false, html)`. Fire
  `ed.dispatchEvent(new Event('input', {bubbles:true}))` afterwards to trigger autosave.
- **Autosave receipt**: an element whose text matches `/^Draft saved/i`
  (e.g. "Draft saved at 10:09 PM"). Treat this as the proof the draft exists.

---

## 3. Traps — each one caused real retry loops

| Trap | What actually happens | Correct move |
|---|---|---|
| **`Escape` in compose** | Maps to **Discard (Esc)** and silently destroys the draft | **Never send Escape.** Use `close` (keeps) or `discard` (explicit) |
| **`/mail/deeplink/compose?to=…&subject=…`** | Renders only "Loading" forever | Dead end. Open compose and fill fields |
| **Bcc missing from the DOM** | The field does not exist until revealed. The toggle is a `<button>` whose `textContent` is exactly `"Bcc"` with **no id and no aria-label**, so `getByRole('button',{name:'Bcc'})` fails | Match by exact `textContent` in a DOM eval, then `.click()` |
| **Two `aria-label="Close"` buttons** | One is an **invisible decoy at (0,0)** | Filter by `getBoundingClientRect().width/height > 0` |
| **Full-page compose has no Close** | At `/mail/compose/<id>` only Discard exists — clicking "the close button" fails, and Discard would destroy the draft | The draft is already autosaved: **navigate away** to keep it |
| **Two `[role=dialog]` nodes** | One is empty | Filter to dialogs that are visible **and** have non-empty `innerText` |
| **Modal state bricks tooling** | `Tool "browser_evaluate" does not handle the modal state` — one unnoticed dialog (commonly OWA's `beforeunload`) breaks every later call, and with `--raw` the error arrives as a bare `Error: …` line that is easily mistaken for a value | The driver auto-recovers: it clears the dialog and retries once. By hand: `playwright-cli dialog-dismiss` (for `beforeunload` this means "stay", preserving the draft), then `dialog-accept` if it persists |
| **Shell quoting corruption** | Body HTML with `"`, `$`, backtick, `\` corrupts the eval | Pass argv arrays (no shell) and carry HTML as **base64** |
| **`<strong>` → `<b>`** | OWA rewrites this **server-side on reload**, not on insert | Assert on text and anchor counts, never on those tags |
| **Compose tabs stack** | Multi-mail runs leave orphan tabs | `close` or `discard` each compose before starting the next |
| **Snapshot cost** | A full OWA snapshot is thousands of lines | Use targeted evals or `probe`; never grep whole snapshots |
| **`file://` blocked** | Local HTML will not load | Serve it: `python3 -m http.server` |

Discard confirmation text, for reference: *"Discard message / Are you sure you want to
discard this draft? / OK / Cancel"*.

---

## 4. Reading, replying, forwarding

```bash
node scripts/owa-compose.mjs read --index 0          # open list item 0 and read it
node scripts/owa-compose.mjs reply --mode reply-all --spec /tmp/reply.json
```

- The message list is `[role=option]`; the useful summary is the `aria-label`.
- `read` reports `kind: "message"` or `kind: "compose"` so you know what you are looking at.
- **Reply/Reply-all/Forward reuse the identical compose contract** — same Subject, To, Cc,
  Body, `#discardCompose`, Send. Fields arrive prefilled; a reply spec usually needs only
  `bodyHtml`.
- Reply/Forward buttons are **duplicated** in the ribbon and the reading pane, so visibility
  filtering matters here too.
- The body is inserted at the **top**, above the quoted thread, which loads lazily. Verified:
  the quoted thread survives.
- Adding recipients to a reply works exactly as in §2 — pills, one address at a time.

---

## 5. Sending is opt-in

**Default to leaving a draft.** Drafting is reversible; sending is not.

`send` refuses without an explicit flag:

```json
{ "ok": false, "error": "confirm-required",
  "message": "send requires --confirm. Draft first, let the user read it, then re-run `send --confirm` (no --spec) to send that same draft." }
```

The correct sequence is: `draft` → show the user the verification block → get explicit
approval → `send --confirm` **with no `--spec`**, which sends the compose still open on
screen. Never infer approval from "send this email" alone if the content was authored by
you and not yet reviewed.

| Invocation | What it does |
|---|---|
| `send --confirm` | Sends the open compose. Use this after `draft`. |
| `send --spec <file> --confirm` | Opens a *new* compose, fills it, sends it. Only for genuinely one-shot sends — running it after `draft` sends a second message and leaves the reviewed draft orphaned in Drafts. |

If nothing is open, bare `send --confirm` fails with `no-compose` rather than guessing.

> Boundary note: if a skill produced the HTML (e.g. a weekly-report skill that deliberately
> only emits a copyable file), **that** skill owns the content and this one owns putting it
> into a draft. Do not duplicate the composition logic here.

---

## 6. Profiles and tokens

Each browser profile runs **its own copy** of the Playwright Bridge extension, and each
mints its **own** token. The session name selects the profile:

| Profile | Session | Use for |
|---|---|---|
| Edge `Default` ("Person 1", work account) | `msedge` | Work mail — the normal case |
| Edge "Woodgrove" | `msedge-woodgrove` | Woodgrove/demo tenant work only |

```bash
node scripts/owa-compose.mjs draft --spec /tmp/mail.json                        # work
node scripts/owa-compose.mjs draft --spec /tmp/mail.json --session msedge-woodgrove
```

Pick the profile that matches the **mailbox the user means**. If the request mentions
Woodgrove or a demo tenant, use that session; otherwise use the default work session. If the
intended mailbox is ambiguous, ask before drafting — sending from the wrong tenant is not
recoverable.

### Tokens resolve themselves — there is nothing to capture

`playwright-cli attach --extension` **never validates the token**. It launches the browser at
the extension's `connect.html?token=…` and then waits for the extension to call back. If the
token is wrong, the extension simply refuses and the CLI **hangs forever with no output** —
the "the script got stuck" symptom.

The fix is to stop guessing the token. The extension keeps the token it expects in its own
`localStorage` under `auth-token`, persisted in the profile's
`Local Storage/leveldb`. `scripts/bridge-token.mjs` reads it straight from disk, so the
correct token is simply *looked up* per profile:

```bash
node scripts/bridge-token.mjs list                      # every profile + token + status
node scripts/bridge-token.mjs check --session msedge    # exit 1 on drift
node scripts/bridge-token.mjs sync-all                  # write one token file per profile
```

`owa-compose.mjs` calls this automatically, which means:

- **A stale token file cannot hang you** — the profile's real token wins, so the run just
  succeeds (~1s) instead of hanging.
- **A genuinely impossible attach fails in ~0.15s**, naming the cause (`profile-not-found`,
  `extension-not-installed`) instead of timing out.
- **No consent-dialog recapture is needed.** A profile that has been opened once already has
  a token on disk.

`list` output tells you the state at a glance:

```
Person 1     msedge               ok (file matches)
Woodgrove    msedge-woodgrove     ok (resolved from profile)
Profile 1    msedge-profile1      no-extension
```

Token files under `~/.config/playwright-bridge/<session>.token` are now only a cache — useful
for other tools that read the token from the environment, and refreshed by `sync-all`. Two
files holding **identical** values still means one was overwritten:

```bash
md5 ~/.config/playwright-bridge/*.token     # identical hashes = a bug, not a coincidence
```

Tokens are 43 characters and do **not** rotate on their own. Never commit one to a repo.

> Attach via the **bridge extension (Mode A)** only. Mode C corrupts the Entra work-account
> binding (`AADSTS530003`) — see `known-issues.md`.

---

## 7. When a selector misses — self-healing

Microsoft ships OWA UI changes often. When something misses, **do not retry blindly**:

```bash
node scripts/owa-compose.mjs probe
```

`probe` opens a scratch compose (discarding it afterwards) and dumps the live contract:
which selectors matched, every visible `contenteditable` with its `aria-label`/`role`/`id`,
and the relevant buttons. Diff that against §2, fix the selector, and **update the table
with a new verification date** so the drift is recorded rather than rediscovered.

---

## 8. Manual fallback (no script)

If the driver cannot run, this is the minimum safe sequence. Note the base64 body — it is
what keeps hostile characters from corrupting the payload.

```bash
S=msedge
playwright-cli click --session $S 'button[aria-label="New mail"]'

# recipients: one address at a time, verifying a pill appears
playwright-cli click --session $S 'div[aria-label="To"][contenteditable="true"]'
playwright-cli type  --session $S 'someone@contoso.com'
playwright-cli press --session $S Enter

playwright-cli fill  --session $S 'input[aria-label="Subject"]' 'Subject here'

# body: base64 so quotes/$/backticks/backslashes cannot break the eval
B64=$(python3 -c 'import base64,sys;print(base64.b64encode(open(sys.argv[1],"rb").read()).decode())' /tmp/body.html)
playwright-cli eval --session $S "() => {
  var ed = document.querySelector('[aria-label=\"Message body\"][contenteditable=\"true\"]');
  ed.focus();
  var r = document.createRange(); r.selectNodeContents(ed); r.collapse(true);
  var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.execCommand('insertHTML', false, decodeURIComponent(escape(atob('$B64'))));
  ed.dispatchEvent(new Event('input', {bubbles:true}));
  return ed.innerText.length;
}"
```

Then verify (`Draft saved`, pill counts, subject) before reporting success — and remember:
**never press Escape**, and close a full-page compose by navigating away.
