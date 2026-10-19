# Publishing projector helper releases

The API can advertise signed helper releases from an operator-provisioned local catalog.
The default paths are empty: no installers or update metadata are offered. Enabling the
institution policy does not create a package, signing identity or supported OS matrix.

## Configuration

Set two separate, read-only file mounts/environment variables for the core process:

```text
PROJECTOR_RELEASE_TRUST_PATH=/etc/lecturer/projector/release-trust.json
PROJECTOR_RELEASE_CATALOG_PATH=/etc/lecturer/projector/release-catalog.json
```

Start with [empty trust](projector-releases/trust.example.json) and
[empty catalog](projector-releases/catalog.example.json). Their schemas are
[trust.schema.json](projector-releases/trust.schema.json),
[catalog.schema.json](projector-releases/catalog.schema.json) and
[manifest.schema.json](projector-releases/manifest.schema.json). An empty trust intentionally
disables offers. The paths are server configuration, never a URL supplied by a staff client.

Provision trust separately from release metadata:

```json
{
  "repository": "YOUR_ORGANIZATION/YOUR_AGENT_REPOSITORY",
  "keys": {"release-v1": "BASE64_OF_DER_SPKI_P256_PUBLIC_KEY"}
}
```

These placeholders are explanatory, not usable keys or assets. Keep the signing private
key outside the web application, its database and this repository. Embed the same public
trust and pinned GitHub repository in the native build. Changing only server trust does
not rotate a key embedded in an already installed helper.

## Signed envelopes and artifact types

Each catalog entry is `{keyId,payload,signature}`. Sign the **exact UTF-8 JSON bytes** of
the manifest with ECDSA P-256/SHA-256, IEEE-P1363 encoding (`r || s`, 64 bytes), then base64
encode both payload and signature. Do not reserialize signed bytes or use ASN.1 DER for
the signature. The manifest contains:

```json
{
  "sequence": 1,
  "version": "0.2.0",
  "platform": "MACOS_ARM64",
  "artifactType": "UPDATE",
  "minimumOsVersion": "14.0",
  "protocolVersion": 1,
  "publishedAt": "REPLACE_WITH_UTC_INSTANT",
  "expiresAt": "REPLACE_WITH_LATER_UTC_INSTANT",
  "url": "https://github.com/YOUR_ORGANIZATION/YOUR_AGENT_REPOSITORY/releases/download/v0.2.0/YOUR_ASSET.zip",
  "size": 1,
  "sha256": "REPLACE_WITH_64_HEX_DIGEST_OF_ACTUAL_ASSET",
  "entryPoint": "app/Projector.Agent"
}
```

The example cannot be published as-is. Use the actual asset's byte count and SHA-256,
and the package entry point required by the native release pipeline.

- `UPDATE` (default for older manifests): native immutable update package. Only this
  type can appear in `agent/poll.release`.
- `INSTALLER`: an explicit, tested OS installer. Only this type appears in settings
  `installers`; an update ZIP is never automatically presented as an installer.
- There is at most one current entry for each platform/artifact type. Each entry has its
  own monotonically increasing sequence. Re-signing fresh metadata requires a higher
  sequence, including when the binary version remains unchanged.
- Supported platform identifiers distinguish Windows/macOS and x64/arm64. The website
  lists explicit choices and minimum OS versions; it does not guess CPU architecture.

The server validates the signature and SPKI curve, exact pinned HTTPS GitHub release
path, protocol, bounded versions, positive sequence/size, SHA-256 syntax, safe relative
entry point, publication time and expiry. Maximum asset size is 512 MiB. Metadata is
valid for at most 14 days; publication may be at most five minutes ahead of server time.
URLs cannot contain credentials, query strings, fragments, encoded paths or a custom
port. Valid metadata authenticates a publisher's claims; it does not replace package
signing, malware review, OS compatibility tests or the physical HDMI release gates.

## Refresh, rollback protection and availability

Every five seconds the server reads at most 64 KiB of trust and 256 KiB of catalog, with
at most 16 entries/keys and duplicate JSON fields rejected. Use atomic file replacement
to publish a complete catalog. An unreadable/invalid entry withdraws all offers until the
next valid refresh; old metadata is never retained as a fallback. Expired cached entries
stop being served immediately, even between refreshes. Diagnostics log stable codes only.

Accepted high-water marks persist in `projection.release_checkpoints`, separately per
platform/artifact type. A lower sequence, lower binary version, or changed payload at an
already accepted sequence is rejected. Batch advancement is atomic; removing the file
or restarting the server does not clear those checkpoints. Do not delete checkpoints to
roll back a release. Publish a new increasing sequence/version through the managed
recovery flow instead. Native checkpoints independently enforce their own update rules.

Polling returns only a newer update compatible with the device's platform, reported
numeric OS version and institution minimum helper version. New clients report current
`osVersion` on every poll (for example Windows `10.0.26100` or macOS `15.0.0`), so an OS
upgrade does not require pairing again. Omitting/emptying that optional field preserves
legacy pairing metadata. This report is not attestation; native code checks the real OS
again before staging. Human-readable legacy OS strings receive no incompatible offer.

Policy prohibition disables projection and new pairing but preserves the authenticated
security update channel. Explicit device revocation invalidates that channel. An active
lesson can download/stage a verified update; activation waits until public output ends.
The native updater verifies assets, protects rollback, uses safe slots and confirms
health before accepting a replacement. Server metadata alone never executes an asset.

## Release gate

Publish offers only after installer/package signing, native embedded trust, notarization
where required, hosted assets, install/update/recovery checks and the actual OS/display
matrix have passed. Source/unit tests and Java-to-native signature compatibility do not
prove physical projector behavior. This repository currently ships empty example files
and empty native trust; operators must provision real releases explicitly.
