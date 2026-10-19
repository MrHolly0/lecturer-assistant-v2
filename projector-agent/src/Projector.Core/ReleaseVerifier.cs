using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Lecturer.Projector;

public sealed record SignedEnvelope(string KeyId, string Payload, string Signature);
public sealed record ReleaseManifest(long Sequence, string Version, string Platform, string MinimumOsVersion, int ProtocolVersion,
    DateTimeOffset PublishedAt, DateTimeOffset ExpiresAt, string Url, long Size, string Sha256, string EntryPoint, string ArtifactType = "UPDATE");
public sealed record UpdateTrust(string Repository, Dictionary<string, string> Keys);
public sealed record UpdateCheckpoint(long Sequence, string Version);

/// <summary>The signature covers the exact decoded UTF-8 bytes, not a reserialized JSON object.</summary>
public static class ReleaseVerifier
{
    public static ReleaseManifest Verify(byte[] envelopeBytes, UpdateTrust trust, string platform, Version osVersion,
        string runningVersion, UpdateCheckpoint checkpoint, DateTimeOffset now)
    {
        if (envelopeBytes.Length > 65_536) throw new InvalidDataException("MANIFEST_TOO_LARGE");
        var envelope = JsonSerializer.Deserialize<SignedEnvelope>(envelopeBytes, Wire.Json) ?? throw new InvalidDataException("BAD_ENVELOPE");
        if (!trust.Keys.TryGetValue(envelope.KeyId, out var publicKey)) throw new InvalidDataException("UNTRUSTED_SIGNING_KEY");
        var payload = Convert.FromBase64String(envelope.Payload);
        var signature = Convert.FromBase64String(envelope.Signature);
        using var verifier = ECDsa.Create();
        verifier.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKey), out var consumed);
        if (consumed != Convert.FromBase64String(publicKey).Length || verifier.KeySize != 256 || verifier.ExportParameters(false).Curve.Oid.Value != "1.2.840.10045.3.1.7" || signature.Length != 64 ||
            !verifier.VerifyData(payload, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
            throw new InvalidDataException("BAD_MANIFEST_SIGNATURE");
        var release = JsonSerializer.Deserialize<ReleaseManifest>(payload, Wire.Json) ?? throw new InvalidDataException("BAD_PAYLOAD");
        if (release.ArtifactType != "UPDATE") throw new InvalidDataException("WRONG_ARTIFACT_TYPE");
        if (!Wire.Platforms.Contains(platform) || release.Platform != platform) throw new InvalidDataException("WRONG_PLATFORM");
        if (release.ProtocolVersion != Wire.ProtocolVersion) throw new InvalidDataException("WRONG_PROTOCOL");
        if (!Version.TryParse(release.MinimumOsVersion, out var minimumOs) || osVersion < minimumOs) throw new InvalidDataException("OS_TOO_OLD");
        if (!Version.TryParse(release.Version, out var version) || !Version.TryParse(runningVersion, out var running) ||
            !Version.TryParse(checkpoint.Version, out var accepted) || version <= running || version < accepted)
            throw new InvalidDataException("ROLLBACK_OR_NOT_NEWER");
        if (release.Sequence <= checkpoint.Sequence || release.Sequence < 1) throw new InvalidDataException("REPLAYED_METADATA");
        if (release.PublishedAt > now.AddMinutes(5) || release.ExpiresAt <= now || release.ExpiresAt <= release.PublishedAt ||
            release.ExpiresAt - release.PublishedAt > TimeSpan.FromDays(14)) throw new InvalidDataException("STALE_METADATA");
        if (release.Size is < 1 or > 536_870_912 || release.Sha256.Length != 64 || !release.Sha256.All(Uri.IsHexDigit))
            throw new InvalidDataException("BAD_PACKAGE_DIGEST");
        if (trust.Repository.Split('/').Length != 2 || trust.Repository.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '/' or '-' or '_' or '.')))
            throw new InvalidDataException("UNCONFIGURED_RELEASE_REPOSITORY");
        if (!Uri.TryCreate(release.Url, UriKind.Absolute, out var asset) || asset.Scheme != "https" || asset.Host != "github.com" ||
            asset.UserInfo.Length != 0 || asset.Query.Length != 0 || asset.Fragment.Length != 0 ||
            !asset.AbsolutePath.StartsWith("/" + trust.Repository + "/releases/download/", StringComparison.Ordinal))
            throw new InvalidDataException("UNTRUSTED_ASSET_ORIGIN");
        if (release.EntryPoint.Length == 0 || Path.IsPathRooted(release.EntryPoint) || release.EntryPoint.Contains("..") ||
            release.EntryPoint.Contains('\\') || release.EntryPoint.Contains(':')) throw new InvalidDataException("BAD_ENTRY_POINT");
        return release;
    }
    public static void VerifyPackage(Stream stream, ReleaseManifest manifest)
    {
        if (stream.Length != manifest.Size) throw new InvalidDataException("PACKAGE_SIZE_MISMATCH");
        stream.Position = 0;
        var expected = Convert.FromHexString(manifest.Sha256);
        var actual = SHA256.HashData(stream);
        if (!CryptographicOperations.FixedTimeEquals(expected, actual)) throw new InvalidDataException("PACKAGE_HASH_MISMATCH");
        stream.Position = 0;
    }
}
