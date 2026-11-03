# Set up WeatherV1 for the person in front of you

You are the person's own Claude. They were handed this folder and told "set this up". Everything you
need is in this file; follow it from top to bottom. Speak to them in **Hebrew** (masculine singular),
short and warm. Do the work yourself where you can; ask them only for what only they can do (clicks
in the browser, pasting their own key).

**What WeatherV1 is:** a single web page (`WeatherV1.html`) that turns a recorded Hebrew weather
narration into a vertical 9:16 forecast video. It runs entirely in Chrome or Edge: Hebrew
transcription on this computer (Whisper, ivrit.ai model), scene planning by Claude (their own API
key), clips from Keshet V1's library folder (`weather`), and the video render in the browser.

**The onboarding page is your slide deck.** `onboarding/onboarding.html` has one illustrated section
per step. At each step below, open the matching section in their browser and explain it in a sentence
or two, then do the step. Open it with the browser explicitly, and always from the installed copy in
`$app` (step 0), never from this folder, e.g. on Windows:

```powershell
Start-Process $browser "file:///$($app -replace '\\','/')/onboarding/onboarding.html#how"
```

Sections, in order: `#welcome` `#how` `#ais` `#privacy` `#library` `#install` `#key` `#ears` `#first` `#done`.

## Ground rules

- **Never ask for, read, type or store their Anthropic API key.** They paste it into the app
  themselves (step 5). If they paste it to you by mistake, tell them to revoke it at
  console.anthropic.com and create a new one.
- Do not edit anything inside `weather\notouch!\` and do not delete anything in `weather\`.
- Nothing here needs admin rights, an installer, Python or Node.
- If a step fails, say what happened in plain Hebrew and try the fix listed; do not improvise
  changes to `WeatherV1.html`.
- This folder may be a temporary place your app extracted the zip to, and Chrome may refuse to open
  pages from there. That's why step 0 copies everything to `Documents\WeatherV1` before anything is
  opened.

## Step 0 · Copy in, then welcome (`#welcome`, then `#how`, `#ais`, `#privacy`)

Find this folder's full path (call it `$src`) and the browser (call it `$browser`):

```powershell
$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
(Get-Item $browser).VersionInfo.ProductVersion
```

Chrome or Edge **version 120 or newer** is required. Firefox and Safari can't run it. If neither is
installed, ask them to install Chrome from google.com/chrome and continue after.

Copy the app and the onboarding pages to their permanent home (call it `$app`) before opening
anything:

```powershell
$app = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "WeatherV1"
New-Item -ItemType Directory -Force $app | Out-Null
Copy-Item (Join-Path $src "WeatherV1.html") $app -Force
Copy-Item (Join-Path $src "onboarding") $app -Recurse -Force
Start-Process $browser "file:///$($app -replace '\\','/')/onboarding/onboarding.html#welcome"
```

Ask them to say when they see the welcome page. If it doesn't open, check `$app` holds
`onboarding\onboarding.html` and open it again from there; a blank page with no error usually means
it was opened from somewhere else.

Then walk through `#how` (the five stages), `#ais` (who does what: you are the
helper, Claude inside the app is the planner, Whisper is the ears) and `#privacy` (video and voice
never leave the computer; only the transcript text goes to Claude). One or two sentences each.

## Step 1 · The library (`#library`)

