---
name: m365-messaging
description: "Read and send Microsoft Teams messages via the Teams MCP server (chats, channels, presence, mentions, search). Use for catch-up on chats, replying to people, posting to a channel, checking if someone is online before pinging, or searching past Teams conversations. Triggers: check Teams, any new messages, unread, DMs, message Sarah, ping the team, post to channel, what did X say, mentions, who messaged me, Teams catch up, is X online, send Teams message, notes to self, reply on Teams, send Teams file, m365 user lookup."
argument-hint: "<person or channel, and the message to send>"
---

# M365 Messaging

Procedures for reading and sending Microsoft Teams messages through the `teams-*` MCP tools and resolving people through the `m365-user-*` MCP tools.

## When to Use

- The user wants to catch up on unread Teams chats or DMs ("any new messages", "what did I miss")
- The user wants to send a Teams message to a person, a group chat, a channel, or themselves (Notes to Self)
- The user wants to search past Teams messages by keyword, sender, or date
- The user wants to check whether someone is online before pinging them
- The user wants to read or reply within a specific channel thread
- The user wants to share a file in a Teams channel
- The user mentions a person by name/alias/email and the calling tool needs a real UPN

## When to Skip

- Calendar / meeting scheduling → use the `calendar-*` MCP tools directly (separate domain)
- Email read/send → out of scope (use `m365_email` tools directly when needed)
- Recording personal notes/tasks/reminders locally → use **assistant-capture** instead
- Searching local notes or tasks → use **assistant-query** instead

## Required MCP servers

This skill depends on two MCP servers being connected to the session:

- `teams` — provides all `teams-*` tools listed below
- `m365-user` — provides `m365-user-*` people-lookup tools

If neither is connected, stop and tell the user: "The Teams MCP isn't connected in this session — start it (e.g., via `agency mcp teams`) and try again." Do **not** silently fall back to anything else.

To verify availability before acting, attempt a low-cost call such as `m365-user-GetMyDetails` (returns the signed-in user) or `teams-ListChats` with no filters. A successful response confirms both servers are live.

---

## 1. Tool Map

Use these exact namespaced tool names — they are what the MCP server exposes.

### People lookup (`m365-user-*`)

| Tool | Purpose |
| --- | --- |
| `m365-user-GetMyDetails` | Signed-in user's profile (use for "who am I", default sender) |
| `m365-user-GetUserDetails` | Lookup by **UPN** (`user@contoso.com`) or **GUID** only |
| `m365-user-GetMultipleUsersDetails` | Lookup by display name, job title, office, alias, etc. — **use this first when you only have a name** |
| `m365-user-GetManagerDetails` | Resolve a person's manager |
| `m365-user-GetDirectReportsDetails` | Resolve a person's reports |

**Dependency rule:** any tool that takes a `userId` / `userIdOrUpn` / `attendeeEmails` parameter requires a **real UPN**. Never fabricate, guess, or construct one from a display name. If you only have a display name, call `m365-user-GetMultipleUsersDetails` first, pick the right match (ask the user to disambiguate when there are multiple), then pass that UPN.

### Teams chats — read (`teams-*`)

| Tool | Purpose |
| --- | --- |
| `teams-ListChats` | List the user's recent chats. Returns `hasUnreadMessages` and `lastMessagePreview` — **primary tool for "any new messages"** |
| `teams-GetChat` | Details of a specific chat |
| `teams-ListChatMembers` | Members of a chat |
| `teams-ListChatMessages` | Messages in a chat (most-recent-first, paged via `nextLink`) |
| `teams-GetChatMessage` | A single message by ID |
| `teams-SearchTeamsMessages` | **Natural-language** search across chats + channels — use for fuzzy / "what did Sarah say about X" |
| `teams-SearchTeamMessagesQueryParameters` | **KQL** search (`from:`, `sent>=`, AND/OR, quoted phrases) — use when keywords/sender/date are exact |

### Teams chats — write (`teams-*`)

| Tool | Purpose |
| --- | --- |
| `teams-SendMessageToUser` | **Preferred for 1:1** — pass UPN, chat auto-created/reused. Idempotent. |
| `teams-SendMessageToChat` | Send to a known group/1:1 chat by `chatId` (use after `ListChats`) |
| `teams-SendMessageToSelf` | "Notes to Self" — no chatId needed |
| `teams-CreateChat` | Create a `oneOnOne` or `group` chat (caller auto-added). For 1:1 prefer `SendMessageToUser`. |
| `teams-AddChatMember` | Add a member to an existing chat |
| `teams-UpdateChatMessage` | Edit one of your own messages |
| `teams-DeleteChatMessage` / `teams-DeleteChat` | Destructive; require explicit user confirmation |

