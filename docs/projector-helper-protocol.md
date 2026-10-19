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
  raw `Content-Type: image/jpeg`. At most 256 KiB and 1920 × 1080, at most two accepted
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

## Encoded H264 video over HTTPS

An authenticated publisher may send a single-video-track fragmented MP4 stream over
the same HTTPS origin. This transports actual encoded video, with an initialization
and independently decodable fragments; JPEG previews remain a separate optional path.
It does not require an additional public UDP port. The browser receiver uses a real
video decoder, MSE/MMS where supported, and the available fullscreen/PiP APIs. Device
and MAX compatibility still requires physical playback tests.

Publisher endpoints below the existing staff `screen-share/{shareId}` path:

- `PUT /video/{epoch}/init?codec=avc1.XXXXXX`: `Content-Type: video/mp4`, at most
  128 KiB, exactly bounded `ftyp` plus `moov`. One H264 `avc1` video track, no audio.
  The server derives the exact codec from `avcC`; encoders may add compatibility
  constraint flags to the requested profile. Profile/level must match the request.
- `PUT /video/{epoch}/segments/{sequence}`: `video/mp4`, at most 2 MiB, bounded
  `moof` plus `mdat` with a valid fragment/sample-table structure. The publisher must
  start each fragment at a keyframe. The server checks framing without decoding media;
  framing validation is not proof that every encoded sample can play on every device.
- Epoch is a UUID; sequence starts at zero and must be contiguous. Retained identical
  retries are idempotent; changed retries and gaps return 409. An expired/pruned retry
  returns 410. Use a new UUID on replacement, reconnection or resume after pause.
  Retired UUIDs cannot be reused within the same share; the bounded epoch limit requires
  starting a new share after too many replacements.

Both student and native receiver paths support these suffixes below their existing
`screen-share/viewers/{viewerId}` path, with their current participant/output grant:

- `GET /video`: `{shareId,epoch,codec,firstSequence,lastSequence}`, or 204 until an
  initialization and at least one unexpired fragment are available. A late receiver
  starts from a retained keyframe rather than expecting the beginning of the lecture.
- `GET /video/{epoch}/init` and `GET /video/{epoch}/segments/{sequence}`: `video/mp4`,
  `Cache-Control: no-store`, `nosniff`. Send `Accept: video/mp4` for these binary requests.
  A stale epoch or missing/pruned fragment returns 410; refresh metadata and discard
  the old decode buffer. Metadata 204 means no currently playable ring, pause or stop.

Register a viewer through the existing signalling GET first. Every video read rechecks
current participation or the device grant and the exact registered viewer identity.
Reads refresh only that existing viewer's activity for playback; they never join/rejoin
a participant or extend the publisher lease. The current publisher, owner course rights,
device policy/grant and host lease remain authoritative.

The RAM ring retains at most six fragments, at most 8 MiB of initialization/fragment
payloads per room and 64 MiB across rooms. Each fragment expires after six seconds;
storage is pruned independently of incoming media requests. Budget exhaustion returns
429 and cannot grow an unbounded queue. These limits describe stored payloads, not total
process memory including concurrent HTTP buffers and video decoder memory on clients.
There are no media files, database blobs, frame history or payload logs.

A committed pause or terminal session transition invalidates buffered JPEG/video
immediately on this server instance, even when no media poll observed the paused state.
Resume requires a fresh epoch. Stop, host lease expiry and permission revocation deny
future reads. A receiver must clear already downloaded/decoded media when access or
playback state changes; data already delivered cannot be recalled from a client.
