using System;
using System.Globalization;
using System.IO;
using System.Web;

namespace Emaki {
    internal sealed class Resource {
        internal int Status;
        internal string Reason, Headers;
        internal Stream Body;
        private Resource(int status, string reason, string headers, Stream body) {
            Status = status; Reason = reason; Body = body;
            Headers = "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n" + headers;
        }
        internal static bool GameUri(string url) {
            Uri uri;
            return Uri.TryCreate(url, UriKind.Absolute, out uri) && uri.Scheme == "https" &&
                uri.Host == "game.emaki.invalid" && uri.IsDefaultPort && uri.UserInfo.Length == 0;
        }
        internal static Resource Serve(Pack pack, string url, string method, string range) {
            if (!GameUri(url)) return new Resource(403, "Forbidden", "", null);
            if (method != "GET" && method != "HEAD") return new Resource(405, "Method Not Allowed", "Allow: GET, HEAD\r\n", null);
            string path = Uri.UnescapeDataString(new Uri(url).AbsolutePath.Substring(1));
            if (path == "") path = "index.html";
            var entry = pack.Find(path);
            if (entry == null) return new Resource(404, "Not Found", "", null);
            long first = 0, last = entry.Size - 1;
            string headers = "Content-Type: " + Mime(path) + "\r\nAccept-Ranges: bytes\r\n";
            bool partial = method == "GET" && !String.IsNullOrEmpty(range) && range.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase) && !range.Contains(",");
            if (partial) {
                if (!Range(range.Substring(6), entry.Size, out first, out last))
                    return new Resource(416, "Range Not Satisfiable", headers + "Content-Range: bytes */" + entry.Size + "\r\n", null);
                headers += String.Format(CultureInfo.InvariantCulture, "Content-Range: bytes {0}-{1}/{2}\r\n", first, last, entry.Size);
            }
            long length = last - first + 1;
            headers += "Content-Length: " + length.ToString(CultureInfo.InvariantCulture) + "\r\n";
            return new Resource(partial ? 206 : 200, partial ? "Partial Content" : "OK", headers,
                method == "HEAD" ? null : pack.Open(entry, first, length));
        }
        private static bool Range(string value, long size, out long start, out long end) {
            start = 0; end = size - 1;
            var parts = value.Trim().Split('-');
            if (parts.Length != 2 || size == 0) return false;
            long number;
            if (parts[0] == "") {
                if (!Number(parts[1], out number) || number == 0) return false;
                start = Math.Max(0, size - number);
            } else {
                if (!Number(parts[0], out start) || start >= size) return false;
                if (parts[1] != "") {
                    if (!Number(parts[1], out number) || number < start) return false;
                    end = Math.Min(end, number);
                }
            }
            return true;
        }
        private static bool Number(string text, out long value) {
            return Int64.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value);
        }
        private static string Mime(string path) {
            switch (Path.GetExtension(path).ToLowerInvariant()) {
                case ".js": case ".mjs": return "text/javascript";
                case ".json": return "application/json";
                case ".svg": return "image/svg+xml";
                case ".webp": return "image/webp";
                case ".avif": return "image/avif";
                case ".woff2": return "font/woff2";
                case ".ogg": case ".opus": return "audio/ogg";
                case ".webm": return "video/webm";
                case ".wasm": return "application/wasm";
                default: return MimeMapping.GetMimeMapping(path);
            }
        }
    }
}