The library is a folder named `weather` with `notouch!\catalog.json`, `videos\`, `music\` inside. Bar
sent it as five zips named `weather-catalog-part1-of-5.zip` … `part5-of-5.zip` (usually in Downloads,
from WhatsApp).

Look for an existing library first:

```powershell
Get-ChildItem -Path $env:USERPROFILE -Recurse -Depth 4 -Directory -Filter weather -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName "notouch!\catalog.json") } | Select-Object -ExpandProperty FullName
Get-ChildItem -Path $env:USERPROFILE -Recurse -Depth 3 -Filter "weather-catalog-part*-of-5.zip" -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty FullName
```

- If a complete `weather` folder exists, use it where it is (call it `$lib`).
- Else, if all five zips are found, extract each into `$app` (each zip already contains the
  `weather\` folder, so they merge):
  ```powershell
  Get-ChildItem <folder-with-zips> -Filter "weather-catalog-part*-of-5.zip" | Sort-Object Name |
    ForEach-Object { Expand-Archive -Path $_.FullName -DestinationPath $app -Force }
  $lib = Join-Path $app "weather"
  ```
- If parts are missing, tell them which and ask them to save the rest from the WhatsApp chat with
  Bar. You can do step 2 (the shortcut) while they do; come back here before choosing the folder.

Check it: `notouch!\catalog.json` exists and `videos\` holds about 207 files
(`(Get-ChildItem "$lib\videos").Count`). Tell them the count.

## Step 2 · Install the app (`#install`)

The app is already in `$app` (step 0). Make a desktop shortcut that opens it **in that browser**:

```powershell
$page = "file:///" + ((Join-Path $app "WeatherV1.html") -replace '\\','/')
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "מחולל תחזית V1.lnk"
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sh.TargetPath = $browser
$sh.Arguments = "`"$page`""
$sh.IconLocation = "$browser,0"
$sh.Save()
Start-Process $browser "`"$page`""
```

Then guide their clicks: the page checks the browser, then **בחירת תיקייה** → choose the `weather`
folder (`$lib`) → in Chrome's prompt choose **אפשר / Allow** (edit access, so videos can be saved to
`weather\outputs`). The studio opens. Ask them to confirm they see the **סטודיו** screen and the
**קטלוג** tab lists the clips.

If the page says the browser is unsupported, they opened it in another browser: use the shortcut.
If an older **WeatherV1** shortcut is on the desktop (the previous installer version), leave it and
tell them to use **מחולל תחזית V1** from now on.

## Step 3 · Their Claude key (`#key`)

Open `#key` and guide them (do not do it for them, do not look at the key):

1. console.anthropic.com → sign in (or sign up) → **API Keys** → **Create Key** → copy it.
2. **Billing**: add a small credit. One forecast costs a few cents of Claude usage (estimate).
3. In the app: **הגדרות** → **מפתח Claude** → paste → save.

The settings screen shows a green dot next to **מפתח Claude** when it's saved.

## Step 4 · The Hebrew model (`#ears`)

In **הגדרות**, card **תמלול בעברית** → **הורדת המודל**. About 760 MB, saved inside
`weather\.weatherv1\models\`; it downloads once and then works offline. Tell them it can take a few
minutes and the bar shows progress. When the card says the model is installed, continue.

If it fails: check internet, click **נסה שוב**. On a computer without GPU support in the browser the
page says so on the first screen; transcription still works, just slower.

## Step 5 · First forecast (`#first`)

A sample narration is in the library: `weather\audio\` (a short WhatsApp recording). Guide them:

1. **סטודיו** → **בחר קובץ** → the sample (or any narration they have).
2. Read the transcript; fix a word if needed → **המשך לציר הזמן**.
3. Claude plans scenes and picks clips. They can swap any clip.
4. **רינדור**. The finished MP4 appears in the app and in `weather\outputs\`. Keep the tab open
   until it's done.

Measure roughly how long transcription and render took.

## Step 6 · Done (`#done`) and the report for Bar

Open `#done`. Then write a short Hebrew message they can send Bar on WhatsApp, with:
- browser + version, and whether the first screen warned about GPU (yes/no)
- clip count found in the library
- transcription time and render time for the first forecast
- anything that failed and what they saw

Finish by telling them the daily flow in one line: shortcut → **המשך** → narration → video.

## If they're on a Mac

Same steps. Copy `WeatherV1.html` and `onboarding/` to `~/Documents/WeatherV1` first and open the
pages from there; the library goes there too. Open `WeatherV1.html` with Chrome
(`open -a "Google Chrome" ~/Documents/WeatherV1/WeatherV1.html`); instead of a desktop shortcut,
drag the file to the Dock or bookmark it in Chrome. Extract the zips with
`ditto -x -k <zip> ~/Documents/WeatherV1` for each part.
