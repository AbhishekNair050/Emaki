using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Emaki;

internal static class PackTests {
    private static void Check(bool ok, string check) { if (!ok) throw new Exception(check); }
    private static byte[] Body(Resource r) {
        using (r.Body)
        using (var copy = new MemoryStream()) { r.Body.CopyTo(copy); return copy.ToArray(); }
    }
    private static void Damaged(Action action) {
        try { action(); } catch (InvalidDataException) { return; }
        throw new Exception("Expected authenticated pack rejection.");
    }
    private static void Main(string[] args) {
        string root = Path.Combine(args[0], "web");
        Directory.CreateDirectory(root);
        byte[] data = new byte[Pack.Chunk * 2 + 31], key = new byte[64];
        using (var rng = RandomNumberGenerator.Create()) { rng.GetBytes(data); rng.GetBytes(key); }
        File.WriteAllBytes(Path.Combine(root, "index.html"), Encoding.UTF8.GetBytes("<title>Pack test</title>"));
        const string name = "sora \u7a7a.mp4";
        File.WriteAllBytes(Path.Combine(root, name), data);
        File.WriteAllBytes(Path.Combine(root, "empty.txt"), new byte[0]);
        string path = Path.Combine(args[0], "game.emaki");
        PackWriter.Write(root, path, key);
        const string origin = "https://game.emaki.invalid/";
        string url = origin + Uri.EscapeDataString(name) + "?v=1";
        long offset;
        using (var pack = new Pack(path, key)) {
            var e = pack.Find(name); offset = e.Offset;
            var full = Resource.Serve(pack, url, "GET", null);
            Check(full.Status == 200 && full.Headers.Contains("no-store") && Body(full).SequenceEqual(data), "whole media");
            var part = Resource.Serve(pack, url, "GET", "bytes=262140-262150");
            Check(part.Status == 206 && Body(part).SequenceEqual(data.Skip(Pack.Chunk - 4).Take(11)), "cross-chunk range");
            var suffix = Resource.Serve(pack, url, "GET", "bytes=-5");
            Check(Body(suffix).SequenceEqual(data.Skip(data.Length - 5)), "suffix");
            Check(Body(Resource.Serve(pack, url, "GET", "bytes=524288-")).Length == 31, "open end");
            Check(Resource.Serve(pack, url, "GET", "bytes=999999-").Status == 416, "unsatisfiable");
            Check(Resource.Serve(pack, url, "GET", "bytes=4-1").Status == 416, "backward range");
            Check(Resource.Serve(pack, url, "HEAD", null).Body == null, "HEAD");
            Check(Body(Resource.Serve(pack, origin + "empty.txt", "GET", null)).Length == 0, "empty");
            Check(Resource.Serve(pack, origin + "empty.txt", "GET", "bytes=0-").Status == 416, "empty range");
            Check(Resource.Serve(pack, origin + "missing", "GET", null).Status == 404, "missing");
            Check(Resource.Serve(pack, "https://other.invalid/", "GET", null).Status == 403, "foreign origin");
            Check(Resource.Serve(pack, url, "POST", null).Status == 405, "POST");
            using (var stream = pack.Open(e, 0, e.Size)) {
                stream.Seek(-1, SeekOrigin.End);
                Check(stream.ReadByte() == data.Last() && stream.ReadByte() == -1, "seek from end");
                stream.Position = 0;
                Check(stream.ReadByte() == data[0], "seek backward");
            }
        }
        Damaged(delegate { using (new Pack(path, new byte[64])) {} });
        using (var file = File.Open(path, FileMode.Open, FileAccess.ReadWrite)) {
            file.Position = offset + 16;
            int b = file.ReadByte(); file.Position--; file.WriteByte((byte)(b ^ 1));
        }
        using (var pack = new Pack(path, key)) {
            Damaged(delegate { Body(Resource.Serve(pack, url, "GET", "bytes=0-1")); });
            Check(Body(Resource.Serve(pack, url, "GET", "bytes=-1"))[0] == data.Last(), "independent chunks");
        }
        using (var file = File.Open(path, FileMode.Open, FileAccess.ReadWrite)) {
            file.Position = file.Length - 9;
            int b = file.ReadByte(); file.Position--; file.WriteByte((byte)(b ^ 1));
        }
        Damaged(delegate { using (new Pack(path, key)) {} });
        string roaming = Path.Combine(args[0], "roaming"), app = Path.Combine(args[0], "new-profile");
        string legacy = Path.Combine(roaming, "Test Game", "Local Storage", "leveldb");
        Directory.CreateDirectory(legacy);
        File.WriteAllText(Path.Combine(legacy, "CURRENT"), "MANIFEST-000001");
        File.WriteAllText(Path.Combine(legacy, "MANIFEST-000001"), "test");
        string lockFile = Path.Combine(legacy, "LOCK");
        using (File.Create(lockFile)) {
            bool blocked = false;
            try { Profile.Prepare(app, roaming, "Test Game", "com.emaki.test"); }
            catch (IOException) { blocked = true; }
            Check(blocked && !Directory.Exists(Path.Combine(app, "player")), "retry a busy legacy profile");
        }
        Check(Profile.Prepare(app, roaming, "Test Game", "com.emaki.test"), "first launch seeds old storage");
        File.Delete(Path.Combine(app, "player", "import-pending"));
        Check(!Profile.Prepare(app, roaming, "Test Game", "com.emaki.test"), "updates preserve the active profile");
        Check(File.ReadAllText(Path.Combine(legacy, "CURRENT")) == "MANIFEST-000001", "original profile retained");
        Console.WriteLine("Pack round-trip, ranges, seeking and tamper checks passed.");
    }
}
