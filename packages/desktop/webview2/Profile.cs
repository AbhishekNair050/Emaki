using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Emaki {
    internal static class Profile {
        internal static string Id(string appId) {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(appId.ToLowerInvariant()))).Replace("-", "").Substring(0, 32);
        }
        // Seed a fresh profile with a consistent, read-only copy of the previous
        // Electron game's storage. Chromium opens it under its original origin.
        // Publish the entire profile in one rename so interrupted copies retry.
        internal static bool Prepare(string root, string roaming, string product, string appId) {
            string profile = Path.Combine(root, "player");
            if (Directory.Exists(profile)) return File.Exists(Path.Combine(profile, "import-pending"));
            Directory.CreateDirectory(root);
            string stage = Path.Combine(root, Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stage);
            try {
                bool copied = false;
                foreach (string name in new string[] { product, appId.ToLowerInvariant() }) {
                    if (name == "." || name == ".." || name.Length == 0 || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) continue;
                    string source = Path.Combine(roaming, name, "Local Storage", "leveldb");
                    if (!File.Exists(Path.Combine(source, "CURRENT"))) continue;
                    string dest = Path.Combine(stage, "EBWebView", "Default", "Local Storage", "leveldb");
                    Directory.CreateDirectory(dest);
                    // LevelDB uses a byte-range lock on Windows. Keep the game closed
                    // while copying rather than racing a writer or a compaction.
                    FileStream guard;
                    try { guard = File.Open(Path.Combine(source, "LOCK"), FileMode.Open, FileAccess.Read, FileShare.None); }
                    catch (FileNotFoundException) { guard = null; } // Some clean backups omit the transient lock.
                    catch (IOException err) { throw new IOException("Close the previous Electron game and reopen this game to import its saves.", err); }
                    using (guard) {
                        foreach (string file in Directory.GetFiles(source)) {
                            string leaf = Path.GetFileName(file);
                            if (leaf == "LOCK" || leaf.StartsWith("LOG", StringComparison.Ordinal)) continue;
                            File.Copy(file, Path.Combine(dest, leaf));
                        }
                    }
                    File.WriteAllText(Path.Combine(stage, "import-pending"), "");
                    copied = true;
                    break;
                }
                Directory.Move(stage, profile);
                return copied;
            } finally {
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
            }
        }
    }
}
