# Code of Silence

Interactive 3D murder-mystery investigation built for **CSI · KJSIT**.

Players explore four locations in order, solve puzzles, gather evidence, and accuse the murderer before the mission timer runs out.

**Live:** [https://csi.kjsitlabs.com](https://csi.kjsitlabs.com)

**Final event leaderboard:** [https://csi.kjsitlabs.com/leaderboard](https://csi.kjsitlabs.com/leaderboard)

---

## About the experience

Someone altered Project AEGIS research. Professor Dev Verma planned to confront them — and did not survive the night. Investigators must follow the evidence trail room by room.

### Rooms (unlock in order)

| Room | Focus |
|------|--------|
| **Dr. Verma's Office** | Laser desk, drawer, cipher, badge folder |
| **Research Lab** | Logic gates, falsified report, timeline, archive access |
| **Archives** | Hash integrity check, archive terminal |
| **Server Room** | Session ID, UV print, tangled wires, CCTV, final accusation |

Progress is local to the browser (rooms, puzzles, timer). After the campus event, the public leaderboard is **frozen** — free play no longer writes new scores.

---

## Play (post-event)

1. Open [csi.kjsitlabs.com](https://csi.kjsitlabs.com)
2. No name or password required
3. Start investigating from the map
4. Use **Reset** (beside **Map**, or on the map screen) to wipe *your* local progress and start over
5. Optional: view the frozen event results on `/leaderboard`

---

## Tech stack

- **React + TypeScript** (Vite)
- **Three.js / R3F** for 3D rooms
- **Tailwind + shadcn/ui** for UI
- Disk-backed JSON event DB (`data/event-db.json`) for the frozen leaderboard / admin APIs
- Hosted behind nginx at `csi.kjsitlabs.com` (Vite preview via PM2)

---

## Local development

```bash
npm install
npm run dev
```

Open the URL Vite prints (default port is set in `vite.config.ts`).

```bash
npm run build    # production build → dist/
npm run preview  # serve dist locally (includes /api event routes)
```

---

## Useful routes

| Path | Purpose |
|------|---------|
| `/` | Intro → investigation map |
| `/game?room=verma\|research\|archive\|server` | Enter a room |
| `/leaderboard` | Final event results (read-only) |
| `/admin` | Event ops console (password-protected; writes disabled while frozen) |

Deep-link testing (tab-only unlock, does not mark rooms complete permanently):

```text
/game?room=server&skip=1
```

---

## Project layout

```text
src/
  components/rooms/   # Room 1–4 puzzles & 3D
  components/intro/   # Title, logo, map
  contexts/           # Mission timer / game state
  lib/                # Progress, run session, event DB client
  pages/              # Routes (Index, Game, Leaderboard, Admin)
server/
  eventApiPlugin.ts   # /api/event-db + admin/start verify
public/
  evidence/           # Letter, reports, images
  video/              # CCTV footage
  model/              # GLB assets
data/
  event-db.json       # Leaderboard snapshot (do not wipe casually)
```

---

## Event mode notes

- **`LEADERBOARD_FROZEN`** (client + server) blocks new leaderboard writes while still serving the final roster.
- Free-play progress stays on the device; Reset only clears that browser’s run.
- During a live event, unfreeze carefully and use `/admin` for live status, time bonuses, and player deletes.

---

## Credits

Built for **CSI KJSIT** — Code of Silence murder-mystery event.
