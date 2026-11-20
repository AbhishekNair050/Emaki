# Exporting your game

One command turns a game folder into something players can run. Everything goes into `<game>/export/`, which git ignores.

You can also use **Export game** in the project launcher (`npm run launch`). Pick Web, Desktop, Android or iOS, then Export. Build output appears below the controls; once it finishes, **Show export folder** opens the output location. Desktop uses your computer's platform and architecture; Android and iOS make projects for Android Studio and Xcode (an APK too when the Android SDK is installed). For cross-platform desktop builds and the options below, use the commands.

```sh
npm run export -- web     games/mygame    # a website (itch.io, any host)
npm run export -- desktop games/mygame    # a Windows, macOS or Linux app
npm run export -- android games/mygame    # an Android Studio project (and an APK if the Android SDK is installed)
npm run export -- ios     games/mygame    # an Xcode project (building needs a Mac)
```

The game must compile without errors first (`npm run emaki -- check games/mygame/story.vn`).

**What's been tested.** Web and Windows exports are tested. macOS and Linux apps are built the same way but haven't been tried on those systems yet; Steam support and the Android APK build are written but not yet tested against real Steam or on a device. Reports from anyone who tries them are very welcome.

## What the export reads from your story's header
```
---
title: The Keeper of Gullwing Point
author: Lighthouse Games
version: 1.2
app_id: com.lighthousegames.gullwing
steam_app_id: 1234560
language: en
---
```
| Key | Used for |
|---|---|
| `title` | Window title, app name, file names. |
| `author` | Shown on the title screen; the desktop app's publisher. |
| `version` | The app's version (`1.2` becomes `1.2.0`). |
| `app_id` | Your app's id in app stores, in reverse-domain form. **Set this before you publish to phones**: it can never change afterwards. Without it the export uses `com.emaki.<title>`. |
| `steam_app_id` | Turns on Steam in the desktop app (see below). |
| `language` | The language the script is written in (for the language menu). |

Put a square `icon.png` (512×512 or larger) in the game folder to give the desktop app its icon. Phone icons are set in Android Studio and Xcode (Image Asset / App Icon).

## Web
`export web` makes a static site in `export/web/`. Zip the folder's contents and upload it to itch.io as an HTML game ("This file will be played in the browser"), or put it on any web host. Saves stay in the player's browser.

## Desktop (Windows, macOS, Linux)
`export desktop` selects WebView2 for Windows x64 games built on Windows. Games with a `steam_app_id`, other desktop targets and cross-builds use Electron. The project launcher makes the same selection. To choose a shell explicitly:

```sh
npm run export -- desktop games/gullwing --platform win32 --arch x64 --shell webview2
npm run export -- desktop games/gullwing --shell electron
```

Both shells open the window in the game's shape (`aspect:` in the story header, 16:9 unless set): the largest size of that shape within 1280×720, so 960×720 for a 4:3 game, made smaller to fit the screen. Sizes are the inside of the window, in display-independent pixels. A size the player chooses is remembered; one saved for another shape, by a release before the window followed the game's, is set aside.

### Windows with WebView2

