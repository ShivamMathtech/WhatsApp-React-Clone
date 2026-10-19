# WhatsApp React Clone

A complete local messaging web application inspired by the supplied WhatsApp mobile screen reference, with a responsive desktop workspace. The React UI talks to a persistent Node.js/Express backend. Socket.IO delivers real messages and presence updates; SQLite stores accounts and conversations. There is no Firebase, MongoDB, paid API, or external account required for local chat.

**Start with `START-HERE.txt`. Requires Node.js 24.x LTS and an internet connection for the first dependency installation.**

## Run on Windows

1. Install [Node.js 24 LTS](https://nodejs.org/).
2. Extract the ZIP completely. Do not run inside the ZIP viewer.
3. Double-click `setup_windows.bat`. It installs the locked dependencies, builds React, creates `.env` if missing, and seeds the local demo accounts.
4. Double-click `start_windows.bat`.
5. Visit **http://localhost:3001**. Keep the terminal open.

PowerShell, macOS, or Linux:

```bash
node scripts/setup.mjs
npm start
```

Linux/macOS also have `bash setup.sh` and `bash start.sh`.

### Demo accounts

All five demo accounts use **`DemoChat@123`**.

| Name         | Email              |
| ------------ | ------------------ |
| Shivam Singh | shivam@demo.local  |
| Mahnoor      | mahnoor@demo.local |
| Usama        | usama@demo.local   |
| Sana         | sana@demo.local    |
| Areeb        | areeb@demo.local   |

Sign in as Shivam in a normal window and Mahnoor in an Incognito/InPrivate window. Open the matching conversation in both. Messages, typing, presence, and receipts update in real time. **Two ordinary tabs in the same browser profile share a session.** Use different profiles, private windows, browsers, or devices for different accounts.

The demo data contains sample messages and statuses. These contacts are regular registered users, not automated bots. Running the seed again preserves existing demo accounts and messages. Statuses expire after 24 hours and are not recreated on each launch.

To start without demo content:

```bash
npm ci
npm run build
npm start
```

Then create two accounts from the registration form. Use **New chat** to search by name or an exact registered email address. The initial contacts list shows people you already share chats with.

## Implemented features

| Area          | Functionality                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Accounts      | Registration, login/logout, persistent HTTP-only sessions, password hashing, password change with other-session revocation |
| Profiles      | Display name, about text, avatar image, avatar color                                                                       |
| Private chats | Persistent one-to-one messages, typing indicators, online/last-seen state, unread counts                                   |
| Receipts      | One check for saved; two checks after recipient connection; blue checks after opening the conversation                     |
| Groups        | Create groups, rename, add/remove members, leave, transfer admin when owner leaves; up to 50 members                       |
| Message tools | Reply, edit your text messages, delete your messages for everyone, star/unstar, emoji insertion                            |
| History       | Cursor pagination, search within a conversation, personal starred list, text export                                        |
| Files         | Images, video, audio, PDF, ZIP, and text files; authenticated downloads; default 20 MB limit                               |
| Voice notes   | Record from microphone, stop/cancel, preview attachment, send; two-minute recording limit                                  |
| Updates       | Text/image statuses, color selection, 24-hour expiry, view counts, owner deletion                                          |
| Calls         | One-to-one WebRTC audio/video, incoming dialog, accept/decline/end, mute, camera toggle, call history                      |
| Preferences   | Pin/archive/mute conversations, light/dark/system theme, opt-in desktop notifications                                      |
| Blocking      | Blocks direct messages, direct calls, and status sharing; shared group messages remain visible                             |
| Layout        | Mobile chat/status/call tabs, desktop rail and split view, responsive dialogs                                              |

Group receipts turn delivered/read when **all other current group members** reach the corresponding message cursor. Presence means an authenticated socket is connected. Receipts are application-level states, not proof that a person understood a message.

## Development commands

```bash
npm run dev       # Vite on http://localhost:5173 plus the Node backend
npm run build     # Compile React to dist/
npm start         # Serve the API, sockets, and compiled React on port 3001
npm run seed      # Add local demo users and sample conversations once
npm test          # Real HTTP/Socket.IO/SQLite integration tests
npm run test:ui   # React interaction tests in JSDOM
npm run check     # API tests, UI tests, and production build
npm run format   # Format source and documentation
```

`dist/` is included in the ZIP. It can be served by this backend after `npm ci --omit=dev`. A static host alone cannot provide the database, sessions, files, or real-time server.

## Configuration

Copy `.env.example` to `.env` if using a manual installation. Setup does this automatically and does not overwrite an existing `.env`.

| Variable           | Default                 | Purpose                                                                       |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------- |
| `HOST`             | `127.0.0.1`             | Bind address; `0.0.0.0` enables LAN access                                    |
| `PORT`             | `3001`                  | Backend and production UI port                                                |
| `DATA_DIR`         | `./data`                | Persistent SQLite database and uploads                                        |
| `APP_ORIGIN`       | `http://localhost:3001` | Additional allowed browser origin; comma-separated if necessary               |
| `COOKIE_SECURE`    | `false`                 | Set `true` when serving the app over HTTPS                                    |
| `TRUST_PROXY`      | `0`                     | Set `1` only behind one trusted reverse proxy                                 |
| `MAX_UPLOAD_MB`    | `20`                    | Server upload limit, maximum 100 MB; current UI caps chat selections at 20 MB |
| `ICE_SERVERS_JSON` | Public STUN server      | Optional STUN/TURN configuration for WebRTC                                   |

Changing `PORT` also requires updating `APP_ORIGIN` for the URL you use. Restart the server after changing configuration. Production and development URLs are intentionally different; use only one at a time during a two-user demo.

## Voice/video requirements

Use **localhost or HTTPS** and allow the microphone/camera in the browser. Both users must be signed in and online to start a call. Choose another person's direct chat and press the phone or camera button. Voice recording similarly requires microphone permission.

The media connection uses WebRTC. A public STUN server is configured for address discovery; it is not a media relay. Some NATs, mobile networks, VPNs, or firewalls require a TURN relay. See `docs/DEPLOYMENT.md`. Calls are one-to-one; group calling and closed-app push notifications are outside this version. Avoid feedback when testing on the same computer by using headphones.

## Scope and privacy

This is an independent learning/portfolio application, not the official WhatsApp client. It does not connect to WhatsApp accounts, contact lists, or servers. Authentication uses email/password, with no email verification, SMS OTP, password-recovery email, or paid messaging service. Registration emails are account identifiers in this version.

Chat content is stored on this application's server. **WhatsApp's end-to-end encryption protocol is not implemented.** HTTPS protects traffic when configured. The reference's OTP and encryption claims are deliberately replaced with functionality that this app actually implements.

The backend checks membership for chat history, attachments, message operations, and call signaling. Passwords use salted scrypt hashes; stored session tokens are SHA-256 hashes. Mutations require a same-origin request verification header. Uploaded SVG/HTML files are not served as executable documents. This is a single-server application with filesystem uploads and SQLite, not a horizontally scaled or independently security-audited messaging service.

## Data and backup

Runtime files are generated under `data/`, which is excluded from the ZIP and Git:

- `chat.sqlite`: accounts, sessions, groups, messages, preferences, status records, and calls.
- `chat.sqlite-wal` / `chat.sqlite-shm`: SQLite's write-ahead-log files while running.
- `uploads/`: stored files and profile photos.

Stop the app before copying the entire `data/` directory to a secure backup. Restore it with the server stopped. Do not delete this directory for routine package-install problems. Message deletion removes it from chat views, and deleted file messages cannot be downloaded by other members; the original owner's file and stored bytes remain until a deliberate retention cleanup. Expired statuses disappear from the app; their image bytes are not automatically erased. Storage encryption, quotas, automated retention, and account erasure require further operational work for a public service.

## Troubleshooting

| Symptom                                      | Fix                                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` is not recognized                     | Install Node.js 24 LTS and reopen the terminal.                                                                                                                                    |
| Unsupported `node:sqlite`                    | Use Node.js 24.x, not Node 18/20. No external database installation is needed.                                                                                                     |
| PowerShell says `npm.ps1` cannot run         | Use the included `.bat` scripts or `npm.cmd`; no execution-policy change is required.                                                                                              |
| `vite` or package not found                  | Run setup in the extracted project folder. Do not copy another machine's `node_modules`.                                                                                           |
| Rollup platform error on Windows             | The ZIP omits `node_modules`. Run `npm ci` locally; the lockfile includes platform-specific optional packages.                                                                     |
| `npm` download timeout                       | Restore your network/proxy access and rerun setup. Existing chat data is preserved.                                                                                                |
| Sign-in fails for demo user                  | Run `npm run seed`. Demo password is case-sensitive: `DemoChat@123`.                                                                                                               |
| Nothing replies automatically                | Demo accounts are real app users. Sign in with another account in a separate browser profile.                                                                                      |
| Blank page from opening `index.html`         | Use `npm start` and open the HTTP URL, not a file URL.                                                                                                                             |
| Port 3001 is busy                            | Stop the other process, or change `PORT` and `APP_ORIGIN` in `.env`.                                                                                                               |
| “This origin is not allowed”                 | Add the exact scheme/host/port used by your browser to `APP_ORIGIN`; restart.                                                                                                      |
| Camera opens then stops                      | Check permissions, another app using the device, HTTPS/localhost, network ICE/TURN settings, and whether the peer ended the call. Call termination releases hardware deliberately. |
| Can see the app on a phone but cannot record | Plain HTTP LAN addresses are not secure browser contexts. Use HTTPS.                                                                                                               |
| No desktop notifications                     | Enable them in Settings, allow them in browser permissions, and keep the app open in a background tab.                                                                             |
| Files vanish after deployment                | Mount a persistent data directory; an ephemeral filesystem does not preserve uploads.                                                                                              |

Implementation and validation details are in `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, and `docs/TESTING.md`.
