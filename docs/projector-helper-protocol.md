# Projector helper protocol v1

The website and MAX remain the application. The optional helper controls a separate public
output; it never receives staff tokens, questions, notes, drafts, or test answer keys.
There is one policy per deployment. The default is disabled. No installer assets are
advertised until signed, compatible packages actually exist.

## Staff API

- `GET /api/v1/projection/settings`: active ADMIN, LECTURER, ASSISTANT. Returns the
  institution policy and **only the caller's devices**. `connected` means an authenticated
  poll in the past 15 seconds, not proof of working HDMI.
- `PUT /api/v1/admin/projection/policy`: ADMIN only; body `agentAllowed`, `minimumVersion`
  (stable numeric `major.minor.patch`), `expectedRevision`. An outdated revision returns 409.
- `POST /api/v1/projection/pairings`: allowed active staff only. Returns `id`, a one-time
  `pairingCode`, `expiresAt` (5 minutes). A new code invalidates that user's previous code.
  Policy changes invalidate outstanding codes. Never put the code in a URL.
- `DELETE /api/v1/projection/devices/{id}`: owner only. Revokes the separate credential.
- `POST /api/v1/courses/{courseId}/sessions/{sessionId}/projection/commands`: manage permission
  in this course, matching session, device owner. Body `deviceId`, idempotent `requestId`,
  `type`, optional `targetScreenId`, `displayConfirmed`, `testCode`.

Commands are `TEST_TARGET`, `START_PUBLIC_PROJECTION`, `STOP_PROJECTION`, `CHECK_UPDATE`.
The first two need a live or paused session, recent device connection and supported version.
A start needs a successfully acknowledged test for the same device, session, target and
screen fingerprint, within 10 minutes; the caller must explicitly confirm and submit the
physical screen's code. Changes to the screen list invalidate the check. The helper must
also enforce target confirmation locally and refuse an unsafe display. Device screen
metadata and a caller's confirmation are not hardware attestation.

## Device API

`POST /api/v1/projection/agent/pair`, with body:

```json
{
  "pairingCode": "ABCDEFGH2345",
  "name": "Аудитория 12",
  "platform": "WINDOWS_X64",
  "version": "0.1.0",
  "osVersion": "10.0.26100",
  "protocolVersion": 1
}
```

Platforms: `WINDOWS_X64`, `WINDOWS_ARM64`, `MACOS_X64`, `MACOS_ARM64`. The response contains
`deviceId`, `deviceToken`, `protocolVersion`. The 256-bit opaque token is returned once.
Store it in the OS protected credential store. The server stores only SHA-256. Pairing is
atomic, one-time and rate limited. Supported platform metadata does not claim a tested OS matrix.

`POST /api/v1/projection/agent/poll`, `Authorization: Bearer <deviceToken>`:

```json
{
  "version": "0.1.0",
  "osVersion": "10.0.26100",
  "protocolVersion": 1,
  "status": "IDLE",
  "screens": [{"id":"hdmi-1","label":"Display","width":1920,"height":1080,"isPrimary":false}],
  "ack": {"commandId":"00000000-0000-4000-8000-000000000001","result":"COMPLETED"}
}
```

`ack` and numeric `osVersion` are optional for older clients. New helpers send their
actual OS version on every poll, so OS upgrades refresh update compatibility without
pairing again. Omitted/empty `osVersion` preserves existing metadata. This is not OS attestation.
Status: `IDLE`, `TESTING`, `SHOWING`, `PAUSED`, `ERROR`.
Ack result: `COMPLETED` or `FAILED`, optional bounded uppercase `diagnosticCode` (no raw
exception, user text, path or secret). Screens: at most 16, unique IDs, bounded labels/dimensions.

Response:

```json
{
  "protocolVersion": 1,
  "pollAfterMs": 3000,
  "leaseUntil": null,
  "mustStop": false,
  "policy": {"allowed": true,"minimumVersion":"0.1.0"},
  "updateRequired": false,
  "release": null,
  "commands": []
}
```

Commands contain `id`, `type`, `expiresAt`, `payload` with nullable `joinCode`,
`targetScreenId`, `testCode`, `projectionViewToken`. No command contains an arbitrary executable or URL.
Construct the public scene from a locally pinned, allowed installation origin plus
`/#/projection/{joinCode}?projectionViewToken={projectionViewToken}` for a start command.
The grant stays inside the URL fragment, never in a server URL query, logs or staff tokens.
Test scenes contain only the neutral code.

Delivery is at least once until acknowledgement or 60-second expiry. Execute IDs
idempotently. At most one command is delivered per poll; the next pending command waits
for acknowledgement or cancellation/expiry of the current one. Update checks and output
intentions have separate lanes. A new intention supersedes pending commands in its lane. Reject expired
commands and never restart a stopped display on delayed retry.

## Lease, revocation and updates

An active output has a 12-second lease, renewed on authenticated polls only while the
owner is an active staff account, still has course manage rights, the session remains
active and the display fingerprint matches. On loss, `mustStop: true`, null lease,
authentication failure or network timeout: **neutralize/close public material safely**.
Do not end the lecture or switch back to Duplicate automatically; native configuration
restoration requires the helper's topology checks and explicit safe local flow.

Disabling the policy cancels outstanding starts and revokes active leases, including
previously installed devices. It leaves the credential channel available for security
updates. Explicit device revocation returns 401 and requires pairing again. Permission
changes are rechecked at delivery and renewal, with a bounded lease rather than a promise
of zero network latency.

