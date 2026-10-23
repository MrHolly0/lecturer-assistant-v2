# Read models and request admission

## Student snapshots

A student snapshot is assembled in two parts:

- Shared lecture state: current slide, public poll, comprehension totals and question answers.
- A fresh viewer overlay: current permission, participation/kick state, personal questions and own response.

The shared cache is never an authorization decision. `allowedParticipants` and the viewer overlay
are read every time, including periodic SSE batches. Private question answers are filtered by author
for each viewer; they are not copied into the public snapshot. Immediate answer fanout checks the
current allowed accounts/course members and active participation in one batch. Kicked/left viewers
are excluded. A private answer rechecks its single author at send time; an application kick clears
queued events and detaches that participant's streams after commit. A write already in progress
cannot be withdrawn from the network.

The slide path loads only the requested slide and its count, without teacher notes or all other
slides. Raw slide text is cached under the deck's database `read_revision`. Every slide insert,
update and delete updates that revision in the same transaction. Signed image URLs are generated
on each read, so a cached entry cannot retain an expired token.

Shared snapshot reuse checks fresh session metadata, course title, current slide and a database
revision. The latter has 16 lanes per session to distribute independent writers. Database triggers
cover feedback, questions, polls, poll responses and participation, including writes made by another
server instance. Session title/status/groups/annotations and finalized durations are read directly.
Changes to teacher notes do not invalidate student data because those notes are absent from it.

Both caches are bounded: raw slides have at most 1,024 entries / 16 MiB estimated payload; shared
snapshots have at most 512 entries / 32 MiB estimated payload. Cache locks protect map operations
only. Database reads occur outside those locks. Active write transactions bypass the caches to
prevent uncommitted or rolled-back data from being retained. A build is saved under the revision
read **before** building; a concurrent commit therefore invalidates it on the next read.

The revision tables are derived coordination state, not an event store. Source tables remain the
authority. Application writes preserve session/deck identifiers. Administrative bulk data repair
must invalidate/rebuild affected derived rows; it should not bypass triggers using `TRUNCATE` or
`DISABLE TRIGGER` while serving traffic.

## Finalized lecture summaries

`analytics.lecture_summaries` stores the actor-independent result for an ended or archived lecture.
The manager permission and account state are checked before reading it. Participant and question
names are historical snapshots, not joins to current account names. Group breakdowns use lecture
participation snapshots, not current study-group membership.

The fingerprint includes the shared database revision, session version, lecture identity/title,
historical groups, status, finalized times and active duration. The format has an explicit schema
version. A missing, outdated or unreadable row is rebuilt from source tables on demand. A PostgreSQL
transaction advisory lock admits one builder per session across server instances; another builder
receives HTTP 503 with `Retry-After: 2`. Payloads over 8 MiB are returned accurately but not persisted.
A cache hit still records the existing `summary.opened` audit/product event; this is one write per
summary request, independent of aggregate calculation.

Private operator rebuild:

```text
DELETE /internal/v1/operations/lecture-summaries/{sessionId}
X-Internal-Api-Key: <internal API key>
```

This deletes only the derived row. The next authorized summary read rebuilds it. It does not modify
lecture data. Keep `/internal/` private at the proxy. Rolling back application code does not require
removing these additive tables/columns; old code continues writing source tables and their triggers.

This is read/command separation inside the existing PostgreSQL-backed application. It does not
introduce asynchronous projections, a message broker or event sourcing.

## Admission and observability

Rate buckets use constant memory per key, have an idle lifetime, and reject new keys when their
bounded key budget is full instead of evicting live quotas. Authenticated users and **validated** opaque student/projection credentials have separate budgets,
so one campus address does not merge their allowances. A credential must resolve to an existing
person/device before it can allocate a personal quota key. Invalid arbitrary headers remain in
the anonymous socket-peer bucket and cannot fill personal quota maps. Positive credential lookups
have a separate 10,000-entry / 15-second digest cache; invalid values are never cached. Lookup ingress
and parallel database lookups are independently bounded (`API_CREDENTIAL_LOOKUPS_PER_MINUTE`, default
120,000; `API_CREDENTIAL_LOOKUP_CONCURRENT`, default 4). This cache affects accounting only: every
handler still performs its fresh authorization check. The opaque token is never retained. Anonymous traffic has a broad socket-peer fallback budget;
forwarded headers cannot reset authentication limits. Headers alone never grant participation.
Browser slide images have a separate ingress allowance (`API_IMAGE_REQUESTS_PER_MINUTE`, default
120,000 per minute), because `<img>` requests cannot carry participant headers. They still require
a valid signed URL or normal visibility authorization and consume global request admission. Image
loads do not consume the anonymous command allowance. Concurrent application requests and expensive
analytics have separate admission limits. SSE releases
request admission when MVC detaches it and uses separate total/session/viewer stream bounds.
Responses include a minimum `Retry-After` where the server can calculate it.

Projection signalling uses per-room locks; account/course/session database checks happen outside
those locks. Room/viewer, JPEG and video budgets remain bounded and configurable. Saturation rejects
new work without replacing an existing show. Signalling, media buffers and Spring's simple broker
remain process-local: adding replicas still requires routing/event distribution appropriate to those
components. Increasing a numeric room limit alone does not establish capacity for more streams.

Private operator metrics:

```text
GET /internal/v1/operations/metrics
X-Internal-Api-Key: <internal API key>
```

The response is scoped to the current process. It exports an allowlist of numeric measurements and
safe tags, including cache hit/miss/build time, SSE queues/slow consumers, admission rejections,
projection buffer sizes, JVM and Hikari utilization. It never exports a registry-wide dump, raw
credentials or person/course/session tags. Actuator's public exposure remains health/info.
