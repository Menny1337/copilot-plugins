# Browser workflow validation

## Scope

Source validation, 2026-10-27: macOS 27.2, Edge 156.0.4314.50, Node 24.22.1,
Playwright CLI 0.1.19, core 1.63.0-alpha-2026-08-31.
Windows and Chrome have not been tested live for this change.
This note is evidence, not an instruction to load during normal browser tasks.

The default uses a fresh retained profile per task. SSO worked in the observed
environment; this does not guarantee authentication elsewhere. Intended-account
checks need a user-established identity, compared only inside account UI.
Do not store identities, tokens, mailbox content, or profile data in this repo.

## Results across runs

| Area | Evidence |
| --- | --- |
| Default lifecycle | Author and independent runs passed owned launch, profile/page isolation, overlapping starts, collision rejection, and exact shutdown. |
| Background activity | Initial page, navigation, reload, and cross-origin checks passed with stable non-browser foreground. |
| Extra tabs | `tab-new`/`tab-select` can activate the browser. Foreground samples do not prove background behavior. |
| Native activity | Managed mode rejects native before profile allocation. Explicit-profile Bridge native startup passed; full native parity was not established. |
| Authentication | Earlier runs reached protected shells without an expected identity. The follow-up verified the user-specified identity in Outlook and ADO account menus. |
| Outlook | A renamed ribbon control caused the old exact-selector failures. The corrected driver created a self-addressed draft, saved rich text and a link, reopened the exact test draft, and discarded it. A final driver run repeated creation, autosave, and verified discard. No mail was sent. |
| ADO | A fresh-task visit hit two `Execution context was destroyed` errors during SSO redirects. Bounded read-only recovery retained both errors and reached the protected shell in 18.1 seconds. The final harness verified the already-visited ADO shell and visible account identity in 4.8 seconds. |
| Final Outlook auth check | First Outlook visit in the final diagnostic profile passed shell, supported compose-control, and visible expected-account checks in 19.8 seconds. |
| Cleanup | Both named test drafts were verified absent. All five browser processes created during the follow-up were verified absent after exact close. Profiles were retained as required. |
| Regression checks | 100 browser/evaluator tests passed, with no failures or skips. Repository validation and generated-document freshness checks passed. |

Original startup failures (`window-not-created`, `-609`, attachment/foreground
failures) remain recorded in the historical evidence. Later successful runs do
not erase them or prove every historical cause. The earlier ADO error lost its
diagnostic text, so the newly observed redirect race cannot conclusively explain
that older failure.

The first PR validation run failed on Ubuntu: mocked managed-session tests still
constructed host-native dependencies. The runtime now honors injected native
adapters and state roots, and routing tests supply their mocked runtime explicitly.
This keeps lifecycle coverage portable without enabling Linux browser automation
or adding skips. The existing macOS-only script tests still require macOS.

An intermediate account check remained PARTIAL because the ADO account header
loads after the project shell. A stricter follow-up also exposed that the account
menu's wrapper stays visible when collapsed. Neither observation was hidden.
The evaluator now waits within the original budget for account chrome, checks
the actual trigger/visible email instead of wrapper presence, and clicks the
trigger at most once. The final ADO and Outlook account checks passed with the
final source unchanged during execution. The final ADO identity check was warm;
it is not a new cold-profile SSO claim.

Alternate accounts, forced MFA/CAPTCHA/passkey flows, independent-agent
concurrency, destructive fault injection, reply/forward/send, and background
proof after tab activation are not established by this follow-up.

## Repeat the bounded authentication check

Use an existing helper-owned session and its returned `cwd`. The evaluator does
not create or close sessions; the caller must close its own session in `finally`.

```bash
# Set BROWSER_EXPECTED_ACCOUNT privately to the user-provided account.
node scripts/browser-auth-check.mjs \
  --session "<owned-session>" --cwd "<returned-cwd>" \
  --site ado --output "<private-artifact-directory>/ado-result.json"
```

Use `--site outlook` for the Outlook shell and supported compose-control count.
The output contains identity-match booleans, not the identity. Shell readiness
alone is PARTIAL; a different observed account is FAIL. No accounts are selected
or switched. The evaluator may open only the known account-menu control.

The 45-second budget includes navigation, reads, and account-menu inspection.
Only known navigation-context errors are retried, within that budget; all
failures remain in the report. Unknown errors stop the check. Diagnostics retain
exit code, signal, phase, timing, and redacted technical messages. Reads use
scoped selectors, not main/body text or mailbox records. Explicit error selectors
are observations, not an exhaustive authorization-denial detector.

Driver mutation checks are separate and need user approval for a disposable
test draft and its deletion. Use a unique subject and verify only that draft.
Never use mailbox enumeration, unrelated message reads, sends, consent changes,
or security challenges merely to obtain a passing result.

## Inspection scope caveat

An early manual top-bar diagnostic returned an unrelated calendar-control label.
Its contents were not copied into repository notes or structured evidence.
That listing is not part of the reusable evaluator, which uses only scoped
readiness selectors, the compose control, and account UI. No messages were
enumerated, opened, or sent.

## Evidence

Detailed private reports remain in the producing Copilot sessions:

- Original baseline and managed implementation: `dfc13149-6ec5-4614-89f7-e22f633c6749`.
- Independent shortened-skill evaluation: `8a87066d-8e73-45fb-aeeb-93a8e92f948e`.
- Outlook/ADO follow-up: `62ac85f9-a2dd-4ae4-8241-b2421c697556`.

Reports are cumulative; keep failed attempts alongside passing follow-ups.
These are local-source results, not evidence that the installed plugin was
refreshed or that a release was published.