Raising `minimumVersion` prevents new test/show commands, but does not replace or restart
a process during an already running output. `updateRequired` signals the updater; stage
and verify updates during a lecture, install only afterwards. `CHECK_UPDATE` remains
deliverable when the use policy is disabled. Version claims are not binary attestation.
Without operator-provisioned trust/catalog the defaults remain `latestVersion: null`,
`installers: []`, `release: null`; a required unavailable update leaves the browser path
usable. See [release catalog configuration and schemas](projector-release-catalog.md).

`release`, when a trusted release exists, is a direct signed envelope
`{keyId, payload, signature}`, not a downloads `Installer`. `keyId` is at most 64
letters/digits/underscore/hyphen; payload is at most 32768 base64 characters encoding
the exact UTF-8 manifest bytes. The native embedded SPKI trust verifies the base64
64-byte ECDSA P-256/SHA-256 signature in IEEE-P1363 format before using the manifest.
Its fields are `sequence`, `version`, `platform`, `minimumOsVersion`, `protocolVersion`,
`publishedAt`, `expiresAt`, `url`, `size`, `sha256`, `entryPoint`, with optional
`artifactType` defaulting to `UPDATE`. `INSTALLER` is only advertised as an explicit
download and never delivered to the automatic updater. The signed asset URL
must remain under the native helper's pinned GitHub release repository. The downloads
catalog is a separate DTO. There is no arbitrary manifest URL supplied by a staff client.

The helper's signed release updater is independently responsible for trusted signatures,
hashes, freshness/rollback protection, OS/architecture compatibility, safe replacement,
health confirmation and managed deployment. This API does not turn an unsigned artifact
into an approved release or accept URLs supplied by a staff client.

## Native public media receiver

The native WebView is a separate browser process, so it cannot receive the management
browser's BroadcastChannel video preview. A start command therefore carries a separate
256-bit `projectionViewToken` scoped only to public media signalling. The server stores
its hash and an absolute expiry of at most 8 hours from the command's creation. Tokens
are derived with an independent random process key, so repeated delivery of the same
command within this server process has the same payload; restarting the server can
rotate an unacknowledged command's token and signalling rooms are already ephemeral.

The public page sends the token as `X-Projection-View-Token` to:

- `GET /api/v1/projection/agent/view/sessions/{joinCode}/screen-share/viewers/{viewerId}`:
  same `ShareViewer` response as a student receiver, or 204 before capture starts.
- `PUT` on that path plus `/{shareId}`: a bounded `ShareDescription` answer only.

Every read/answer checks the exact active START command, device, session, nonexpired
device lease, helper policy and current owner's account/course management rights.
Another session, a device token or staff JWT cannot substitute for this grant. A stopped
or replaced output, lost lease, revoked device, institution prohibition, revoked owner
rights or expiry denies the next read/answer; the receiver must close its peer/video.
An authenticated transition from SHOWING/TESTING/PAUSED to IDLE also clears the output
lease and media grant, so a local tray Stop cannot leave a receiver authorized. This
does not cancel a later, distinct pending user command or the initial idle poll before
the first test is delivered.
The token cannot start a broadcast, control a lesson or read private questions/notes.
A grant can be issued before capture starts and receives only a later public stream.

## Helper controls on the website

The setup page polls actual device state, requires explicit target choice, sends TEST,
accepts the code read on the physical output plus a clear confirmation, then sends START.
Command acceptance is distinct from the helper's reported TESTING/SHOWING state. Failure
preserves code/draft for review. STOP does not end the lecture. CHECK_UPDATE remains
available for a connected component even when use is forbidden. Revoked/offline/version
states are explicit, and missing signed installers never become a fake install button.
Admin policy drafts retain their original revision; background polling cannot silently
overwrite another administrator's change.

## HTTPS preview fallback

WebRTC remains the preferred video path. A cross-network receiver without a reachable
peer path may use an optional low-frame-rate JPEG preview over the existing HTTPS origin.
This is not full-motion video, audio transport or an SFU.

- Staff owner: `PUT /api/v1/courses/{courseId}/sessions/{sessionId}/screen-share/{shareId}/frame`,
  raw `Content-Type: image/jpeg`. At most 256 KiB and 960 × 540, at most two accepted
  frames per second. Read is bounded at 256 KiB + 1 even without honest Content-Length;
  metadata dimensions are checked without allocating a raster or caching input on disk.
- Current student receiver: GET its existing viewer path plus `/frame`, using the current
  participant receipt/account. The viewer must already be registered by signalling.
- Native receiver: GET its scoped projection viewer path plus `/frame`, using
  `X-Projection-View-Token`; device/policy/owner/session/output lease checks still apply.
- Send `Accept: image/jpeg` (or `*/*`), not the generic JSON API default. A 200 response
  is `image/jpeg`, `Cache-Control: no-store`, `nosniff`. A 204 means clear the previously
  displayed frame: no current frame, pause, 4-second frame TTL or an ended room.
- Upload errors: 400 invalid JPEG/dimensions, 413 compressed size, 415 MIME, 429 faster
  than 500 ms, 409 paused. A rate-limit response can be skipped until the next interval.
  A forbidden/expired receiver must close its image/peer, rather than retaining stale video.

Only the latest JPEG is held in each in-memory room (64 rooms × 256 KiB = at most 16 MiB
of stored preview frames). No frame history, files, database rows or frame-body logging.
Pause, stop and room lease expiry discard the frame; resume waits for a new upload.
Frame downloads do not join/rejoin a session or renew a viewer/host lease. Continue the
existing signalling heartbeat; kicked, banned, disabled or unrelated people cannot read
an old registered viewer's frame. The same current host authorization applies to both
video signalling and HTTPS previews.
