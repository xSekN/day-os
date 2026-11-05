# Day OS

A daily planner with a built-in workout tracker, made for iPhone "Add to Home Screen".
Plain HTML/CSS/JS, no framework, no build step. Works fully offline. All data stays on the phone (localStorage).

Live at: `https://<your-username>.github.io/day-os/`

## How it's used

An AI coach writes JSON **codes**. Tap **Paste code** (top right, on every tab) to apply one. The app detects the code by its `"type"`, shows what will change, and only applies it when you confirm.

| Code | What it does |
| --- | --- |
| `"type": "day"` | The full schedule for a date. Asks before replacing an existing plan. |
| `"type": "patch"` | Rearranges a day: `move`, `resize`, `add`, `remove`, `update`, `shiftAfter`, `trackerAdd`, `trackerUpdate`, `trackerRemove`. Failed ops are skipped and listed. |
| `"type": "tracker"` | Deadlines (`mode: "merge"` or `"replace"`). |
| `"type": "workout"` | A workout session (also allowed inside a day block). |

At night, **More > End-of-day report > Copy report** produces `DAY OS REPORT v1` (with any `LIFT LOG v1` workout logs appended) to paste back.

## Screens

- **Now**: the current block with a live countdown, tasks, focus timer, Done / Skip / Move to tomorrow / Running late, up next, top 3, deadlines.
- **Today**: timeline with a current-time line; tap a block for details. Arrows to see other days.
- **Tracker**: Colleges, Tests, Assignments, Other. Red if overdue or due within 3 days, yellow within 7.
- **Workout**: preview, warm-up, supersets with a rest timer, timed holds, tags, skip/swap, finish screen with the log.
- **More**: inbox, report, calendar (.ics) export, backup/restore, settings, history.

## Turn on GitHub Pages

1. On GitHub, open the `day-os` repo.
2. **Settings** > **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Pick branch **main** and folder **/ (root)**, then **Save**.
5. Wait a minute or two, then open `https://<your-username>.github.io/day-os/`.

## Install on iPhone

Open the URL in **Safari** > Share button > **Add to Home Screen**. Launch it from the home screen icon. After the first launch it works offline.

## On a computer

Open the same URL in Chrome, Edge or Safari. From 900px wide the tab bar becomes a sidebar and screens use the extra room: a two-column Now dashboard, a tracker card grid, supersets side by side, two-column More. In Chrome/Edge you can also install it (install icon in the address bar) so it opens in its own window.

Keyboard shortcuts:

| Key | Does |
| --- | --- |
| Ctrl/⌘ + V (outside a text box) | Paste a code: opens Paste code with it already checked |
| P | Open the Paste code box |
| N | Jot something down |
| 1 to 5 | Now, Today, Tracker, Workout, More |
| Enter (in a weight/reps box) | Log that set |
| Esc | Close the open dialog |

Data lives in each browser's own storage, so the phone and the computer don't sync. To move everything across, use **More > Backup > Copy all data** on one and **Restore from backup** on the other.

## Sound

Beeps use Web Audio (iPhone has no web vibration). Tap anywhere once after opening so sound is unlocked, and keep the ringer on if you want to hear rest-timer beeps.

## Updating

Every change must bump `CACHE_VERSION` in `sw.js` (for example `dayos-v1` to `dayos-v2`). The service worker then downloads the new files and the app reloads itself on next launch.

Regenerate icons with `python3 tools/make_icons.py` (needs Pillow).

## Tests

```bash
node --test tests/unit.test.mjs
```

```bash
node tests/e2e.mjs
```

`unit.test.mjs` covers the code parsers, every patch op, the tracker, the workout engine, and both output formats (checked line by line against the spec). `e2e.mjs` drives the whole app in headless Chromium with iPhone emulation and a mocked clock (needs Playwright), and saves screenshots to `$SHOTS` (default: a temp folder).

To try it locally: `node tests/serve.mjs 8080`, then open `http://127.0.0.1:8080/day-os/`.

## Files

```
index.html, manifest.webmanifest, sw.js
css/app.css
js/app.js          boot, tabs, tick loop, service worker
js/storage.js      localStorage (try/catch), backup/restore, 60-day pruning
js/planner.js      day + patch codes, running late, .ics
js/tracker.js      tracker codes, colours, countdowns
js/workout.js      workout codes, superset/rest/hold engine, LIFT LOG v1
js/report.js       DAY OS REPORT v1
js/codes.js        paste detection and readable JSON errors
js/ui.js           sheets, toasts, copy, beeps, wake lock, icons
js/views/*.js      the screens
icons/             generated PNG icons (tools/make_icons.py)
```
