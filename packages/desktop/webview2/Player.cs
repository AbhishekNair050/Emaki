using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Emaki {
    internal sealed class Player : Form {
        internal const string Home = "https://game.emaki.invalid/";
        private const string OldOrigin = "app://game/emaki-import";
        private const string ImportPage = Home + "__emaki_import__";
        private readonly WebView2 view = new WebView2();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
        private readonly Pack pack;
        private readonly string root, appId, product;
        private Rectangle normal;
        // The window's shape from the export (src/window.ts): opening width and
        // height, then the smallest, in display-independent pixels for the
        // inside of the window. frame: the title bar and borders around it.
        private readonly int[] shape;
        private readonly double aspect;
        private Size frame;
        private bool fullscreen, importing, failed;
        private FormWindowState previousState;
        private string legacyData;
        private static uint activateMessage;
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern uint RegisterWindowMessage(string name);
        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr window, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern uint GetDpiForWindow(IntPtr window);
        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr window, out Rect rect);
        [DllImport("user32.dll")]
        private static extern bool GetClientRect(IntPtr window, out Rect rect);
        private const int DpiChanged = 0x02E0;
        [StructLayout(LayoutKind.Sequential)]
        private struct Rect { public int Left, Top, Right, Bottom; }
        // WebView2 reads these from the environment ahead of the options the
        // player passes. One opens a debugging port onto the decrypted game,
        // others swap the browser or the profile: the game runs without them.
        private static readonly string[] WebViewOverrides = {
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", "WEBVIEW2_USER_DATA_FOLDER",
            "WEBVIEW2_RELEASE_CHANNEL_PREFERENCE", "WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER", "WEBVIEW2_WAIT_FOR_SCRIPT_DEBUGGER",
        };
        private CoreWebView2 Core { get { return view.CoreWebView2; } }

        private Player(Pack pack, string root, string title, string appId, string product, int[] shape) {
            this.pack = pack; this.root = root; this.appId = appId; this.product = product;
            this.shape = shape; aspect = (double)shape[0] / shape[1];
            Text = title; BackColor = Color.Black;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            StartPosition = FormStartPosition.Manual;
            // The window has the game's shape, in display-independent pixels as in
            // Electron: 1280×720 for a 16:9 game at 100% (1920×1080 at 150%),
            // 960×720 for 4:3.
            Load += (s, e) => {
                // Onto the display it opens on (the primary one, as Electron)
                // before measuring: the hidden window starts at a default spot
                // whose scaling can differ, and moving it later would rescale it.
                var area = Screen.PrimaryScreen.WorkingArea;
                Location = area.Location;
                float scale = DisplayScale();
                frame = RealFrame();
                MinimumSize = Pixels(shape[2], shape[3], scale) + frame;
                bool full;
                Size? saved = RestoreWindow(scale, out full);
                Size = (saved.HasValue ? Fit(saved.Value, 1f) : Fit(Pixels(shape[0], shape[1], scale), 0.9f)) + frame;
                Location = new Point(area.X + Math.Max(0, (area.Width - Width) / 2), area.Y + Math.Max(0, (area.Height - Height) / 2));
                if (full) SetFullscreen(true);
            };
            view.Dock = DockStyle.Fill; view.DefaultBackgroundColor = Color.Black;
            Controls.Add(view);
            pack.ReadFailed += ReportReadError;
            FormClosed += (s, e) => pack.ReadFailed -= ReportReadError;
            Shown += async (s, e) => {
                try {
                    Task start = StartPlayer();
                    if (await Task.WhenAny(start, Task.Delay(60000)) != start)
                        throw new IOException("WebView2 could not start the game within a minute. Restart the game or repair Microsoft Edge WebView2 Runtime.");
                    await start;
                }
                catch (WebView2RuntimeNotFoundException err) {
                    Console.Error.WriteLine(err);
                    if (MessageBox.Show(this, "This game needs Microsoft Edge WebView2 Runtime. Download Microsoft's installer, install it, and reopen the game?", Text, MessageBoxButtons.YesNo) == DialogResult.Yes)
                        OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                    Close();
                } catch (Exception err) { Fail(err); }
            };
            FormClosing += (s, e) => SaveWindow();
        }
        private void Fail(Exception err) {
            if (IsDisposed || failed) return;
            failed = true;
            Console.Error.WriteLine(err);
            // Without a desktop to show it on (a service, a CI runner), the dialog
            // itself throws, which would leave the window open on a blank page.
            if (Environment.UserInteractive)
                try { MessageBox.Show(this, err.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error); }
                catch (InvalidOperationException) {}
            Close();
        }
        private void ReportReadError(Exception err) {
            if (IsHandleCreated && !IsDisposed) BeginInvoke(new Action(() => Fail(err)));
        }
        protected override void WndProc(ref Message message) {
            if (activateMessage != 0 && message.Msg == activateMessage) {
                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                Activate();
            }
            // Moved to a monitor with other scaling: take the size Windows
            // suggests, which keeps the window the same size to the eye.
            if (message.Msg == DpiChanged && !fullscreen) {
                var r = (Rect)Marshal.PtrToStructure(message.LParam, typeof(Rect));
                MinimumSize = Size.Empty;
                Bounds = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
                frame = RealFrame();
                MinimumSize = Pixels(shape[2], shape[3], (message.WParam.ToInt64() & 0xffff) / 96f) + frame;
            }
            base.WndProc(ref message);
        }
        private float DisplayScale() {
            try { uint dpi = GetDpiForWindow(Handle); if (dpi > 0) return dpi / 96f; }
            catch (EntryPointNotFoundException) {} // Windows 10 before 1607: the system DPI
            using (var g = CreateGraphics()) return g.DpiX / 96f;
        }
        private static Size Pixels(int width, int height, float scale) {
            return new Size((int)Math.Round(width * scale), (int)Math.Round(height * scale));
        }
        // The title bar and borders as Windows draws them. WinForms' own
        // ClientSize works this out from older rules and is a pixel off, which
        // grew the window by a pixel or two at each launch.
        private Size RealFrame() {
            Rect outer, inner;
            if (!GetWindowRect(Handle, out outer) || !GetClientRect(Handle, out inner)) return Size - ClientSize;
            return new Size((outer.Right - outer.Left) - (inner.Right - inner.Left), (outer.Bottom - outer.Top) - (inner.Bottom - inner.Top));
        }
        /// <summary>The inside size, made smaller with the same shape if the window wouldn't fit that share of the screen.</summary>
        private Size Fit(Size client, float share) {
            var area = Screen.FromControl(this).WorkingArea;
            float fit = Math.Min(1f, Math.Min((area.Width * share - frame.Width) / client.Width, (area.Height * share - frame.Height) / client.Height));
            return new Size((int)Math.Round(client.Width * fit), (int)Math.Round(client.Height * fit));
        }
        private async Task StartPlayer() {
            string profile = Path.Combine(root, "player");
            importing = Profile.Prepare(root, Environment.GetEnvironmentVariable("APPDATA") ?? Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), product, appId);
            var scheme = new CoreWebView2CustomSchemeRegistration("app") { TreatAsSecure = true, HasAuthorityComponent = true };
            var options = new CoreWebView2EnvironmentOptions(null, null, null, false,
                new List<CoreWebView2CustomSchemeRegistration> { scheme });
            var env = await CoreWebView2Environment.CreateAsync(null, profile, options);
            await view.EnsureCoreWebView2Async(env);
            Core.Settings.AreDevToolsEnabled = false;
            Core.Settings.AreDefaultContextMenusEnabled = false;
            Core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            Core.Settings.AreHostObjectsAllowed = false;
            Core.Settings.IsPasswordAutosaveEnabled = false;
            Core.Settings.IsGeneralAutofillEnabled = false;
            Core.Settings.IsStatusBarEnabled = false;
            // As in Electron: Ctrl+wheel, pinch and swipe don't zoom the game or go back.
            Core.Settings.IsZoomControlEnabled = false;
            Core.Settings.IsPinchZoomEnabled = false;
            Core.Settings.IsSwipeNavigationEnabled = false;
            Core.AddWebResourceRequestedFilter(Home + "*", CoreWebView2WebResourceContext.All);
            Core.AddWebResourceRequestedFilter(OldOrigin, CoreWebView2WebResourceContext.All);
            Core.WebResourceRequested += (s, e) => {
                var req = e.Request;
                if (importing && (req.Uri == OldOrigin || req.Uri == ImportPage)) {
                    e.Response = env.CreateWebResourceResponse(new MemoryStream(System.Text.Encoding.UTF8.GetBytes("<!doctype html><title>Loading saves</title>")), 200, "OK", "Content-Type: text/html\r\nCache-Control: no-store");
                    return;
                }
                var r = Resource.Serve(pack, req.Uri, req.Method, req.Headers.Contains("Range") ? req.Headers.GetHeader("Range") : null);
                e.Response = env.CreateWebResourceResponse(r.Body, r.Status, r.Reason, r.Headers);
            };
            Core.NavigationStarting += (s, e) => {
                if (Resource.GameUri(e.Uri) || (importing && e.Uri == OldOrigin)) return;
                e.Cancel = true;
                if (e.IsUserInitiated) OpenExternal(e.Uri);
            };
            Core.NewWindowRequested += (s, e) => { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri); };
            Core.PermissionRequested += (s, e) => { e.State = CoreWebView2PermissionState.Deny; };
            Core.DownloadStarting += (s, e) => { e.Cancel = true; };
            Core.WindowCloseRequested += (s, e) => Close();
            Core.WebMessageReceived += OnMessage;
            Core.ProcessFailed += (s, e) => {
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited)
                    BeginInvoke(new Action(() => Fail(new IOException("The WebView2 player stopped. Reopen the game to continue from your last save."))));
            };
            Core.NavigationCompleted += async (s, e) => {
                if (!importing) return;
                try {
                    if (!e.IsSuccess) throw new IOException("Could not open the saved-game profile for import.");
                    if (Core.Source == OldOrigin) {
                        legacyData = await Core.ExecuteScriptAsync("Object.entries(localStorage).filter(([key]) => key.startsWith('emaki:'))");
                        if (legacyData == null || !legacyData.StartsWith("[")) throw new IOException("Could not read the previous game's saves.");
                        Core.Navigate(ImportPage);
                    } else if (Core.Source == ImportPage) {
                        // Install only missing keys. Interrupted imports can be retried.
                        var ok = await Core.ExecuteScriptAsync("(() => { for (const [k,v] of JSON.parse(" + json.Serialize(legacyData) + ")) if(localStorage.getItem(k)===null) localStorage.setItem(k,v); return true })()");
                        if (ok != "true") throw new IOException("Could not import the previous game's saves.");
                        File.Delete(Path.Combine(profile, "import-pending"));
                        importing = false; legacyData = null; Core.Navigate(Home);
                    }
                } catch (Exception err) { Fail(err); }
            };
            var asm = Assembly.GetExecutingAssembly();
            using (var reader = new StreamReader(asm.GetManifestResourceStream("bridge.js")))
                await Core.AddScriptToExecuteOnDocumentCreatedAsync(reader.ReadToEnd());
            Core.Navigate(importing ? OldOrigin : Home);
        }
        private void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
            if (!Resource.GameUri(e.Source)) return;
            var message = json.DeserializeObject(e.WebMessageAsJson) as Dictionary<string, object>;
            if (message == null || !message.ContainsKey("action")) return;
            switch (message["action"] as string) {
                case "quit": BeginInvoke(new Action(Close)); return;
                case "toggle": SetFullscreen(!fullscreen); return;
                case "set":
                    if (!message.ContainsKey("on") || !(message["on"] is bool)) return;
                    SetFullscreen((bool)message["on"]); break;
                case "get": break;
                default: return;
            }
            if (message.ContainsKey("id") && message["id"] is int)
                Core.PostWebMessageAsJson(json.Serialize(new { id = message["id"], fullscreen = fullscreen }));
        }
        private static void OpenExternal(string url) {
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || (uri.Scheme != "https" && uri.Scheme != "http")) return;
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
            catch (System.ComponentModel.Win32Exception) {}
        }
        private void SetFullscreen(bool on) {
            if (fullscreen == on) return;
            if (on) {
                previousState = WindowState;
                normal = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                var screen = Screen.FromControl(this);
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.None; Bounds = screen.Bounds;
            } else {
                FormBorderStyle = FormBorderStyle.Sizable; Bounds = normal; WindowState = previousState;
            }
            fullscreen = on;
        }
        // The inside of the window in display-independent pixels, whether it
        // was full screen, and the game's shape, like Electron's window.json.
        private void SaveWindow() {
            try {
                var bounds = fullscreen ? normal : WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                var client = bounds.Size - frame;
                float scale = DisplayScale();
                File.WriteAllLines(Path.Combine(root, "window"), new string[] {
                    ((int)Math.Round(client.Width / scale)).ToString(CultureInfo.InvariantCulture),
                    ((int)Math.Round(client.Height / scale)).ToString(CultureInfo.InvariantCulture), fullscreen.ToString(),
                    aspect.ToString("R", CultureInfo.InvariantCulture) });
            } catch (IOException) {} catch (UnauthorizedAccessException) {}
        }
        /// <summary>The saved inside size in pixels, if there is one for this shape; full: whether to go full screen.</summary>
        private Size? RestoreWindow(float scale, out bool full) {
            full = false;
            try {
                string path = Path.Combine(root, "window");
                if (!File.Exists(path)) return null;
                string[] parts = File.ReadAllLines(path);
                int w, h; double saved;
                if (parts.Length < 3 || !Int32.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out w) ||
                    !Int32.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out h)) return null;
                Boolean.TryParse(parts[2], out full);
                // A size saved for another shape (an earlier release, before the
                // window followed the game's) would bring the black bars back.
                if (parts.Length != 4 || !Double.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out saved) ||
                    Math.Abs(saved - aspect) >= 0.01 || w <= 0 || h <= 0) return null;
                return Pixels(Math.Max(shape[2], w), Math.Max(shape[3], h), scale);
            } catch (IOException) { return null; } catch (UnauthorizedAccessException) { return null; }
        }
        [STAThread]
        private static void Main() {
            foreach (string name in WebViewOverrides) Environment.SetEnvironmentVariable(name, null);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try {
                var asm = Assembly.GetExecutingAssembly();
                CoreWebView2Environment.SetLoaderDllFolderPath(AppDomain.CurrentDomain.BaseDirectory);
                byte[] key = new byte[64];
                using (var stream = asm.GetManifestResourceStream("key")) Pack.ReadFully(stream, key, key.Length);
                string[] meta;
                using (var reader = new StreamReader(asm.GetManifestResourceStream("game.json")))
                    meta = new JavaScriptSerializer().Deserialize<string[]>(reader.ReadToEnd());
                int[] shape = { 1280, 720, 480, 270 };
                if (meta.Length >= 7)
                    for (int i = 0; i < 4; i++) shape[i] = Int32.Parse(meta[3 + i], CultureInfo.InvariantCulture);
                string id = Profile.Id(meta[1]);
                activateMessage = RegisterWindowMessage("Emaki.Activate." + id);
                bool first;
                using (var mutex = new Mutex(true, "Local\\Emaki-" + id, out first)) {
                    if (!first) {
                        if (activateMessage != 0) PostMessage(new IntPtr(0xffff), activateMessage, IntPtr.Zero, IntPtr.Zero);
                        return;
                    }
                    string local = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    string root = Path.Combine(local, "Emaki", id);
                    using (var pack = new Pack(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "game.emaki"), key))
                    using (var player = new Player(pack, root, meta[0], meta[1], meta[2], shape)) Application.Run(player);
                }
            } catch (Exception err) {
                Console.Error.WriteLine(err);
                MessageBox.Show(err.Message, "Emaki", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
