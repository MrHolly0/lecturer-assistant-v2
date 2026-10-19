using System.Text;
using System.Runtime.InteropServices;

namespace Lecturer.Projector;

public static class InstallationIdentity
{
    private const string FileName = "installation-id.txt";

    public static Guid LoadOrCreate(string canonicalDataDirectory)
    {
        if (string.IsNullOrWhiteSpace(canonicalDataDirectory) || !Path.IsPathFullyQualified(canonicalDataDirectory))
            throw new InvalidDataException("INSTALLATION_DIRECTORY_MUST_BE_ABSOLUTE");
        var directory = Path.GetFullPath(canonicalDataDirectory);
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, FileName);
        try { return Read(path); }
        catch (FileNotFoundException) { }

        var identity = Guid.NewGuid();
        var temporary = Path.Combine(directory, ".installation-id-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                output.Write(Encoding.ASCII.GetBytes(identity.ToString("D")));
                output.Flush(flushToDisk: true);
            }
            if (OperatingSystem.IsWindows())
            {
                try { File.Move(temporary, path); }
                catch (IOException) when (File.Exists(path)) { return Read(path); }
            }
            else
            {
                // Unix File.Move(false) can stat then rename, overwriting a concurrent winner.
                // An exclusive hard link publishes the complete inode without replacement.
                if (Link(temporary, path) != 0)
                {
                    var error = Marshal.GetLastPInvokeError();
                    if (error == 17) return Read(path); // EEXIST on supported macOS/Linux hosts.
                    throw new IOException("INSTALLATION_ID_CREATE_FAILED", new System.ComponentModel.Win32Exception(error));
                }
            }
            return identity;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static Guid Read(string path)
    {
        using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (input.Length != 36) throw new InvalidDataException("INSTALLATION_ID_INVALID");
        Span<byte> bytes = stackalloc byte[36]; input.ReadExactly(bytes);
        if (!Guid.TryParseExact(Encoding.ASCII.GetString(bytes), "D", out var identity) || identity == Guid.Empty)
            throw new InvalidDataException("INSTALLATION_ID_INVALID");
        return identity;
    }

    [DllImport("libc", EntryPoint = "link", SetLastError = true)]
    private static extern int Link([MarshalAs(UnmanagedType.LPUTF8Str)] string existing, [MarshalAs(UnmanagedType.LPUTF8Str)] string destination);
}
