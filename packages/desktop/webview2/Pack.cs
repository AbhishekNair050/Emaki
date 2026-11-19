using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Emaki {
    // File layout: signature, sealed asset chunks, sealed index, index offset (LE).
    // Each record is a random IV, AES-256-CBC ciphertext, and HMAC-SHA256 over
    // its absolute offset + IV + ciphertext. The two keys are independent.
    internal sealed class Pack : IDisposable {
        internal const int Chunk = 256 * 1024;
        internal const int MaxIndex = 64 * 1024 * 1024;
        internal static readonly byte[] Magic = Encoding.ASCII.GetBytes("EMAKIP01");
        internal static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        internal sealed class Entry {
            internal long Offset, Size;
        }
        private readonly FileStream file;
        private readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
        private readonly byte[] aesKey = new byte[32], macKey = new byte[32];
        internal event Action<Exception> ReadFailed;

        internal Pack(string path, byte[] keys) {
            if (keys.Length != 64) throw new InvalidDataException("Invalid game key.");
            Buffer.BlockCopy(keys, 0, aesKey, 0, 32);
            Buffer.BlockCopy(keys, 32, macKey, 0, 32);
            file = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            try {
                using (var reader = new BinaryReader(file, Utf8, true)) {
                    if (file.Length < Magic.Length + 64 + 8 || !Equal(reader.ReadBytes(Magic.Length), Magic)) throw Invalid();
                    file.Position = file.Length - 8;
                    long index = reader.ReadInt64();
                    if (index < Magic.Length || index > file.Length - 8 - 64) throw Invalid();
                    long length = file.Length - 8 - index;
                    if (length > RecordSize(MaxIndex)) throw Invalid();
                    using (var data = new BinaryReader(new MemoryStream(Unseal(index, (int)length)), Utf8)) {
                        int count = data.ReadInt32();
                        if (count < 1 || count > 1000000) throw Invalid();
                        long offset = Magic.Length;
                        for (int i = 0; i < count; i++) {
                            string name = data.ReadString();
                            long size = data.ReadInt64();
                            if (size < 0 || size > index || entries.ContainsKey(name)) throw Invalid();
                            entries.Add(name, new Entry { Offset = offset, Size = size });
                            offset = checked(offset + (size / Chunk) * RecordSize(Chunk));
                            if (size % Chunk != 0) offset = checked(offset + RecordSize((int)(size % Chunk)));
                            if (offset > index) throw Invalid();
                        }
                        if (offset != index || data.BaseStream.Position != data.BaseStream.Length || !entries.ContainsKey("index.html")) throw Invalid();
                    }
                }
            } catch { file.Dispose(); throw; }
        }
        internal static InvalidDataException Invalid() { return new InvalidDataException("The game pack is damaged or belongs to a different executable."); }
        internal static int RecordSize(int plain) { return 16 + (plain / 16 + 1) * 16 + 32; }
        private static bool Equal(byte[] a, byte[] b) {
            if (a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }
        internal static byte[] Tag(byte[] key, long offset, byte[] bytes, int count) {
            using (var h = new HMACSHA256(key)) {
                byte[] prefix = BitConverter.GetBytes(offset);
                h.TransformBlock(prefix, 0, prefix.Length, prefix, 0);
                h.TransformFinalBlock(bytes, 0, count);
                return h.Hash;
            }
        }
        private byte[] Unseal(long offset, int length) {
            byte[] record = new byte[length];
            lock (file) {
                file.Position = offset;
                ReadFully(file, record, length);
            }
            byte[] tag = new byte[32], iv = new byte[16];
            Buffer.BlockCopy(record, length - 32, tag, 0, 32);
            if (!Equal(tag, Tag(macKey, offset, record, length - 32))) throw Invalid();
            Buffer.BlockCopy(record, 0, iv, 0, 16);
            using (var aes = Aes.Create())
            using (var decrypt = aes.CreateDecryptor(aesKey, iv))
                return decrypt.TransformFinalBlock(record, 16, length - 48);
        }
        internal static void ReadFully(Stream source, byte[] buffer, int count) {
            for (int at = 0; at < count;) {
                int n = source.Read(buffer, at, count - at);
                if (n == 0) throw new EndOfStreamException();
                at += n;
            }
        }
        internal Entry Find(string path) {
            Entry entry;
            return entries.TryGetValue(path, out entry) ? entry : null;
        }
        internal Stream Open(Entry entry, long start, long length) {
            if (start < 0 || length < 0 || start > entry.Size - length) throw new ArgumentOutOfRangeException();
            return new AssetStream(this, entry, start, length);
        }
        public void Dispose() { file.Dispose(); }

        // WebView2 reads responses lazily and can seek. Each response caches one
        // authenticated chunk and shares the read-only file with other responses.
        private sealed class AssetStream : Stream {
            private readonly Pack pack;
            private readonly Entry entry;
            private readonly long start, length;
            private long position, cached = -1;
            private byte[] chunk;
            internal AssetStream(Pack p, Entry e, long s, long n) { pack = p; entry = e; start = s; length = n; }
            public override int Read(byte[] buffer, int offset, int count) {
                if (buffer == null || offset < 0 || count < 0 || offset > buffer.Length - count) throw new ArgumentException();
                int total = 0;
                while (count > 0 && position < length) {
                    long at = start + position, index = at / Chunk;
                    if (cached != index) {
                        int size = (int)Math.Min(Chunk, entry.Size - index * Chunk);
                        try {
                            chunk = pack.Unseal(entry.Offset + index * RecordSize(Chunk), RecordSize(size));
                            if (chunk.Length != size) throw Invalid();
                        } catch (IOException err) { pack.Report(err); throw; }
                          catch (InvalidDataException err) { pack.Report(err); throw; }
                        cached = index;
                    }
                    int inside = (int)(at % Chunk);
                    int n = (int)Math.Min(Math.Min(count, chunk.Length - inside), length - position);
                    Buffer.BlockCopy(chunk, inside, buffer, offset, n);
                    total += n; offset += n; count -= n; position += n;
                }
                return total;
            }
            public override long Seek(long delta, SeekOrigin origin) {
                Position = checked((origin == SeekOrigin.Begin ? 0 : origin == SeekOrigin.Current ? position : length) + delta);
                return position;
            }
            public override long Position { get { return position; } set { if (value < 0) throw new IOException(); position = value; } }
            public override long Length { get { return length; } }
            public override bool CanRead { get { return true; } }
            public override bool CanSeek { get { return true; } }
            public override bool CanWrite { get { return false; } }
            public override void Flush() {}
            public override void SetLength(long value) { throw new NotSupportedException(); }
            public override void Write(byte[] b, int o, int n) { throw new NotSupportedException(); }
        }
        private void Report(Exception err) {
            var handler = ReadFailed;
            if (handler != null) handler(err);
        }
    }
}
