# Athenaeum

Athenaeum is a calm, local-first desktop workspace for deep focus, daily goals, writing, reading, and strategic thinking. Built with **Tauri v2**, **React**, **TypeScript**, and **Rust + SQLite**, it runs completely offline out of the box with zero accounts, subscriptions, or cloud dependencies.

---

## Core Features

- **Observatory Overview:** Full-viewport calm dashboard featuring a live clock, daily greeting, smart focus countdown/open timer (`30` → 30 min, `1524` → `15:24`), rolling hourly check-in log, active streak tracker, interactive Weekly Cadence heatmap (click any day to inspect completed tasks and debriefs), floating sticky notes, and built-in ambient soundscapes.
- **Goals & Milestones:** Organize Daily, Weekly, and Long-Term goals with priorities, recurring schedules, durations, milestones, and direct one-click Focus Timer linking.
- **Journal & Daily Debrief:** Plain-Markdown Daily Debriefs and freeform Reflections with live wiki-link (`[[Note]]`) preview, backlinks, and full-text search—works automatically with a built-in local folder (`Documents/Athenaeum Notes`) or your existing Obsidian vault.
- **The Library (PDF & EPUB Reader):** Distraction-free document reader with page-level persistence, paper tints, in-book `Ctrl+F` search, text highlighting & margin notes synced to Markdown, and an optional configurable Daily Reading Habit tracker.
- **TOC Whiteboard:** Interactive Theory of Constraints canvas supporting Current Reality Trees (CRT), Evaporating Clouds, Future Reality Trees, Prerequisite/Transition Trees, and the Five Focusing Steps—complete with undo/redo, copy/paste, duplicate, and Markdown export.
- **Focus & Atmosphere Studio:** Dedicated focus workspace pairing the session timer, today's focus rollup, six built-in offline Web Audio soundscapes (Brown Noise, Rain, Library, Cafe, Fireplace, Soft Wind), saved playlist shortcuts, and Windows media transport (SMTC).
- **Advanced Analytics:** Visual breakdown of focus hours, category allocation, 24-hour logical day logs, goal consistency, and reading trends—all queried directly from your local SQLite database.
- **Global Quick Capture:** Press `Alt+Space` (or `Ctrl+Shift+A`) from anywhere to capture tasks, notes, or launch a focus session.

---

## Zero-Setup Local Architecture

On first launch, Athenaeum guides you through a brief **4-step Setup Guide** and automatically initializes:

- **Local SQLite Database:** Created automatically in your OS application data directory (`athenaeum.db`) with zero pre-populated personal data.
- **Local Markdown Notes Folder:** Defaults to `Documents/Athenaeum Notes` (or point it to any existing Obsidian vault).
- **Offline Ambient Soundscapes:** Synthesized locally via Web Audio API—no network streaming required.

### Optional Integrations (100% Opt-In in Settings)

Every external connector is optional and cleanly inactive until configured in **Settings**:

- **Obsidian Vault:** Point the Notes folder to your Obsidian vault directory for instant two-way Markdown compatibility.
- **Books Folder:** Select any local folder of `.pdf` and `.epub` files to populate The Library.
- **Desktop Music Player (Apple Music / Spotify / None):** Choose your preferred quick-launch player (gracefully falls back to the web player if the desktop app is not installed) or select **Soundscapes Only** to hide external launchers while keeping Windows SMTC playback controls active.
- **Calendar Feeds (`.ics`):** Subscribe to read-only Google, Apple, or Outlook private `.ics` feeds.
- **Home Assistant Lighting:** Optionally sync room lights during focus and reading sessions via Home Assistant's REST API.
- **n8n Webhooks, Local Ingest API & External Database URL:** Strictly opt-in under **Settings → Integrations & Automations → Advanced Setup**.

---

## Development & Building from Source

### Prerequisites

- **Node.js** (v20+) and **npm**
- **Rust toolchain** (`rustup` / `cargo`) and **Tauri v2 prerequisites** (on Windows: Microsoft C++ Build Tools & WebView2)

### Install Dependencies

```bash
npm install
```

### Run in Development Mode

```bash
# Full desktop app (Tauri + Vite)
npm run tauri dev

# Frontend-only web preview (uses browser localStorage)
npm run dev
```

### Build Production Desktop Installer

```bash
npm run tauri build
```

Compiled binaries and installers are output to `src-tauri/target/release/bundle/`.

---

## Privacy & Local Data

All user databases (`*.db`), configuration files (`config.json`), and local environment files (`.env*`) are excluded from version control via `.gitignore` and remain strictly on your local machine.

---

## Author & License

Designed & built by **[Pablo Gonzalez](https://pablogonzalez.framer.website)**.

Released under the [MIT License](LICENSE).
