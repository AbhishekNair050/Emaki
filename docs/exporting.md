# Exporting your game

One command turns a game folder into something players can run. Everything goes into `<game>/export/`, which git ignores.

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
`export desktop` wraps the web build in [Electron](https://www.electronjs.org/): `export/desktop/<Title>-<platform>-<arch>/` holds the finished app. Zip that folder for itch.io, or upload it to Steam.

- Build for another system with `--platform win32|darwin|linux` and `--arch x64|arm64`. Electron for that system is downloaded the first time (about 100 MB).
- The app opens at 1280×720, remembers its size, and goes full screen with **F11** or **Alt+Enter** (also in Settings). The title screen has a **Quit** button.
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

- **With the Android SDK installed** (Android Studio installs it), the export also builds `export/mobile/<Title>-debug.apk`, which you can install on a phone for testing (`adb install -r <file>`). Use `--no-build` to skip that.
- **To publish:** open the project (`npx cap open android` in `export/mobile`) and use *Build → Generate Signed App Bundle* for Google Play.
- On phones the game fills the screen (the status bar is hidden), works upright or sideways, and the **back button** closes menus, then asks before leaving the story, then quits from the title screen.

## iOS
`export ios` prepares the same project for iOS. Apple only allows building iOS apps on a Mac: on Windows or Linux, export, copy `export/mobile/` to a Mac, then run `npx cap add ios` and `npx cap open ios` there (Xcode required). On a Mac the export does those steps for you.

## Translations
Exports include every translation in `lang/` (see [Translations](script-syntax.md#translations)). Players choose a language in Settings; by default the game follows the device's language.
