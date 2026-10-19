using System.IO.Compression;
using System.Net;

namespace Lecturer.Projector;

public static class UpdatePackage
{
    public static async Task Download(ReleaseManifest manifest, string destination, CancellationToken ct)
    {
        // Never follow an arbitrary redirect with device credentials. Asset downloads carry no credentials.
        using var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false };
        using var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(10) };
        var url = new Uri(manifest.Url);
        HttpResponseMessage? response = null;
        var created = false;
        try
        {
            for (var hop = 0; hop < 4; hop++)
            {
                response?.Dispose();
                response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
                if ((int)response.StatusCode is not (301 or 302 or 303 or 307 or 308)) break;
                var location = response.Headers.Location ?? throw new InvalidDataException("REDIRECT_WITHOUT_LOCATION");
                var next = location.IsAbsoluteUri ? location : new Uri(url, location);
                if (next.Scheme != "https" || next.UserInfo.Length != 0 || next.Host is not
                    ("github.com" or "release-assets.githubusercontent.com" or "objects.githubusercontent.com"))
                    throw new InvalidDataException("UNTRUSTED_REDIRECT");
                url = next;
            }
            if (response is null || response.StatusCode != HttpStatusCode.OK) throw new InvalidDataException("ASSET_DOWNLOAD_FAILED");
            await using var input = await response.Content.ReadAsStreamAsync(ct);
            await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None);
            created = true;
            var buffer = new byte[65536]; long total = 0;
            while (true)
            {
                var read = await input.ReadAsync(buffer, ct); if (read == 0) break;
                total += read; if (total > manifest.Size) throw new InvalidDataException("PACKAGE_TOO_LARGE");
                await output.WriteAsync(buffer.AsMemory(0, read), ct);
            }
            output.Flush(true); ReleaseVerifier.VerifyPackage(output, manifest);
        }
        catch
        {
            if (created && File.Exists(destination)) File.Delete(destination);
            throw;
        }
        finally { response?.Dispose(); }
    }
    private static bool UnsafeComponent(string component)
    {
        if (component is ".." or "." || component.EndsWith(' ') || component.EndsWith('.') || component.Any(c => c < 32 || "<>:\"|?*".Contains(c))) return true;
        var stem = component.Split('.')[0].ToUpperInvariant();
        return stem is "CON" or "PRN" or "AUX" or "NUL" || (stem.Length == 4 && stem[3] is >= '1' and <= '9' && (stem.StartsWith("COM") || stem.StartsWith("LPT")));
    }
    public static long CopyEntryBounded(Stream input, Stream output, long declaredLength, long remainingArchiveBudget)
    {
        if (declaredLength < 0 || remainingArchiveBudget < 0) throw new InvalidDataException("BAD_ARCHIVE_LENGTH");
        var buffer = new byte[65536]; long written = 0;
        while (true)
        {
            var count = input.Read(buffer, 0, buffer.Length); if (count == 0) break;
            if (written + count > remainingArchiveBudget) throw new InvalidDataException("ARCHIVE_TOO_LARGE");
            if (written + count > declaredLength) throw new InvalidDataException("ARCHIVE_ENTRY_SIZE_MISMATCH");
            output.Write(buffer, 0, count); written += count;
        }
        if (written != declaredLength) throw new InvalidDataException("ARCHIVE_ENTRY_SIZE_MISMATCH");
        return written;
    }
    public static void ExtractVerified(Stream package, ReleaseManifest manifest, string emptyDestination)
    {
        ReleaseVerifier.VerifyPackage(package, manifest);
        if (Directory.Exists(emptyDestination)) throw new InvalidDataException("STAGING_ALREADY_EXISTS");
        Directory.CreateDirectory(emptyDestination);
        using var zip = new ZipArchive(package, ZipArchiveMode.Read, leaveOpen: true);
        if (zip.Entries.Count is < 1 or > 5000) throw new InvalidDataException("BAD_ARCHIVE_ENTRY_COUNT");
        long unpacked = 0; long actualUnpacked = 0; var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in zip.Entries)
        {
            var name = entry.FullName;
            if (name.Length == 0 || name.Contains('\\') || name.Contains(':') || Path.IsPathRooted(name) ||
                name.Split('/').Any(UnsafeComponent) || !seen.Add(name.TrimEnd('/')) ||
                ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000)
                throw new InvalidDataException("UNSAFE_ARCHIVE_PATH");
            unpacked += entry.Length;
            if (unpacked > 1_073_741_824) throw new InvalidDataException("ARCHIVE_TOO_LARGE");
            var path = Path.GetFullPath(Path.Combine(emptyDestination, name));
            if (!path.StartsWith(Path.GetFullPath(emptyDestination) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                throw new InvalidDataException("ARCHIVE_ESCAPE");
            if (name.EndsWith('/')) { Directory.CreateDirectory(path); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            using var input = entry.Open(); using var output = new FileStream(path, FileMode.CreateNew);
            actualUnpacked += CopyEntryBounded(input, output, entry.Length, 1_073_741_824 - actualUnpacked);
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(path, (entry.ExternalAttributes >> 16 & 0x49) != 0
                    ? UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                    : UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        if (!File.Exists(Path.Combine(emptyDestination, manifest.EntryPoint))) throw new InvalidDataException("ENTRY_POINT_MISSING");
    }
}
