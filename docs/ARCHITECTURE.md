# Architecture and API guide

## Runtime

One Node.js 24 process owns Express, Socket.IO, and a SQLite database opened with the built-in `node:sqlite` module. In production, the same process serves the Vite build. In development, Vite proxies `/api` and `/socket.io` to Node. Browser cookies therefore remain same-origin; no access tokens are placed in local storage.

React maintains current conversation state and fetches authoritative history over HTTP. Socket events announce new messages, receipt changes, membership changes, status changes, and presence. History is loaded in batches of 60 using an integer message cursor. Submitting a message uses a client-generated UUID; the database has a unique `(sender_id, client_id)` constraint to make retries idempotent.

## Source map

| Path                              | Responsibility                                                     |
| --------------------------------- | ------------------------------------------------------------------ |
| `src/App.jsx`                     | Session bootstrap, navigation, sockets, shared application state   |
| `src/api.js`                      | Same-origin requests, upload helper, formatting                    |
| `src/components/Auth.jsx`         | Sign-in and registration                                           |
| `src/components/Sidebar.jsx`      | Chat filters/list, status list, call history                       |
| `src/components/Conversation.jsx` | History, composer, uploads, voice recording, message actions       |
| `src/components/NewChat.jsx`      | Registered-user discovery, direct/group creation, member selection |
| `src/components/ChatDetails.jsx`  | Preferences, export, group administration, blocking                |
| `src/components/Settings.jsx`     | Profile, avatar, theme, notifications, password                    |
| `src/components/Status.jsx`       | Status creation and viewing                                        |
| `src/hooks/useCalls.js`           | WebRTC media acquisition, negotiation, ICE, cleanup                |
| `src/components/CallDialog.jsx`   | Incoming and active call interface                                 |
| `src/components/UI.jsx`           | Accessible buttons, modals, avatars, receipts                      |
| `src/styles.css`                  | Light/dark styles, desktop layout, responsive mobile screens       |
| `server/db.mjs`                   | Initial schema, indices, transactions; schema version 1            |
| `server/security.mjs`             | Password hashing, token hashing, cookie parser, rate limits        |
| `server/app.mjs`                  | HTTP routes, authorization, uploads, realtime events, call state   |
| `server/index.mjs`                | Process startup and graceful shutdown                              |
| `server/seed.mjs`                 | Idempotent local demo data                                         |
| `scripts/`                        | Node version check, setup, development process supervisor          |
| `tests/`                          | HTTP/socket/database tests and React interaction tests             |

## Data model

| Table          | Main purpose                                                                   |
| -------------- | ------------------------------------------------------------------------------ |
| `users`        | Unique email, salted password hash, profile and avatar reference               |
| `sessions`     | Hashed random bearer cookie, user, expiry                                      |
| `chats`        | Direct/group type, owner, name, unique direct participant pair                 |
| `members`      | Chat membership, read/delivery cursors, pin/archive/mute flags                 |
| `messages`     | Ordered history, sender, text/type, attachment/reply, edit/delete state        |
| `attachments`  | Owner, purpose, optional chat, safe stored filename, MIME, size                |
| `stars`        | Per-user saved-message links                                                   |
| `statuses`     | Text/image status and expiry timestamp                                         |
| `status_views` | Unique viewer per status                                                       |
| `blocks`       | Directed block relationships, enforced bidirectionally for direct interactions |
| `calls`        | Participants, mode, call state and timestamps                                  |

Foreign keys are enabled. SQLite uses WAL and a busy timeout. Message IDs are globally increasing integers, and chat history has a `(chat_id, id)` index. New group members see existing group history. Removed members immediately lose HTTP and socket-room access. If an admin leaves, the remaining member with the first sorted ID becomes admin. Empty groups remain stored with no members and no owner.

## HTTP API

All routes below begin with `/api`. JSON mutations use `Content-Type: application/json` and **`X-Requested-With: ChatApp`**. Uploads use `multipart/form-data` with one field named `file` and the same request verification header. Except register/login/health, endpoints require the `chat_session` cookie.

