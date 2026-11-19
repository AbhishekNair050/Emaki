using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;

namespace Emaki {
    internal static class PackWriter {
        private static IEnumerable<string> Files(string folder) {
            foreach (string path in Directory.EnumerateFileSystemEntries(folder)) {
                var attr = File.GetAttributes(path);
                if ((attr & FileAttributes.ReparsePoint) != 0) throw new IOException("Linked game asset: " + path);
                if ((attr & FileAttributes.Directory) != 0) {
                    foreach (string child in Files(path)) yield return child;
                } else yield return path;
            }
        }
        private static void Seal(Stream output, byte[] plain, int count, Aes aes, byte[] macKey) {
            aes.GenerateIV();
            byte[] encrypted;
            using (var transform = aes.CreateEncryptor())
                encrypted = transform.TransformFinalBlock(plain, 0, count);
            var record = new byte[16 + encrypted.Length];
            Buffer.BlockCopy(aes.IV, 0, record, 0, 16);
            Buffer.BlockCopy(encrypted, 0, record, 16, encrypted.Length);
            var tag = Pack.Tag(macKey, output.Position, record, record.Length);
            output.Write(record, 0, record.Length);
            output.Write(tag, 0, tag.Length);
        }
        internal static void Write(string root, string dest, byte[] keys) {
            root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!File.Exists(Path.Combine(root, "index.html"))) throw new IOException("Missing index.html.");
            var buffer = new byte[Pack.Chunk];
            var enc = new byte[32];
            var mac = new byte[32];
            Buffer.BlockCopy(keys, 0, enc, 0, 32);
            Buffer.BlockCopy(keys, 32, mac, 0, 32);
            using (var output = new FileStream(dest, FileMode.CreateNew))
            using (var index = new MemoryStream())
            using (var writer = new BinaryWriter(index, Pack.Utf8))
            using (var aes = Aes.Create()) {
                aes.Key = enc;
                output.Write(Pack.Magic, 0, Pack.Magic.Length);
                int count = 0;
                writer.Write(count);
                foreach (string path in Files(root)) {
                    using (var input = File.OpenRead(path)) {
                        writer.Write(path.Substring(root.Length).Replace(Path.DirectorySeparatorChar, '/'));
                        writer.Write(input.Length);
                        for (long left = input.Length; left > 0;) {
                            int n = (int)Math.Min(buffer.Length, left);
                            Pack.ReadFully(input, buffer, n);
                            Seal(output, buffer, n, aes, mac);
                            left -= n;
                        }
                    }
                    if (++count > 1000000 || index.Length > Pack.MaxIndex) throw new IOException("Game exceeds the pack index limit.");
                }
                index.Position = 0;
                writer.Write(count);
                long indexOffset = output.Position;
                Seal(output, index.GetBuffer(), (int)index.Length, aes, mac);
                new BinaryWriter(output).Write(indexOffset);
            }
        }
        private static int Main(string[] args) {
            try { Write(args[0], args[1], File.ReadAllBytes(args[2])); return 0; }
            catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
        }
    }
}