### Teams channels (`teams-*`)

| Tool | Purpose |
| --- | --- |
| `teams-ListTeams` | List teams the user belongs to — **always call first** before any channel operation to get the team GUID |
| `teams-GetTeam` | Details of a specific team |
| `teams-ListChannels` | Channels in a team (filter with OData, e.g., `membershipType eq 'private'`) |
| `teams-GetChannel` | Channel details |
| `teams-ListChannelMembers` | Members of a channel |
| `teams-ListChannelMessages` | Root posts in a channel (no replies) |
| `teams-ListChannelMessageReplies` | Replies within one thread |
| `teams-ListChannelFiles` | Files shared in the channel |
| `teams-SendMessageToChannel` | New top-level post (supports `subject` for a bold header) |
| `teams-ReplyToChannelMessage` | Threaded reply to an existing post |
| `teams-SendFileToChannel` | Attach a file (≤4 MB direct upload, or pass a SharePoint/OneDrive URL) |
| `teams-CreateChannel` | Create `standard` / `private` / `shared` channel |
| `teams-AddChannelMember` | Add member to private/shared channel (standard channels inherit team membership) |

### Formatting + presence (`teams-*`)

| Tool | Purpose |
| --- | --- |
| `teams-GetRichMessageFormats` | Returns supported HTML tags, @mention syntax, Adaptive Card templates, importance levels — **call this before composing any rich message** |
| `teams-GetUserPresence` | Real-time availability + activity (Available, Busy, InAMeeting, DoNotDisturb, etc.) — **call before sending a non-urgent ping** |

---

## 2. Core Workflows

### A. "Any new messages?" / "Catch me up on Teams"