| Method | Route                                  | Purpose                                                |
| ------ | -------------------------------------- | ------------------------------------------------------ |
| GET    | `/health`                              | Service health                                         |
| POST   | `/auth/register`                       | `{name,email,password}`                                |
| POST   | `/auth/login`                          | `{email,password}`; set session cookie                 |
| GET    | `/auth/me`                             | Current user                                           |
| POST   | `/auth/logout`                         | Revoke current session and its sockets                 |
| GET    | `/config`                              | ICE configuration and upload limit                     |
| PATCH  | `/profile`                             | `{name,about,color}`                                   |
| POST   | `/profile/avatar`                      | Upload avatar image, maximum 5 MB                      |
| POST   | `/profile/password`                    | `{current,password}`; revoke other sessions            |
| GET    | `/users?q=...`                         | Shared contacts when empty; search name or exact email |
| POST   | `/users/:id/block`                     | `{blocked}`                                            |
| GET    | `/chats`                               | Authorized conversations and computed unread counts    |
| POST   | `/chats`                               | `{type,userIds,name?}`; direct chats are deduplicated  |
| PATCH  | `/chats/:id`                           | `{pinned?,archived?,muted?,name?}`                     |
| POST   | `/chats/:id/members`                   | Admin adds `{userIds}`                                 |
| DELETE | `/chats/:id/members/:userId`           | Admin removes member, or user leaves                   |
| GET    | `/chats/:id/messages?before=ID&q=TEXT` | Cursor history or text search                          |
| POST   | `/chats/:id/messages`                  | `{clientId,text?,attachmentId?,replyId?}`              |
| POST   | `/chats/:id/read`                      | `{messageId}`; clamped to existing history             |
| POST   | `/chats/:id/attachments`               | Upload chat attachment                                 |
| GET    | `/messages/:messageId`                 | Authorized single-message refresh                      |
| PATCH  | `/messages/:messageId`                 | Owner edits text with `{text}`                         |
| DELETE | `/messages/:messageId`                 | Owner deletes message for everyone                     |
| POST   | `/messages/:messageId/star`            | `{starred}` for current user                           |
| GET    | `/starred`                             | Current user's starred messages (up to 200)            |
| GET    | `/files/:id?download=1`                | Authorized file access; optional forced download       |
| GET    | `/statuses`                            | Own and eligible contacts' unexpired statuses          |
| POST   | `/statuses`                            | `{text,color,attachmentId?}`                           |
| POST   | `/statuses/upload`                     | Upload status image, maximum 5 MB                      |
| POST   | `/statuses/:id/view`                   | Idempotent viewer record                               |
| DELETE | `/statuses/:id`                        | Owner deletes status                                   |
| GET    | `/calls`                               | Current user's most recent 100 calls                   |

Errors use `{ "error": "Human-readable explanation" }`. Validation errors are 400; unauthenticated requests 401; unauthorized requests 403; missing objects 404; conflicts 409; throttling 429. Unknown API routes return JSON rather than the frontend HTML.

## Socket events

The server authenticates sockets using the HTTP-only session cookie. It revalidates inbound events, schedules expiry disconnects, and joins only authorized `user:ID`, `session:HASH`, and `chat:ID` rooms. Room names are server-controlled.

| Direction        | Event               | Payload / behavior                                                  |
| ---------------- | ------------------- | ------------------------------------------------------------------- |
| Server → browser | `chats:changed`     | Refresh current user's chat list                                    |
| Server → browser | `message:new`       | Serialized new message                                              |
| Server → browser | `messages:changed`  | `{chatId,messageId}` after edit/delete                              |
| Server → browser | `messages:receipts` | `{chatId}` after delivery/read update                               |
| Server → browser | `presence`          | Public profile with online/last-seen state                          |
| Browser → server | `typing`            | `{chatId,typing}`                                                   |
| Server → browser | `typing`            | Adds `{userId,name}`; UI expires stale typing indications           |
| Server → browser | `statuses:changed`  | Refresh authorized status feed                                      |
| Browser → server | `call:start`        | `{chatId,mode:'audio'                                               | 'video'}`; callback returns call |
| Server → browser | `call:incoming`     | Show recipient call dialog                                          |
| Browser → server | `call:accept`       | `{id}`; callee only, while ringing                                  |
| Server → browser | `call:accepted`     | Caller begins WebRTC offer                                          |
| Server → browser | `call:handled`      | Dismiss the call on the callee's other tabs                         |
| Either           | `call:signal`       | `{id,signal:{description? ,candidate?}}`; participant authorization |
| Browser → server | `call:end`          | `{id}`                                                              |
| Server → browser | `call:ended`        | `{id,status}`                                                       |

Call callbacks return `{ok:true,...}` or `{ok:false,error}`. Ringing times out after 40 seconds. A disconnected calling/answering tab ends its call even if another tab keeps that account online. The frontend closes peer connections and stops media tracks on termination, permission errors, and unmount.

Call media flows between browsers through WebRTC, with TURN relay when configured; Socket.IO carries signaling only. No call recording, screen sharing, or group conferencing is implemented.

## Implementation references

- [Node.js 24 SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Socket.IO middleware](https://socket.io/docs/v4/middlewares/)
- [Socket.IO server API](https://socket.io/docs/v4/server-api/)
- [Vite guide](https://vite.dev/guide/)
