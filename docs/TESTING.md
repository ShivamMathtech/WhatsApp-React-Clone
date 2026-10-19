# Verification and manual acceptance

## Release verification — 19 October 2026

- `npm test`: 17 reported tests passed, 0 failed.
- `npm run test:ui`: 9 tests passed, 0 failed, using Vitest 5.0.5.
- `npm run build`: passed; compiled assets included.
- `npm audit`: 0 known advisories reported for the installed lockfile at verification time. This is not a security guarantee.

## Automated checks included

Run:

```bash
npm run check
```

The HTTP integration suite starts the actual Express/Socket.IO application on a random loopback port with a temporary SQLite database. It uses real HTTP requests and multiple authenticated Socket.IO clients, then removes its temporary data. It does not touch your normal `data/` directory.

The React tests use JSDOM and mocked API/socket boundaries. They verify component interactions, request payloads, error recovery, and app composition. They do not measure visual layout or establish real WebRTC media connections.

### Backend coverage

- Registration, duplicate accounts, bad credentials, cookie flags, session validation, scrypt storage.
- Origin checks and request-verification header.
- Contact lookup, direct chat deduplication, membership-protected history.
- Socket authentication, live message delivery, idempotent message retries.
- Typing authorization, unread counts, delivery/read cursors.
- Replies, message search/edit, private starring, cross-user mutation denial.
- Multipart upload, protected downloads, image signature checks, avatar upload, deletion visibility.
- Group owner permissions, member addition/removal, socket-room revocation.
- Per-user pin/archive/mute preferences and profile persistence.
- Contact-only statuses, unique views, expiry, owner deletion, and blocking.
- Call start/accept/offer forwarding/end, signaling authorization, persistent call history.
- Calling-tab disconnect while another account tab remains online.
- Multi-page message history and owner-leave transfer.
- Password change revoking other sessions and logout revoking sockets.
- Full server restart with preserved messages, profile, preferences, attachment, and session.
- Repeatable demo seeding without duplicate data.

### React coverage

- Sign-in flow, demo credentials, app shell, and opening a conversation.
- Sending text and clearing drafts only after server acknowledgement.
- Failed-send recovery with a stable idempotency UUID.
- Reply selection, starring, emoji insertion, and call-button intent.
- Group creation with selected registered users.
- Attachment upload before message submission.
- Profile changes and theme selection.
- Publishing text statuses.
- Microphone permission failure without a false “connected” state.

## Verification limits

Automated checks were run under Node.js 24 on Linux. Native Windows `.bat` execution, Docker runtime, real browser visual layout, physical microphones/cameras, actual WebRTC media, and deployed cross-network TURN behavior were not verified in this environment. These are not represented as passed tests. The client production build is included in `dist/`.

## A short two-user manual check

1. Run setup and start; sign in as Shivam in a normal browser window.
2. Sign in as Mahnoor in an Incognito/InPrivate window or a second browser.
3. Open the same direct conversation in both windows. Send text in both directions; verify it survives a refresh.
4. Leave one user viewing the list. Send another message; check the unread badge. Open the conversation and check blue receipts.
5. Send an image, PDF/text document, and a voice recording. Open/download them from the other account.
6. Reply, star, edit one of your own text messages, and delete one. Check the other window reflects changes.
7. Create a group. Add and remove a participant; verify the removed user loses access. Leave as admin and check admin transfer.
8. Post a status; open it from the other account and check the owner's view count. Delete it.
9. Start an audio and a video call. Accept, mute, disable/enable camera, and hang up. Verify the device indicator turns off.
10. Change the theme and profile, reload, archive/unarchive, and export a conversation.
11. Narrow the browser to 360 px and 390 px, then test tablet and desktop widths. Verify mobile new-chat action, back navigation, scrolling, dialogs, and keyboard focus.
12. Stop and restart the server; verify messages and uploads are still present.

Use HTTPS or localhost for microphone and camera checks. If devices cannot connect from different networks, configure TURN before interpreting a connection failure as an application failure.