1. Call `teams-ListChats` with no arguments.
2. Filter the response to chats where `hasUnreadMessages = true`.
3. For each unread chat, surface: chat topic (or other member's name for 1:1), unread count if available, and `lastMessagePreview`.
4. If the user wants the full thread of any chat, call `teams-ListChatMessages` with `top: 20` for that `chatId`.
5. Output format:

   ```
   📬 3 unread Teams chats
   • Sarah Chen — "can you review the perf PR?" (2 unread)
   • #FE-Infra (group) — "anyone seen the build failure?" (5 unread)
   • Miki Lavi — "let's sync at 3" (1 unread)
   ```

6. If zero unread, say so plainly: "✅ No unread Teams chats."

### B. "Message <Person>" / "DM Sarah about X"

1. Resolve the person:
   - If the user gave a UPN/email, use it directly.
   - Otherwise call `m365-user-GetMultipleUsersDetails` with `searchValues: ["<display name>"]` and `propertyToSearchBy: "displayName"`. Select `displayName,mail,userPrincipalName,jobTitle`.
   - Ambiguous → ask the user which match they meant. Never guess.
2. (Optional, recommended for non-urgent pings) Call `teams-GetUserPresence` with the resolved UPN. If availability is `DoNotDisturb` or activity is `InAMeeting` / `Presenting`, surface that and ask: "They're in a meeting — send anyway, queue, or skip?"
3. Compose the message. For plain text, content type stays `text`. For mentions / cards / HTML, call `teams-GetRichMessageFormats` first.
4. Send via `teams-SendMessageToUser` with `userIdOrUpn` = resolved UPN and `content` = message body.
5. Confirm: "✉️ Sent to Sarah Chen — '<first 60 chars>...'".

### C. "Reply in the chat with <Person/Group>"

1. Find the chat via `teams-ListChats` (filter by `memberUpns` or `topic` if helpful).
2. Send with `teams-SendMessageToChat` using the `chatId` from step 1.
3. For mentions inside group chats, fetch `teams-ListChatMembers` to get each mentioned user's `userId`, then build the `mentions` array per `teams-GetRichMessageFormats`.

### D. "Post to <channel> in <team>"

1. `teams-ListTeams` → find team GUID by `displayName`.
2. `teams-ListChannels` with the team GUID → find channel by `displayName`.
3. For a new post: `teams-SendMessageToChannel`. Use `subject` for a bold header when the post is announcement-style.
4. For a threaded reply: `teams-ListChannelMessages` to find the parent `messageId`, then `teams-ReplyToChannelMessage`.

### E. "Note to self" / "remind me in Teams"

Single call: `teams-SendMessageToSelf` with `content`. No chat lookup needed. Useful when the user explicitly wants the reminder to surface in their Teams client (not just local `~/.copilot/assistant/`).

### F. Search past Teams messages

Pick the right tool based on the user's query shape:

- **Exact terms / sender / date filters** → `teams-SearchTeamMessagesQueryParameters` with KQL:
  - `from:sarah@contoso.com AND budget`
  - `"deploy plan" sent>=2026-05-01`
  - Max 25 results per page; use `from:` parameter for paging offset.
- **Vague / topical** → `teams-SearchTeamsMessages` (natural language). Returns a summary + `chatIds`; drill into specific threads with `teams-ListChatMessages`.

### G. "Is <Person> online?"

`teams-GetUserPresence` with the user identifier (UPN, GUID, or display name — the tool resolves internally). Surface both `availability` (e.g., `Busy`) and `activity` (e.g., `InAMeeting`) so the user knows whether to ping now.

### H. Share a file in a channel

Decide the route:
- File already in SharePoint/OneDrive → pass `fileUrl` to `teams-SendFileToChannel`.
- Local file → base64-encode (`≤4 MB`) and pass `fileContentBase64` + `fileName`.
Include an optional `message` to give context.

---

## 3. Composing Rich Messages

When the message needs **any** of: mentions, bold/italic/lists, hyperlinks beyond plain URLs, code blocks, Adaptive Cards, or `importance: high/urgent`:

1. Call `teams-GetRichMessageFormats` once per session and reuse the response.
2. Build `contentType: "html"` content using the documented HTML subset.
3. For mentions, include both `@DisplayName` in the body **and** a matching entry in the `mentions` JSON array (`{"displayName","id","type"}`).
4. For Adaptive Cards, only `Action.OpenUrl` actions are supported by Graph — do not include `Action.Submit` etc.
5. Set `importance: "urgent"` sparingly — it pings the recipient every 2 minutes for 20 minutes.

---

## 4. Safety & Confirmation Rules

- **Destructive operations** (`teams-DeleteChat`, `teams-DeleteChatMessage`, `teams-UpdateChatMessage` that materially rewrites a sent message) require an explicit user confirmation before execution. Show what will change and ask "proceed?".
- **Outbound messages**: when the user asks for a non-trivial Teams message, show the draft + recipient first and ask "send?" unless they explicitly said "send it now" / "just send" / similar.
- **Mentions of @channel / @team**: confirm before sending — they notify many people.
- **`importance: urgent`**: confirm before using; it triggers repeating notifications.
- **Cross-tenant sends**: if the resolved UPN's domain differs from the signed-in user's domain (compare against `m365-user-GetMyDetails.userPrincipalName`), warn the user before sending.
- **UPN fabrication is forbidden.** If lookup fails, stop and ask the user.

---

## 5. Gotchas

- `teams-ListChats` defaults to scanning up to 200 chats; pass `fetchAllPages: true` only if the user explicitly wants exhaustive results.
- `teamId` is a **GUID**; `channelId` is `thread.tacv2`; `chatId` is `thread.v2`. Never swap them — every tool validates the format and returns an unhelpful error if you pass the wrong one.
- Standard channels do **not** support `AddChannelMember` — they inherit team membership. Use this only for `private` / `shared` channels.
- `teams-CreateChat` of type `oneOnOne` between two users who already share a chat returns the existing chat (idempotent) — do not deduplicate yourself.
- `teams-SearchTeamMessagesQueryParameters` does **not** support `subject:`, `to:`, or `hasAttachment:` for chat-message search — those KQL fields are silently ignored.
- `m365-user-GetUserDetails` rejects display names and SMTP-only addresses — it only accepts UPN or GUID. Use `GetMultipleUsersDetails` for everything else.
- Presence is **real-time** — do not cache it across turns; re-fetch before any "should I ping now" decision.

---

## 6. Output Conventions

When surfacing Teams data in chat, prefer compact, scannable formats:

- Lead with an emoji + count line (📬 / ✅ / 🔔).
- One bullet per chat / message — keep the preview ≤ 80 chars.
- Show sender's display name, not raw UPN, unless disambiguation is needed.
- Use ISO timestamps (`2026-05-19T11:42`) or relative time (`2h ago`) — never raw Graph timestamps.
- For sent confirmations, echo: `✉️ Sent to <Display Name> · "<first chars>…"`.

---

## 7. Integration with the Personal Assistant Workspace

When invoked by an agent that also manages `~/.copilot/assistant/`:

- A Teams DM that contains a clear ask MAY be offered as a captured task (`assistant-capture` skill). Always **offer**, never auto-create — the user owns their task list.
- An unread-DM summary MAY be folded into the morning briefing under a `💬 Teams` lane. Hide the lane when zero unread (consistent with the briefing's hide-empty rule).
- Never persist message contents to disk without an explicit request — Teams messages stay in Teams unless the user says "save this".
