using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lecturer.Projector;

if (args.Length > 0 && args[0] == "--verify-fixture")
{
    if (args.Length != 3) throw new InvalidDataException("EXPECTED_ENVELOPE_AND_PUBLIC_TRUST_FIXTURE");
    var fixtureTrust = JsonSerializer.Deserialize<UpdateTrust>(File.ReadAllBytes(args[2]), Wire.Json) ?? throw new InvalidDataException("BAD_FIXTURE_TRUST");
    var fixture = ReleaseVerifier.Verify(File.ReadAllBytes(args[1]), fixtureTrust, "MACOS_ARM64", new Version(14, 0), "0.1.0", new(0, "0.1.0"), DateTimeOffset.UtcNow);
    Console.WriteLine("PASS Java P-256/P1363 exact-payload fixture verified by C#; version=" + fixture.Version + "; artifactType=" + fixture.ArtifactType);
    return;
}
var passed = 0;
void Check(string name, Action body) { body(); Console.WriteLine("PASS " + name); passed++; }
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"Expected {expected}, got {actual}"); }
void Reject(Action body, string code) { try { body(); } catch (InvalidDataException ex) { Equal(code, ex.Message); return; } throw new Exception("Expected rejection " + code); }
var now = DateTimeOffset.Parse("2026-10-19T10:00:00Z");
var origin = PublicScene.ValidateOrigin("https://lecturer.example/");
Check("public scene origin and route stay isolated", () => {
    Equal(true, PublicScene.Allowed(origin, PublicScene.Build(origin, "8TUFA3")));
    Equal(true, PublicScene.Allowed(origin, PublicScene.Build(origin, "8TUFA3", new string('a', 64))));
    Equal(false, PublicScene.Allowed(origin, new Uri("https://lecturer.example/#/projection/ABC123?staffToken=secret")));
    Reject(() => PublicScene.Build(origin, "ABC123", "bad"), "INVALID_PROJECTION_VIEW_TOKEN");
    foreach (var path in new[] { "https://lecturer.example/#/courses", "https://evil.example/#/projection/ABC123", "https://lecturer.example/?secret=x#/projection/ABC123", "https://lecturer.example/#/projection/ABC123/extra", "https://lecturer.example/#/projection/ABC123%3fstaff" })
        Equal(false, PublicScene.Allowed(origin, new Uri(path)));
    Reject(() => PublicScene.ValidateOrigin("http://lecturer.example/"), "ORIGIN_MUST_BE_HTTPS_ORIGIN");
    Reject(() => PublicScene.Build(origin, "../staff"), "INVALID_JOIN_CODE");
});
Check("lecture workspace URLs carry only a valid scoped grant and stay separate from public routes", () => {
    var course = Guid.Parse("10000000-0000-4000-8000-000000000001");
    var session = Guid.Parse("10000000-0000-4000-8000-000000000002");
    var token = "10000000-0000-4000-8000-000000000003." + new string('a', 64);
    var remote = LectureWorkspace.Build(origin, course, session, token);
    Equal(true, LectureWorkspace.Allowed(origin, remote)); Equal(false, PublicScene.Allowed(origin, remote));
    Equal(false, LectureWorkspace.Allowed(origin, PublicScene.Build(origin, "ABC123")));
    foreach (var invalid in new[] {
        new Uri("https://evil.example/" + remote.Fragment),
        new Uri(origin, "/wrong" + remote.Fragment), new Uri(origin, "?staff=secret" + remote.Fragment),
        new Uri(origin, remote.Fragment + "&staffToken=secret"), new Uri(origin, remote.Fragment + "&controlToken=" + token),
        new Uri(origin, remote.Fragment.Replace(session.ToString(), Guid.Empty.ToString(), StringComparison.Ordinal)),
        new Uri(origin, remote.Fragment[..^1] + "g") }) Equal(false, LectureWorkspace.Allowed(origin, invalid));
    Reject(() => LectureWorkspace.Build(origin, Guid.Empty, session, token), "INVALID_LECTURE_CONTROL_GRANT");
    Reject(() => LectureWorkspace.Build(origin, course, session, "staff-jwt"), "INVALID_LECTURE_CONTROL_GRANT");
});
var original = new DisplaySnapshot("original", ["laptop", "HDMI"], "opaque");
var applied = new DisplaySnapshot("applied", ["laptop", "HDMI"], "opaque");
Check("guarded restore preserves manual and hotplug changes", () => {
    Equal(RestoreDecision.ConfirmationRequired, DisplaySafety.CanRestore(original, applied, applied, false));
    Equal(RestoreDecision.Restore, DisplaySafety.CanRestore(original, applied, applied, true));
    Equal(RestoreDecision.UserChangedConfiguration, DisplaySafety.CanRestore(original, applied, applied with { Fingerprint = "user" }, true));
    Equal(RestoreDecision.HardwareChanged, DisplaySafety.CanRestore(original, applied, applied with { ConnectedIds = ["laptop"] }, true));
    Equal(RestoreDecision.Unchanged, DisplaySafety.CanRestore(original, applied, original, true));
});
Check("monotonic lease caps far-future deadline despite backwards wall clock", () => {
    var clock = new ControlledClock(now); var lease = new ActiveOutputLease(clock);
    lease.AuthenticatedPoll(now.AddYears(100));
    clock.UtcNow = now.AddYears(-20); clock.AdvanceMonotonic(TimeSpan.FromSeconds(11));
    Equal(false, lease.MustStop(true)); clock.AdvanceMonotonic(TimeSpan.FromSeconds(1));
    Equal(true, lease.MustStop(true)); Equal(false, lease.MustStop(false));
    lease.AuthenticatedPoll(now.AddYears(100)); clock.AdvanceMonotonic(TimeSpan.FromSeconds(12));
    Equal(true, lease.MustStop(true));
});
Check("lease respects shorter deadline and only authenticated renewal extends it", () => {
    var clock = new ControlledClock(now); var lease = new ActiveOutputLease(clock);
    lease.AuthenticatedPoll(now.AddSeconds(3)); clock.AdvanceMonotonic(TimeSpan.FromSeconds(3)); Equal(true, lease.MustStop(true));
    lease.AuthenticatedPoll(now.AddSeconds(12)); clock.AdvanceMonotonic(TimeSpan.FromSeconds(11)); Equal(false, lease.MustStop(true));
    lease.Clear(); Equal(true, lease.MustStop(true));
    lease.AuthenticatedPoll(null); Equal(true, lease.MustStop(true));
});
Check("Win32 active snapshot and candidate queries use distinct documented SDK flags", () => {
    Equal(0x00000002u, WindowsDisplayConfig.QueryFlags(DisplayConfigQueryPurpose.CurrentActiveLayout));
    Equal(0x00000001u, WindowsDisplayConfig.QueryFlags(DisplayConfigQueryPurpose.SupportedPathCandidates));
    Equal(0x00000060u, WindowsDisplayConfig.TemporarySetFlags(validate: true));
    Equal(0x000000a0u, WindowsDisplayConfig.TemporarySetFlags(validate: false));
    Equal(0u, WindowsDisplayConfig.TemporarySetFlags(false) & WindowsDisplayConfig.SDC_SAVE_TO_DATABASE);
    Equal(1u, WindowsDisplayConfig.DISPLAYCONFIG_PATH_ACTIVE); Equal(4u, WindowsDisplayConfig.DISPLAYCONFIG_PIXELFORMAT_32BPP);
});
Check("normal update waits until show stopped and health reconnect", () => {
    var life = new UpdateLifecycle { Showing = true }; life.DownloadVerified(); Equal("WAITING_FOR_STOP", life.State); Equal(false, life.RequestInstall());
    life.ShowStopped(); Equal(true, life.RequestInstall());
    try { life.Reconnected("0.2.0", "0.1.0"); throw new Exception("Accepted wrong health version"); } catch (InvalidOperationException) { }
    life.Reconnected("0.2.0", "0.2.0"); Equal("HEALTHY", life.State);
});
using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
var trust = new UpdateTrust("university/lecturer-assistant-v2", new() { ["release-2026"] = Convert.ToBase64String(key.ExportSubjectPublicKeyInfo()) });
var manifest = new ReleaseManifest(2, "0.2.0", "MACOS_ARM64", "14.0", 1, now.AddHours(-1), now.AddDays(2),
    "https://github.com/university/lecturer-assistant-v2/releases/download/projector-v0.2.0/mac-arm64.zip", 3, Convert.ToHexString(SHA256.HashData([1, 2, 3])), "ProjectorMac.app/Contents/MacOS/ProjectorMac");
