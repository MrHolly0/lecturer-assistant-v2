using System.Runtime.InteropServices;
using System.Text;
namespace Lecturer.Projector.Windows;
internal static class CredentialStore
{
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Size; public IntPtr Data; }
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CryptProtectData(ref Blob input, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);
    [DllImport("crypt32.dll", SetLastError = true)] private static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
    public static void Save(string path, string token) => File.WriteAllBytes(path, Transform(Encoding.UTF8.GetBytes(token), true));
    public static string? Read(string path) => File.Exists(path) ? Encoding.UTF8.GetString(Transform(File.ReadAllBytes(path), false)) : null;
    private static byte[] Transform(byte[] value, bool protect)
    {
        var input = new Blob { Size = value.Length, Data = Marshal.AllocHGlobal(value.Length) };
        try
        {
            Marshal.Copy(value, 0, input.Data, value.Length);
            var ok = protect ? CryptProtectData(ref input, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out var output)
                : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!ok) throw new InvalidDataException("CREDENTIAL_PROTECTION_FAILED");
            try { var result = new byte[output.Size]; Marshal.Copy(output.Data, result, 0, result.Length); return result; }
            finally { LocalFree(output.Data); }
        }
        finally { Marshal.FreeHGlobal(input.Data); }
    }
}