Distribute the whole `export/desktop/<Title>-win32-x64-webview2/` folder. It contains the game's executable, `game.emaki` and Microsoft's small WebView2 support libraries. The player uses the shared Evergreen WebView2 Runtime and .NET Framework 4.8 on Windows 10/11. On a machine missing WebView2, the game offers Microsoft's installer. For offline installations, distribute Microsoft's Evergreen standalone installer alongside your game. [Microsoft's deployment guide](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)

The first export downloads the pinned Microsoft.Web.WebView2 SDK (1.0.2903.40) from NuGet, checks it against the SHA-512 NuGet publishes, and caches it under `%LOCALAPPDATA%\Emaki\SDK`. Windows' .NET Framework C# compiler builds the shell. For offline authoring set `EMAKI_WEBVIEW2_SDK` to the extracted Microsoft.Web.WebView2 1.0.2903.40 package, with its `lib/net462` and `runtimes/win-x64/native` folders and `LICENSE.txt`. The SDK's DLLs ship with every game, so an export stops if they are another version or the license is missing.

The exporter encrypts the directory and contents of the pack with a fresh key per build. The player authenticates and decrypts 256 KiB chunks on demand, including for movie and music seeking, and asks the webview to keep responses out of its HTTP cache. Developer tools are off, and the player ignores the `WEBVIEW2_*` environment variables that would open a debugging port or swap the browser. Ship the executable and pack from the same export together. This deters casual extraction. Someone who controls the computer can recover the key or capture assets during playback. A separate web export still contains ordinary web assets, so upload only the `-webview2` folder.

The player behaves like the Electron app: it opens in the game's shape and remembers its size and full screen, follows each monitor's display scaling (so text stays sharp at 125% or 150%), focuses the open window on a second launch, opens links in the browser, and doesn't zoom with Ctrl+wheel. F11 and Alt+Enter toggle full screen. Steam games use Electron, since achievements and the overlay need Steamworks.

The player keeps saves and settings under `%LOCALAPPDATA%\Emaki\<game-id-hash>\`. Keep the story title and `app_id` stable across releases. On first launch the player looks for the former Electron game's local storage under the same Windows account, copies it to a fresh profile and imports Emaki keys. Close the Electron game first so its database can be copied consistently. The original profile stays available to the old release.

Windows SmartScreen and some antivirus programs are wary of new, unsigned programs. Before a wide release, sign the executable with a code-signing certificate (`signtool sign /fd sha256 /tr <timestamp server> /td sha256 "<Title>.exe"`). The pack needs no signature: the player rejects any change to it.

### Desktop with Electron

The finished app is in `export/desktop/<Title>-<platform>-<arch>/`. Zip that folder for itch.io, or upload it to Steam.

- Build for another system with `--platform win32|darwin|linux` and `--arch x64|arm64`. Electron for that system is downloaded the first time (about 100 MB).
- The window has the game's shape (`aspect:` in the story header): 1280×720 inside for 16:9, 960×720 for 4:3, and smaller if the screen can't hold it. It remembers the size the player gives it, and goes full screen with **F11** or **Alt+Enter** (also in Settings). The title screen has a **Quit** button.
- Saves live in the player's app-data folder, like any PC game.
- **macOS:** apps from the internet must be signed and notarized with an Apple Developer account, or players have to right-click → Open the first time. Use Apple's `codesign` and `notarytool` on the `.app`; Emaki doesn't do this for you yet.
- **Size:** a desktop build is about 300 MB unpacked (around 110 MB zipped). Almost all of it is Electron itself (the browser engine). Chromium's own translations are trimmed to English plus your game's languages.

### Steam
Add `steam_app_id: <your App ID>` to the header and export again. The desktop app then includes [steamworks.js](https://github.com/ceifa/steamworks.js) and:

- connects to Steam when the game starts (the Steam overlay works, Shift+Tab);
- unlocks the Steam achievement with the same id whenever your story runs `achieve <id>`. Create the achievements in Steamworks with exactly the ids from your `achievement` lines.

If Steam isn't running (or the game is started outside Steam), the game plays normally and keeps achievements itself. Upload the exported folder as your depot's content, with the executable as the launch option. Testing tip: while Steam is running, a build with Valve's public test App ID `480` (Spacewar) connects to Steam and shows the overlay, so you can check the setup before your own app is ready. (Spacewar's achievements have different ids, so yours won't unlock there.)

## Android
`export android` creates (the first time) a full Android Studio project in `export/mobile/`, then copies your game into it. Later exports only refresh the game, so anything you change in Android Studio (icons, signing, store settings) is kept.

- **With the Android SDK and Java 21 or newer installed** (Android Studio comes with both; otherwise set `JAVA_HOME` to a JDK 21), the export also builds `export/mobile/<Title>-debug.apk`, which you can install on a phone for testing (`adb install -r <file>`). Use `--no-build` to skip that.
- **To publish:** open the project (`npx cap open android` in `export/mobile`) and use *Build → Generate Signed App Bundle* for Google Play.
- On phones the game fills the screen (the status bar is hidden), and the **back button** closes menus, then asks before leaving the story, then quits from the title screen.
- **Which way up:** the header's `orientation:` decides how the app turns. `landscape` keeps it sideways (either way round), `portrait` upright, and `any` follows the phone. Without the line, a game with a `canvas:` is `landscape` (its art can only be letterboxed upright) and other games are `any` (held upright, they use the portrait layout). Every export writes this into the app (the main activity on Android, Info.plist on iOS), so change it in the header rather than in Android Studio or Xcode.

## iOS
`export ios` prepares the same project for iOS. Apple only allows building iOS apps on a Mac: on Windows or Linux, export, copy `export/mobile/` to a Mac, then run `npx cap add ios` and `npx cap open ios` there (Xcode required). On a Mac the export does those steps for you.

## Translations
Exports include every translation in `lang/` (see [Translations](script-syntax.md#translations)). Players choose a language in Settings; by default the game follows the device's language.