byte[] Sign(ReleaseManifest value) {
    var payload = JsonSerializer.SerializeToUtf8Bytes(value, Wire.Json);
    return JsonSerializer.SerializeToUtf8Bytes(new SignedEnvelope("release-2026", Convert.ToBase64String(payload), Convert.ToBase64String(key.SignData(payload, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation))), Wire.Json);
}
ReleaseManifest Verify(byte[] data, UpdateCheckpoint? checkpoint = null) => ReleaseVerifier.Verify(data, trust, "MACOS_ARM64", new(14, 0), "0.1.0", checkpoint ?? new(0, "0.1.0"), now);
Check("signed release accepted with exact payload", () => Equal("0.2.0", Verify(Sign(manifest)).Version));
Check("tampered signature rejected", () => {
    var envelope = JsonSerializer.Deserialize<SignedEnvelope>(Sign(manifest), Wire.Json)!;
    var payload = JsonSerializer.SerializeToUtf8Bytes(manifest with { Version = "0.9.0" }, Wire.Json);
    Reject(() => Verify(JsonSerializer.SerializeToUtf8Bytes(envelope with { Payload = Convert.ToBase64String(payload) }, Wire.Json)), "BAD_MANIFEST_SIGNATURE");
});
Check("expiry, replay, platform, protocol, downgrade and asset origin denied", () => {
    Reject(() => Verify(Sign(manifest with { ExpiresAt = now.AddSeconds(-1) })), "STALE_METADATA");
    Reject(() => Verify(Sign(manifest), new(2, "0.2.0")), "REPLAYED_METADATA");
    Reject(() => Verify(Sign(manifest with { Platform = "WINDOWS_X64" })), "WRONG_PLATFORM");
    Reject(() => Verify(Sign(manifest with { ProtocolVersion = 2 })), "WRONG_PROTOCOL");
    Reject(() => Verify(Sign(manifest with { ArtifactType = "INSTALLER" })), "WRONG_ARTIFACT_TYPE");
    Reject(() => Verify(Sign(manifest with { Version = "0.0.9" })), "ROLLBACK_OR_NOT_NEWER");
    Reject(() => Verify(Sign(manifest with { Url = "https://github.com/attacker/repo/releases/download/tag/agent.zip" })), "UNTRUSTED_ASSET_ORIGIN");
    Reject(() => Verify(Sign(manifest with { MinimumOsVersion = "15.0" })), "OS_TOO_OLD");
    var embedded = EmbeddedTrust.Load();
    Equal("MrHolly0/lecturer-assistant-v2", embedded.Repository);
    Equal(true, embedded.Keys.Count > 0);
    var forged = JsonSerializer.Deserialize<SignedEnvelope>(Sign(manifest), Wire.Json)!;
    forged = forged with { KeyId = embedded.Keys.Keys.First() };
    Reject(() => ReleaseVerifier.Verify(JsonSerializer.SerializeToUtf8Bytes(forged, Wire.Json), embedded,
        "MACOS_ARM64", new(14, 0), "0.1.0", new(0, "0.1.0"), now), "BAD_MANIFEST_SIGNATURE");
});
Check("package size and digest before extraction", () => {
    using var correct = new MemoryStream([1,2,3]); ReleaseVerifier.VerifyPackage(correct, manifest);
    Reject(() => ReleaseVerifier.VerifyPackage(new MemoryStream([1,2]), manifest), "PACKAGE_SIZE_MISMATCH");
    Reject(() => ReleaseVerifier.VerifyPackage(new MemoryStream([1,2,4]), manifest), "PACKAGE_HASH_MISMATCH");
});
Check("actual decompressed bytes are bounded before writing and must match declared length", () => {
    using var output = new MemoryStream();
    Reject(() => UpdatePackage.CopyEntryBounded(new MemoryStream(new byte[10]), output, 3, 100), "ARCHIVE_ENTRY_SIZE_MISMATCH");
    Equal(0L, output.Length);
    Reject(() => UpdatePackage.CopyEntryBounded(new MemoryStream(new byte[10]), output, 10, 5), "ARCHIVE_TOO_LARGE");
    Equal(0L, output.Length);
    Reject(() => UpdatePackage.CopyEntryBounded(new MemoryStream(new byte[2]), output, 3, 100), "ARCHIVE_ENTRY_SIZE_MISMATCH");
});
Check("same signed metadata retries after transient network failure with bounded backoff", () => {
    var state = Path.Combine(Path.GetTempPath(), "projector-retry-" + Guid.NewGuid()); Directory.CreateDirectory(state);
    try {
        var clock = new ControlledClock(now); var attempts = 0;
        var services = new AgentUpdateServices(clock, () => trust, (_, path, _) => {
            attempts++; if (attempts == 1) return Task.FromException(new HttpRequestException("synthetic offline"));
            File.WriteAllBytes(path, [1, 2, 3]); return Task.CompletedTask;
        });
        var updates = new AgentUpdates("0.1.0", state, "MACOS_ARM64", new Version(14, 0), services);
        var envelope = JsonSerializer.Deserialize<JsonElement>(Sign(manifest), Wire.Json);
        updates.Observe(envelope); updates.CurrentAttempt.GetAwaiter().GetResult(); Equal(1, attempts);
        updates.Observe(envelope); updates.CurrentAttempt.GetAwaiter().GetResult(); Equal(1, attempts);
        clock.AdvanceMonotonic(TimeSpan.FromSeconds(31));
        updates.Observe(envelope); updates.CurrentAttempt.GetAwaiter().GetResult(); Equal(2, attempts);
        Equal<string?>(null, updates.DiagnosticCode); Equal(true, updates.IdleHandoff("IDLE", "0.1.0") is not null);
    } finally { Directory.Delete(state, true); }
});
Check("pre-checkpoint stage failure retries exact envelope and committed stage survives restart without reinstall loop", () => {
    var state = Path.Combine(Path.GetTempPath(), "projector-checkpoint-" + Guid.NewGuid()); Directory.CreateDirectory(state);
    try {
        var clock = new ControlledClock(now); var commits = 0; var downloads = 0;
        var services = new AgentUpdateServices(clock, () => trust, (_, path, _) => {
            downloads++; File.WriteAllBytes(path, [1, 2, 3]); return Task.CompletedTask;
        }, () => { commits++; if (commits == 1) throw new IOException("synthetic disk interruption"); });
        var envelope = JsonSerializer.Deserialize<JsonElement>(Sign(manifest), Wire.Json);
        var updates = new AgentUpdates("0.1.0", state, "MACOS_ARM64", new Version(14, 0), services);
        updates.Observe(envelope); updates.CurrentAttempt.GetAwaiter().GetResult();
        Equal(false, File.Exists(Path.Combine(state, "accepted-release.json"))); Equal(true, updates.IdleHandoff("IDLE", "0.1.0") is null);
        clock.AdvanceMonotonic(TimeSpan.FromSeconds(31)); updates.Observe(envelope); updates.CurrentAttempt.GetAwaiter().GetResult();
        Equal(1, downloads); Equal(2, commits); Equal(true, updates.IdleHandoff("IDLE", "0.1.0") is not null);
        Equal(true, new AgentUpdates("0.1.0", state, "MACOS_ARM64", new Version(14, 0), services).IdleHandoff("IDLE", "0.1.0") is not null);
        Equal(true, new AgentUpdates("0.2.0", state, "MACOS_ARM64", new Version(14, 0), services).IdleHandoff("IDLE", "0.1.0") is null);
    } finally { Directory.Delete(state, true); }
});
Check("staged expiry is rechecked before native handoff and failed preflight retries after backoff", () => {
    var state = Path.Combine(Path.GetTempPath(), "projector-stale-" + Guid.NewGuid()); Directory.CreateDirectory(state);
    try {
        var clock = new ControlledClock(now);
        var services = new AgentUpdateServices(clock, () => trust, (_, path, _) => { File.WriteAllBytes(path, [1, 2, 3]); return Task.CompletedTask; });
        var updates = new AgentUpdates("0.1.0", state, "MACOS_ARM64", new Version(14, 0), services);
        updates.Observe(JsonSerializer.Deserialize<JsonElement>(Sign(manifest), Wire.Json)); updates.CurrentAttempt.GetAwaiter().GetResult();
        Equal(true, updates.IdleHandoff("SHOWING", "0.1.0") is null);
        Equal(true, updates.IdleHandoff("IDLE", "0.1.0") is not null);
        updates.HandoffAccepted(true); Equal(true, updates.IdleHandoff("IDLE", "0.1.0") is null);
        updates.HandoffFailed(); Equal(true, updates.IdleHandoff("IDLE", "0.1.0") is null);
        clock.AdvanceMonotonic(TimeSpan.FromSeconds(31)); Equal(true, updates.IdleHandoff("IDLE", "0.1.0") is not null);
        clock.UtcNow = manifest.ExpiresAt.AddSeconds(1);
        Equal(true, updates.IdleHandoff("IDLE", "0.1.0") is null); Equal("STALE_METADATA", updates.DiagnosticCode);
    } finally { Directory.Delete(state, true); }
});
var sandbox = Path.Combine(Path.GetTempPath(), "projector-checks-" + Guid.NewGuid()); Directory.CreateDirectory(sandbox);
try {
    foreach (var unsafePath in new[] { "../escape", "/absolute", "C:/windows", "folder\\evil", "CON", "app.", "app " }) {
        Check("ZIP traversal denied: " + unsafePath, () => {
            using var bytes = new MemoryStream();
            using (var archive = new ZipArchive(bytes, ZipArchiveMode.Create, true)) { using var writer = new StreamWriter(archive.CreateEntry(unsafePath).Open()); writer.Write("bad"); }
            var value = bytes.ToArray();
            var archiveManifest = manifest with { Size = value.Length, Sha256 = Convert.ToHexString(SHA256.HashData(value)), EntryPoint = "app" };
            Reject(() => UpdatePackage.ExtractVerified(bytes, archiveManifest, Path.Combine(sandbox, Guid.NewGuid().ToString())), "UNSAFE_ARCHIVE_PATH");
        });
    }
} finally { Directory.Delete(sandbox, true); }
var screens = new[] { new ScreenInfo("laptop", "Laptop", 1440, 900, true), new ScreenInfo("HDMI", "HDMI", 1920, 1080, false) };
var host = new FakeHost(); var executor = new CommandExecutor(origin, host);
var policy = new PollResponse(1, 3000, now.AddSeconds(12), false, new(true, "0.1.0"), false, null, []);
AgentAck Execute(AgentCommand command, PollResponse? p = null) => executor.Execute(command, p ?? policy, screens, now, CancellationToken.None).GetAwaiter().GetResult();
Check("display setup identifies and prepares before an output lease while preserving policy and local failure", () => {
    var setupHost = new FakeHost(); var setup = new CommandExecutor(origin, setupHost);
    AgentAck Run(string type, PollResponse poll) => setup.Execute(new(Guid.NewGuid(), type, now.AddSeconds(10), new()), poll, screens, now, CancellationToken.None).GetAwaiter().GetResult();
    var idle = policy with { LeaseUntil = null };
    Equal("COMPLETED", Run("IDENTIFY_SCREENS", idle).Result);
    Equal("IDENTIFY_SCREENS", setupHost.Actions.Last().Type); Equal(1, setupHost.Executions); Equal("IDLE", setup.Status);
    Equal("COMPLETED", Run("PREPARE_DISPLAYS", idle).Result);
    Equal("NEUTRAL_STOP", setupHost.Actions[^2].Type); Equal("PREPARE_DISPLAYS", setupHost.Actions[^1].Type); Equal("IDLE", setup.Status);
    var before = setupHost.Executions;
    Equal("POLICY_DENIED", Run("PREPARE_DISPLAYS", idle with { Policy = new(false, "0.1.0") }).DiagnosticCode); Equal(before, setupHost.Executions);
    Equal("COMPLETED", Run("RESTORE_DISPLAYS", idle with { Policy = new(false, "0.1.0"), MustStop = true }).Result);
    Equal("RESTORE_DISPLAYS", setupHost.Actions.Last().Type);
    setupHost.Failure = "LOCAL_PREPARATION_CANCELLED";
    before = setupHost.Executions;
    Equal("NATIVE_STOP_FAILED", Run("PREPARE_DISPLAYS", idle).DiagnosticCode); Equal(before + 1, setupHost.Executions);
    Equal("NEUTRAL_STOP", setupHost.Actions.Last().Type);
    setupHost.FailureType = "PREPARE_DISPLAYS";
    Equal("LOCAL_PREPARATION_CANCELLED", Run("PREPARE_DISPLAYS", idle).DiagnosticCode);
});
Check("private remote focus preserves showing output and needs a scoped grant and lease without repeating screen test", () => {
    var focusHost = new FakeHost(); var focus = new CommandExecutor(origin, focusHost);
    var course = Guid.Parse("20000000-0000-4000-8000-000000000001");
    var session = Guid.Parse("20000000-0000-4000-8000-000000000002");
    var grant = "20000000-0000-4000-8000-000000000003." + new string('b', 64);
    AgentAck Run(string type, CommandPayload payload, PollResponse? poll = null) => focus.Execute(new(Guid.NewGuid(), type, now.AddSeconds(10), payload), poll ?? policy, screens, now, CancellationToken.None).GetAwaiter().GetResult();
    Equal("COMPLETED", Run("TEST_TARGET", new(null, "HDMI", "123456")).Result);
    Equal("COMPLETED", Run("START_PUBLIC_PROJECTION", new("ABC123", "HDMI", ControlToken: grant, CourseId: course, SessionId: session)).Result);
    Equal(true, PublicScene.Allowed(origin, new Uri(focusHost.Actions.Last().Url!)));
    Equal(true, LectureWorkspace.Allowed(origin, new Uri(focusHost.Actions.Last().RemoteUrl!)));
    var payload = new CommandPayload(ControlToken: grant, CourseId: course, SessionId: session);
    var before = focusHost.Executions;
    Equal("CONTROL_GRANT_REQUIRED", Run("FOCUS_PRIVATE_REMOTE", payload with { ControlToken = null }).DiagnosticCode);
    Equal("LEASE_EXPIRED", Run("FOCUS_PRIVATE_REMOTE", payload, policy with { LeaseUntil = null }).DiagnosticCode); Equal(before, focusHost.Executions);
    focus.TopologyChanged();
    Equal("COMPLETED", Run("FOCUS_PRIVATE_REMOTE", payload).Result); Equal(before + 1, focusHost.Executions); Equal("SHOWING", focus.Status);
    var action = focusHost.Actions.Last(); Equal("FOCUS_PRIVATE_REMOTE", action.Type); Equal<string?>(null, action.TargetScreenId); Equal<string?>(null, action.Url);
    Equal(LectureWorkspace.Build(origin, course, session, grant).AbsoluteUri, action.RemoteUrl); Equal(grant, action.ControlToken);
    Equal<Guid?>(course, action.CourseId); Equal<Guid?>(session, action.SessionId);
});
Check("CHECK_UPDATE acknowledges configured envelope request without claiming installation", () => {
    var configured = new CommandExecutor(origin, host, loadUpdateTrust: () => trust);
    var signal = new AgentCommand(Guid.NewGuid(), "CHECK_UPDATE", now.AddSeconds(10), new());
    Equal("RELEASE_FEED_NOT_PUBLISHED", configured.Execute(signal, policy, screens, now, CancellationToken.None).GetAwaiter().GetResult().DiagnosticCode);
    var ack = configured.Execute(signal with { Id = Guid.NewGuid() }, policy with { Release = JsonSerializer.Deserialize<JsonElement>(Sign(manifest), Wire.Json) }, screens, now, CancellationToken.None).GetAwaiter().GetResult();
    Equal("COMPLETED", ack.Result); Equal("UPDATE_CHECK_REQUESTED", ack.DiagnosticCode);
});
Check("command requires physical test and external target", () => {
    Equal("PHYSICAL_TEST_REQUIRED", Execute(new(Guid.NewGuid(), "START_PUBLIC_PROJECTION", now.AddSeconds(10), new("ABC123", "HDMI"))).DiagnosticCode);
    Equal("PRIMARY_TARGET_REQUIRES_MANUAL_SETUP", Execute(new(Guid.NewGuid(), "TEST_TARGET", now.AddSeconds(10), new(null, "laptop", "123456"))).DiagnosticCode);
    Equal("LEASE_EXPIRED", Execute(new(Guid.NewGuid(), "TEST_TARGET", now.AddSeconds(10), new(null, "HDMI", "123456")), policy with { LeaseUntil = now }).DiagnosticCode);
});
Check("idempotent test/start, topology invalidates test", () => {
    var command = new AgentCommand(Guid.NewGuid(), "TEST_TARGET", now.AddSeconds(10), new(null, "HDMI", "123456"));
    Equal("COMPLETED", Execute(command).Result); var before = host.Executions; Equal("COMPLETED", Execute(command).Result); Equal(before, host.Executions);
    Equal("COMPLETED", Execute(new(Guid.NewGuid(), "START_PUBLIC_PROJECTION", now.AddSeconds(10), new("ABC123", "HDMI"))).Result);
    executor.TopologyChanged(); Equal("PHYSICAL_TEST_REQUIRED", Execute(new(Guid.NewGuid(), "START_PUBLIC_PROJECTION", now.AddSeconds(10), new("ABC123", "HDMI"))).DiagnosticCode);
});
Check("policy, unknown command, expired command and update enforced", () => {
    var test = new AgentCommand(Guid.NewGuid(), "TEST_TARGET", now.AddSeconds(10), new(null, "HDMI", "123456"));
    Equal("POLICY_DENIED", Execute(test, policy with { Policy = new(false, "0.1.0") }).DiagnosticCode);
    Equal("COMMAND_EXPIRED", Execute(test with { Id = Guid.NewGuid(), ExpiresAt = now }).DiagnosticCode);
    Equal("UNKNOWN_COMMAND", Execute(test with { Id = Guid.NewGuid(), Type = "RUN_SHELL" }).DiagnosticCode);
    Equal("UPDATE_REQUIRED", Execute(test with { Id = Guid.NewGuid() }, policy with { UpdateRequired = true }).DiagnosticCode);
});
if (!OperatingSystem.IsWindows())
{
    var installSandbox = Path.Combine(Path.GetTempPath(), "projector-transaction-" + Guid.NewGuid()); Directory.CreateDirectory(installSandbox);
    byte[] SyntheticPackage(string version, string behavior)
    {
        using var bytes = new MemoryStream();
        using (var archive = new ZipArchive(bytes, ZipArchiveMode.Create, true))
        {
            var entry = archive.CreateEntry("agent"); entry.ExternalAttributes = (0x81C0 << 16); // regular file, user rwx
            using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
            writer.Write("#!/bin/sh\nset -eu\n");
            if (behavior == "healthy") writer.Write("printf '{\"transactionId\":\"%s\",\"nonce\":\"%s\",\"version\":\"" + version + "\",\"protocolVersion\":1,\"successfulPoll\":true}' \"$LA_PROJECTOR_UPDATE_ID\" \"$LA_PROJECTOR_UPDATE_NONCE\" > \"$LA_PROJECTOR_HEALTH_PATH.new\"\nmv \"$LA_PROJECTOR_HEALTH_PATH.new\" \"$LA_PROJECTOR_HEALTH_PATH\"\n");
            if (behavior == "wrong-nonce") writer.Write("printf '{\"transactionId\":\"%s\",\"nonce\":\"wrong\",\"version\":\"" + version + "\",\"protocolVersion\":1,\"successfulPoll\":true}' \"$LA_PROJECTOR_UPDATE_ID\" > \"$LA_PROJECTOR_HEALTH_PATH\"\n");
            writer.Write("exit 0\n");
        }
        return bytes.ToArray();
    }
    ReleaseManifest SyntheticManifest(string version, byte[] bytes) => manifest with { Version = version, EntryPoint = "agent", Size = bytes.Length, Sha256 = Convert.ToHexString(SHA256.HashData(bytes)) };
    InstallOutcome Install(string version, string behavior, string minimum)
    {
        var bytes = SyntheticPackage(version, behavior);
        return new UpdateTransaction(installSandbox, new ControlledClock(now)).Install(new MemoryStream(bytes), SyntheticManifest(version, bytes), minimum,
            new ProcessUpdateProcesses(), TimeSpan.FromMilliseconds(500), CancellationToken.None).GetAwaiter().GetResult();
    }
    try
    {
        Check("native preflight receipt authenticates readiness before old process exits", () => {
            var preflightDirectory = Path.Combine(installSandbox, "preflight"); Directory.CreateDirectory(preflightDirectory);
            using var old = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("/bin/sh") { UseShellExecute = false, ArgumentList = { "-c", "sleep 1" } })!;
            var id = Guid.NewGuid().ToString("N"); var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            var challenge = new UpdatePreflight(id, nonce, Path.Combine(preflightDirectory, "ready.json"), "0.2.0");
            using var pending = new PendingNativeUpdate(old, challenge);
            Equal(false, pending.Ready);
            Reject(() => new ProcessUpdateProcesses(old.Id, old.StartTime.ToUniversalTime().Ticks + 1, challenge).WaitForOldExit(CancellationToken.None).GetAwaiter().GetResult(), "OLD_PROCESS_IDENTITY_CHANGED");
            Equal(false, File.Exists(challenge.Path));
            var waiting = new ProcessUpdateProcesses(old.Id, old.StartTime.ToUniversalTime().Ticks, challenge).WaitForOldExit(CancellationToken.None);
            Equal(true, pending.Ready); waiting.GetAwaiter().GetResult();
            var receipt = JsonSerializer.Deserialize<PreflightReceipt>(File.ReadAllBytes(challenge.Path), Wire.Json)!;
            Equal(nonce, receipt.Nonce); Equal("0.2.0", receipt.Version);
        });
        Check("interrupted extraction and pre-journal partial slot recover with freshly verified bytes", () => {
            var recoveryRoot = Path.Combine(installSandbox, "recovery"); var slots = Path.Combine(recoveryRoot, "versions"); Directory.CreateDirectory(slots);
            Directory.CreateDirectory(Path.Combine(slots, ".extract-killed")); File.WriteAllText(Path.Combine(slots, ".extract-killed", "partial"), "old");
            var bad = new byte[] { 1, 2, 3 }; var invalid = SyntheticManifest("0.1.0", bad);
            try { _ = new UpdateTransaction(recoveryRoot, new ControlledClock(now)).Install(new MemoryStream(bad), invalid, "0.1.0", new ProcessUpdateProcesses(), TimeSpan.FromMilliseconds(500), CancellationToken.None).GetAwaiter().GetResult(); throw new Exception("Accepted invalid ZIP"); }
            catch (InvalidDataException) { }
            Equal(0, Directory.GetDirectories(slots, ".extract-*").Length);
            var bytes = SyntheticPackage("0.1.0", "healthy"); var good = SyntheticManifest("0.1.0", bytes);
            var slot = good.Version + "-" + good.Sha256[..16].ToLowerInvariant();
            Directory.CreateDirectory(Path.Combine(slots, slot)); File.WriteAllText(Path.Combine(slots, slot, "partial"), "untrusted old extraction");
            var result = new UpdateTransaction(recoveryRoot, new ControlledClock(now)).Install(new MemoryStream(bytes), good, "0.1.0", new ProcessUpdateProcesses(), TimeSpan.FromMilliseconds(500), CancellationToken.None).GetAwaiter().GetResult();
            Equal("HEALTHY", result.State); Equal(false, File.Exists(Path.Combine(slots, slot, "partial"))); Equal(true, File.Exists(Path.Combine(slots, slot, "agent")));
        });
        Check("real subprocess first install proves health before success", () => {
            Equal("HEALTHY", Install("0.1.0", "healthy", "0.1.0").State);
            Equal("0.1.0", UpdateTransaction.ReadCurrent(installSandbox)!.Version);
        });
        Check("preflight failure keeps old host and pointer without starting duplicate or rollback", () => {
            var bytes = SyntheticPackage("0.9.0", "healthy"); var processes = new FailingPreflightProcesses();
            var result = new UpdateTransaction(installSandbox, new ControlledClock(now)).Install(new MemoryStream(bytes), SyntheticManifest("0.9.0", bytes), "0.1.0", processes, TimeSpan.FromMilliseconds(500), CancellationToken.None).GetAwaiter().GetResult();
            Equal("PREFLIGHT_CANCELLED_OLD_HOST_KEPT", result.State); Equal(0, processes.Starts);
            Equal("0.1.0", UpdateTransaction.ReadCurrent(installSandbox)!.Version);
            Equal(false, File.Exists(Path.Combine(installSandbox, "update-transaction.json")));
        });
        Check("expired preflight never asks old host to exit", () => {
            var bytes = SyntheticPackage("0.9.1", "healthy"); var processes = new FailingPreflightProcesses();
            var result = new UpdateTransaction(installSandbox, new ControlledClock(manifest.ExpiresAt)).Install(new MemoryStream(bytes), SyntheticManifest("0.9.1", bytes), "0.1.0", processes, TimeSpan.FromMilliseconds(500), CancellationToken.None).GetAwaiter().GetResult();
            Equal("PREFLIGHT_CANCELLED_OLD_HOST_KEPT", result.State); Equal(0, processes.Waits); Equal(0, processes.Starts);
            Equal("0.1.0", UpdateTransaction.ReadCurrent(installSandbox)!.Version);
        });
        Check("active show defers immutable slot and pointer replacement", () => {
            using var activity = new OutputActivityLock(installSandbox); Equal(true, activity.TryEnter());
            Equal("DEFERRED_ACTIVE_SHOW", Install("0.2.0", "healthy", "0.1.0").State);
            Equal("0.1.0", UpdateTransaction.ReadCurrent(installSandbox)!.Version);
        });
        Check("second package atomically replaces pointer and restarts healthy process", () => {
            Equal("HEALTHY", Install("0.2.0", "healthy", "0.1.0").State);
            Equal("0.2.0", UpdateTransaction.ReadCurrent(installSandbox)!.Version);
        });
        Check("wrong health nonce rolls back to allowed previous real process", () => {
            Equal("ROLLED_BACK", Install("0.3.0", "wrong-nonce", "0.1.0").State);
            Equal("0.2.0", UpdateTransaction.ReadCurrent(installSandbox)!.Version);
            Equal(true, Directory.GetFiles(installSandbox, "quarantine-*.json").Length == 1);
        });
        Check("revoked previous version cannot regain active pointer on failure", () => {
            Equal("QUARANTINED_BROWSER_REQUIRED", Install("0.4.0", "unhealthy", "0.4.0").State);
            Equal<InstalledSlot?>(null, UpdateTransaction.ReadCurrent(installSandbox));
            Equal(true, File.Exists(Path.Combine(installSandbox, "update-transaction.json")));
        });
    }
    finally { Directory.Delete(installSandbox, true); }
}
passed += BootstrapChecks.Run();
Console.WriteLine($"{passed} checks passed. No OS display mutation, startup registration or production network request performed.");
internal sealed class FakeHost : IProjectionHost {
    public int Executions { get; private set; }
    public List<HostAction> Actions { get; } = [];
    public string? Failure { get; set; }
    public string? FailureType { get; set; }
    public Task<HostResult> Execute(HostAction action, CancellationToken ct) { Executions++; Actions.Add(action); var failure = FailureType is null || FailureType == action.Type ? Failure : null; return Task.FromResult(new HostResult(action.Id, failure is null, failure)); }
}

internal sealed class ControlledClock(DateTimeOffset utcNow) : TimeProvider {
    public DateTimeOffset UtcNow { get; set; } = utcNow;
    private long timestamp;
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    public override DateTimeOffset GetUtcNow() => UtcNow;
    public override long GetTimestamp() => timestamp;
    public void AdvanceMonotonic(TimeSpan elapsed) => timestamp += elapsed.Ticks;
}

internal sealed class FailingPreflightProcesses : IUpdateProcesses {
    public int Waits { get; private set; }
    public int Starts { get; private set; }
    public Task WaitForOldExit(CancellationToken ct) { Waits++; throw new InvalidDataException("SYNTHETIC_PREFLIGHT_FAILURE"); }
    public Task Start(InstalledSlot slot, string absoluteEntryPoint, HealthChallenge challenge, CancellationToken ct) { Starts++; throw new Exception("Unexpected child start"); }
    public Task StopFailedCandidate(CancellationToken ct) => throw new Exception("No candidate was started");
}
