using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
namespace Lecturer.Projector;

public sealed record PreflightReceipt(string Id, string Nonce, string Version, bool Ready);
public sealed record UpdatePreflight(string Id, string Nonce, string Path, string Version)
{
    public static UpdatePreflight? FromEnvironment(string root, string version)
    {
        var id = Environment.GetEnvironmentVariable("LA_PROJECTOR_PREFLIGHT_ID");
        var nonce = Environment.GetEnvironmentVariable("LA_PROJECTOR_PREFLIGHT_NONCE");
        var path = Environment.GetEnvironmentVariable("LA_PROJECTOR_PREFLIGHT_PATH");
        if (id is null && nonce is null && path is null) return null;
        if (id is null || id.Length != 32 || !id.All(Uri.IsHexDigit) || nonce is null || nonce.Length != 64 || !nonce.All(Uri.IsHexDigit) || path is null ||
            System.IO.Path.GetFullPath(path) != System.IO.Path.Combine(System.IO.Path.GetFullPath(root), "health", "preflight-" + id + ".json"))
            throw new InvalidDataException("BAD_PREFLIGHT_CHANNEL");
        return new(id, nonce, path, version);
    }
    public void Ready()
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
        UpdateTransaction.WriteAtomic(Path, new PreflightReceipt(Id, Nonce, Version, true));
    }
}
public sealed class PendingNativeUpdate(Process process, UpdatePreflight preflight) : IDisposable
{
    private readonly Stopwatch elapsed = Stopwatch.StartNew();
    public bool Ready
    {
        get
        {
            if (!File.Exists(preflight.Path) || new FileInfo(preflight.Path).Length > 4096) return false;
            try
            {
                var receipt = JsonSerializer.Deserialize<PreflightReceipt>(File.ReadAllBytes(preflight.Path), Wire.Json);
                return receipt is not null && receipt.Id == preflight.Id && receipt.Ready &&
                    CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(receipt.Nonce), System.Text.Encoding.UTF8.GetBytes(preflight.Nonce));
            }
            catch (IOException) { return false; } catch (JsonException) { return false; }
        }
    }
    public bool Failed => process.HasExited || elapsed.Elapsed > TimeSpan.FromMinutes(10);
    public void Dispose() { process.Dispose(); if (File.Exists(preflight.Path)) File.Delete(preflight.Path); }
}
