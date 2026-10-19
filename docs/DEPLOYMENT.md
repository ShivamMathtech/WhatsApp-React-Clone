# Deployment and network configuration

## Local demo

Use the supplied setup and start scripts. The default bind address is loopback; the default URL is `http://localhost:3001`. Chat, uploads, accounts, and status updates work without external services after dependencies are installed. WebRTC may contact the configured STUN/TURN service.

## Docker

Install Docker with Compose, then run from the project folder:

```bash
docker compose up --build -d
```

Visit `http://localhost:3001` and register an account. Docker does **not** automatically seed public demo passwords. For an intentional local demo:

```bash
docker compose exec app npm run seed
```

Logs and stop:

```bash
docker compose logs -f app
docker compose down
```

The `chat-data` named volume survives `docker compose down`. Do not add `-v` unless you intentionally want to erase the data volume. The runner uses the unprivileged `node` user and a health check. The Docker configuration was supplied as source; container execution was not verified in this build environment.

## A public Node server

Deploy the **whole app** to a server that supports a long-running Node 24 process, Socket.IO/WebSocket connections, and a persistent writable disk. A static React deployment alone is insufficient. Run one instance for this SQLite/filesystem version.

1. Upload the source and lockfile.
2. Run `npm ci`, then `npm run build`.
3. Set `DATA_DIR` to a persistent disk directory writable by the app user.
4. Set `APP_ORIGIN` to the exact HTTPS origin, `COOKIE_SECURE=true`, and `HOST=127.0.0.1` when using a local reverse proxy.
5. Run `npm start` under a service manager.
6. Forward HTTP and WebSocket connections through an HTTPS reverse proxy.
7. Create real accounts. Do not run the demo seed against a public production database.

No `.env` secrets, runtime database, or uploaded user files are included in the downloadable ZIP. Back up the persistent directory with the service stopped before upgrading. Database creation is automatic; future schema changes will require explicit versioned migration work.

### Example reverse-proxy fragment

This Nginx fragment belongs inside an already configured HTTPS virtual host with your own domain and valid certificate:

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 90s;
    client_max_body_size 21m;
}
```

Use `TRUST_PROXY=1` only with one trusted proxy in front of the app, and prevent direct untrusted access to its backend port. Certificates and domain configuration are deployment-specific and are not supplied here.

## Two computers on the same LAN

For a temporary chat-only LAN demo, set:

```dotenv
HOST=0.0.0.0
PORT=3001
APP_ORIGIN=http://192.168.1.50:3001
COOKIE_SECURE=false
```

Replace `192.168.1.50` with the server computer's actual LAN IP and permit inbound TCP 3001 only on the intended private network. Both devices use the same URL. **Plain HTTP on a LAN IP usually cannot access camera/microphone APIs.** For voice notes and calls, place the app behind trusted HTTPS. Do not disable browser security as a workaround.

## TURN for calls over the internet

Default ICE configuration uses `stun:stun.l.google.com:19302`. STUN alone does not guarantee that two browsers can exchange media. Configure a TURN relay when users sit behind restrictive networks:

```dotenv
ICE_SERVERS_JSON=[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:YOUR_TURN_HOST:3478?transport=udp","turns:YOUR_TURN_HOST:5349?transport=tcp"],"username":"YOUR_TURN_USERNAME","credential":"YOUR_TURN_PASSWORD"}]
```

These are placeholders. Supply credentials from your own TURN service and restart the app. ICE configuration is intentionally delivered to authenticated browsers, so credentials provided here are visible to users. For a public service, replace static shared credentials with a server endpoint that issues short-lived TURN credentials. Set TURN quotas and firewall ports appropriate to your service.

Both participants must grant media permission and stay connected. Test calls on two separate devices with headphones. The release validates authenticated signaling; actual audio/video transport must be tested in your deployment and browser combination.

## Before operating this as a public service

This release is intended for a local, educational, or portfolio demonstration. A public service needs decisions and engineering for verified identities, abuse reporting/moderation, account recovery and erasure, upload scanning and quotas, storage retention, private operational logs, backups, dependency updates, service monitoring, and scalable persistence. Message end-to-end encryption requires a complete protocol and key-management design; it cannot be added by simply turning on HTTPS.
