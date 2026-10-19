using System.Text.Json;
namespace Lecturer.Projector;
public static class EmbeddedTrust
{
    public static UpdateTrust Load()
    {
        using var stream = typeof(EmbeddedTrust).Assembly.GetManifestResourceStream("Lecturer.Projector.trusted-keys.json")
            ?? throw new InvalidDataException("MISSING_EMBEDDED_TRUST");
        var trust = JsonSerializer.Deserialize<UpdateTrust>(stream, Wire.Json) ?? throw new InvalidDataException("BAD_TRUST");
        if (trust.Keys.Count == 0) throw new InvalidDataException("RELEASE_SIGNING_NOT_PROVISIONED");
        return trust;
    }
}
