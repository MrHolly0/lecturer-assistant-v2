using System.Text;
using Lecturer.Projector;

internal static class InstallationIdentityChecks
{
    public static int Run()
    {
        var passed = 0;
        void Check(string name, Action body) { body(); Console.WriteLine("PASS " + name); passed++; }
        void Require(bool valid, string message) { if (!valid) throw new Exception(message); }
        void Reject(Action action, string expected)
        {
            try { action(); } catch (InvalidDataException error) { Require(error.Message == expected, "Wrong identity diagnostic"); return; }
            throw new Exception("Invalid installation identity was accepted");
        }
        var sandbox = Path.Combine(Path.GetTempPath(), "projector-identity-checks-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(sandbox);
        try
        {
            Check("installation UUID survives reopening, version slots and unpair credential removal", () => {
                var root = Path.Combine(sandbox, "persistent");
                var first = InstallationIdentity.LoadOrCreate(root);
                Require(first != Guid.Empty && InstallationIdentity.LoadOrCreate(root) == first, "Installation UUID changed on reopen");
                var path = Path.Combine(root, "installation-id.txt");
                Require(File.ReadAllText(path) == first.ToString("D"), "Installation UUID is not a complete canonical document");
                Directory.CreateDirectory(Path.Combine(root, "versions", "0.2.5"));
                File.WriteAllText(Path.Combine(root, "device.dpapi"), "synthetic credential");
                File.WriteAllText(Path.Combine(root, "origin.txt"), "https://fixture.invalid/");
                File.Delete(Path.Combine(root, "device.dpapi")); File.Delete(Path.Combine(root, "origin.txt"));
                Require(InstallationIdentity.LoadOrCreate(root) == first, "Unpair or version directory changed the installation UUID");
                Require(Directory.GetFiles(root, "*.tmp").Length == 0, "Temporary identity document was left behind");
            });
            Check("different installation data roots receive independent random UUIDs", () => {
                var first = InstallationIdentity.LoadOrCreate(Path.Combine(sandbox, "one"));
                var other = InstallationIdentity.LoadOrCreate(Path.Combine(sandbox, "two"));
                Require(first != Guid.Empty && other != Guid.Empty && first != other, "Independent roots share an installation UUID");
                Reject(() => InstallationIdentity.LoadOrCreate("relative-directory"), "INSTALLATION_DIRECTORY_MUST_BE_ABSOLUTE");
            });
            Check("corrupt installation UUIDs fail closed without replacement or temporary writes", () => {
                var root = Path.Combine(sandbox, "corrupt"); Directory.CreateDirectory(root);
                var path = Path.Combine(root, "installation-id.txt");
                var valid = Guid.NewGuid().ToString("D");
                foreach (var document in new[] { "", "not-a-uuid", Guid.Empty.ToString("D"), valid + "\n", "{" + valid + "}", "\uFEFF" + valid, new string('a', 65536) })
                {
                    var bytes = Encoding.UTF8.GetBytes(document); File.WriteAllBytes(path, bytes);
                    Reject(() => InstallationIdentity.LoadOrCreate(root), "INSTALLATION_ID_INVALID");
                    Require(File.ReadAllBytes(path).SequenceEqual(bytes), "A corrupt UUID was silently replaced");
                    Require(Directory.GetFiles(root, "*.tmp").Length == 0, "Corrupt read attempted to create a replacement");
                }
            });
            Check("concurrent first launches publish one complete UUID atomically", () => {
                for (var round = 0; round < 20; round++)
                {
                    var root = Path.Combine(sandbox, "concurrent-" + round);
                    using var ready = new CountdownEvent(24); using var start = new ManualResetEventSlim();
                    var attempts = Enumerable.Range(0, 24).Select(_ => Task.Factory.StartNew(() => {
                        ready.Signal();
                        if (!start.Wait(TimeSpan.FromSeconds(10))) throw new Exception("Concurrent fixture start timed out");
                        return InstallationIdentity.LoadOrCreate(root);
                    }, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default)).ToArray();
                    var allReady = false;
                    try { allReady = ready.Wait(TimeSpan.FromSeconds(10)); }
                    finally { start.Set(); }
                    var identities = Task.WhenAll(attempts).WaitAsync(TimeSpan.FromSeconds(15)).GetAwaiter().GetResult();
                    Require(allReady, "Concurrent fixture workers did not start");
                    Require(identities.Distinct().Count() == 1 && identities[0] != Guid.Empty, "Concurrent launches published different UUIDs");
                    Require(InstallationIdentity.LoadOrCreate(root) == identities[0], "Published identity differs from the concurrent result");
                    Require(Directory.GetFiles(root, "*.tmp").Length == 0, "Losing atomic creators left temporary files behind");
                }
            });
            return passed;
        }
        finally { Directory.Delete(sandbox, true); }
    }
}
