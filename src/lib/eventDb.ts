/** Event database for player runs + leaderboard (local + disk-backed API). */

/** Event over — final leaderboard is read-only; free play does not write. */
export const LEADERBOARD_FROZEN = true;

export type MurderGuessResult = "correct" | "incorrect" | "none";

export type MurderGuessEntry = {
  name: string;
  correct: boolean;
  at: string;
};

export type PlayerRecord = {
  id: string;
  name: string;
  puzzlesPassed: number;
  completedTaskIds: string[];
  murderGuess: MurderGuessResult;
  murderGuessName: string | null;
  /** Chronological murderer accusations (newest last). */
  murderGuesses: MurderGuessEntry[];
  /** Mission seconds consumed (includes wrong-answer / accusation penalties). */
  timeUsedSeconds: number | null;
  timedOut: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  status: "waiting" | "playing" | "finished";
  /** Live: room label while playing */
  currentRoom: string | null;
  /** Live: puzzle label while playing */
  currentPuzzle: string | null;
  /** Client mission clock start (epoch ms). Remaining ≈ duration + bonus − elapsed */
  gameStartTime: number | null;
  /** Cumulative seconds admin has granted this player */
  timeBonusSeconds: number;
  /** Last heartbeat from the player's browser */
  lastSeenAt: string | null;
};

export type EventDb = {
  players: PlayerRecord[];
};

const DB_KEY = "cos_event_db";
const ACTIVE_PLAYER_KEY = "cos_active_player_id";
const APPLIED_BONUS_KEY = "cos_applied_time_bonus";
export const EVENT_DB_EVENT = "cos-event-db";
export const MISSION_DURATION_SECONDS = 2700; // 45 minutes

/** Password to start a new player run (team identification form). */
const DEFAULT_START_PASSWORD = "Accisalt@123";
/** Password for /admin console (add time, delete, live status). */
const DEFAULT_ADMIN_PASSWORD = "Accisalt@123";

export function getStartPassword(): string {
  return (import.meta.env.VITE_START_PASSWORD as string | undefined)?.trim() || DEFAULT_START_PASSWORD;
}

export function getAdminPassword(): string {
  return (import.meta.env.VITE_ADMIN_PASSWORD as string | undefined)?.trim() || DEFAULT_ADMIN_PASSWORD;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function notify() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT_DB_EVENT));
  }
}

function saveLocal(db: EventDb) {
  if (!canUseStorage()) return;
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  notify();
}

function normalizePlayer(raw: Partial<PlayerRecord> & { id: string; name: string }): PlayerRecord {
  return {
    id: raw.id,
    name: raw.name,
    puzzlesPassed: raw.puzzlesPassed ?? 0,
    completedTaskIds: Array.isArray(raw.completedTaskIds) ? raw.completedTaskIds : [],
    murderGuess: (raw.murderGuess as MurderGuessResult) ?? "none",
    murderGuessName: raw.murderGuessName ?? null,
    murderGuesses: Array.isArray(raw.murderGuesses) ? raw.murderGuesses : [],
    timeUsedSeconds: raw.timeUsedSeconds ?? null,
    timedOut: Boolean(raw.timedOut),
    startedAt: raw.startedAt ?? null,
    finishedAt: raw.finishedAt ?? null,
    status: (raw.status as PlayerRecord["status"]) ?? "waiting",
    currentRoom: raw.currentRoom ?? null,
    currentPuzzle: raw.currentPuzzle ?? null,
    gameStartTime: raw.gameStartTime ?? null,
    timeBonusSeconds: Math.max(0, Math.floor(raw.timeBonusSeconds ?? 0)),
    lastSeenAt: raw.lastSeenAt ?? null,
  };
}

export function loadEventDb(): EventDb {
  if (!canUseStorage()) return { players: [] };
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return { players: [] };
    const parsed = JSON.parse(raw) as EventDb;
    const players = Array.isArray(parsed.players)
      ? parsed.players.map((p) => normalizePlayer(p as PlayerRecord))
      : [];
    return { players };
  } catch {
    return { players: [] };
  }
}

/** Push local DB to disk-backed API (survives server restart). */
async function pushToServer(db: EventDb) {
  if (LEADERBOARD_FROZEN) return;
  try {
    await fetch("/api/event-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(db),
    });
  } catch {
    /* static hosts / offline — localStorage remains */
  }
}

function saveEventDb(db: EventDb) {
  if (LEADERBOARD_FROZEN) return;
  saveLocal(db);
  void pushToServer(db);
}

function mergeGuesses(a: MurderGuessEntry[] = [], b: MurderGuessEntry[] = []): MurderGuessEntry[] {
  const key = (g: MurderGuessEntry) => `${g.at}|${g.name}|${g.correct}`;
  const map = new Map<string, MurderGuessEntry>();
  [...a, ...b].forEach((g) => map.set(key(g), g));
  return [...map.values()].sort((x, y) => x.at.localeCompare(y.at));
}

function mergePlayer(existing: PlayerRecord, incoming: PlayerRecord): PlayerRecord {
  const remoteScore = (incoming.puzzlesPassed ?? 0) + (incoming.finishedAt ? 1000 : 0);
  const localScore = (existing.puzzlesPassed ?? 0) + (existing.finishedAt ? 1000 : 0);
  const preferIncoming = remoteScore >= localScore;
  const base = preferIncoming ? { ...existing, ...incoming } : { ...incoming, ...existing };
  return normalizePlayer({
    ...base,
    timeBonusSeconds: Math.max(existing.timeBonusSeconds ?? 0, incoming.timeBonusSeconds ?? 0),
    murderGuesses: mergeGuesses(existing.murderGuesses, incoming.murderGuesses),
    lastSeenAt:
      (existing.lastSeenAt ?? "") > (incoming.lastSeenAt ?? "")
        ? existing.lastSeenAt
        : incoming.lastSeenAt,
  });
}

/**
 * Server roster is source of truth for who exists.
 * Local-only rows are kept briefly only for the active in-progress player.
 */
function applyServerRoster(remotePlayers: PlayerRecord[]): EventDb {
  // Frozen LB: server snapshot only — never inject local free-play rows
  if (LEADERBOARD_FROZEN) {
    const merged = { players: remotePlayers };
    if (canUseStorage()) {
      localStorage.setItem(DB_KEY, JSON.stringify(merged));
      notify();
    }
    return merged;
  }
  const local = loadEventDb();
  const localById = new Map(local.players.map((p) => [p.id, p] as const));
  const next: PlayerRecord[] = remotePlayers.map((p) => {
    const localP = localById.get(p.id);
    return localP ? mergePlayer(localP, p) : p;
  });
  const remoteIds = new Set(remotePlayers.map((p) => p.id));
  const active = getActivePlayerId();
  if (active && !remoteIds.has(active)) {
    const localActive = localById.get(active);
    if (localActive && !localActive.finishedAt) next.push(localActive);
  }
  const merged = { players: next };
  if (canUseStorage()) {
    localStorage.setItem(DB_KEY, JSON.stringify(merged));
    notify();
  }
  return merged;
}

/** Pull disk-backed leaderboard on boot (server membership wins). */
export async function hydrateEventDbFromServer(): Promise<void> {
  if (!canUseStorage()) return;
  try {
    const res = await fetch("/api/event-db");
    if (!res.ok) return;
    const remote = (await res.json()) as EventDb;
    const remotePlayers = Array.isArray(remote.players)
      ? remote.players.map((p) => normalizePlayer(p as PlayerRecord))
      : [];
    applyServerRoster(remotePlayers);
    if (LEADERBOARD_FROZEN) return;
    const active = getActivePlayerId();
    if (active) {
      const p = loadEventDb().players.find((x) => x.id === active);
      if (p) await pushToServer({ players: [p] });
    }
  } catch {
    /* ignore */
  }
}

export async function refreshEventDbFromServer(): Promise<EventDb> {
  try {
    const res = await fetch("/api/event-db");
    if (!res.ok) return loadEventDb();
    const remote = (await res.json()) as EventDb;
    const remotePlayers = Array.isArray(remote.players)
      ? remote.players.map((p) => normalizePlayer(p as PlayerRecord))
      : [];
    return applyServerRoster(remotePlayers);
  } catch {
    return loadEventDb();
  }
}

/** Start-game password (new player form). */
export async function verifyStartPassword(password: string): Promise<boolean> {
  try {
    const res = await fetch("/api/start/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean };
      return Boolean(data.ok);
    }
    if (res.status === 401) return false;
  } catch {
    /* fall through */
  }
  return password === getStartPassword();
}

/** Admin console password (/admin). */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean };
      return Boolean(data.ok);
    }
    if (res.status === 401) return false;
  } catch {
    /* fall through */
  }
  return password === getAdminPassword();
}

export async function adminAddTime(
  password: string,
  playerId: string,
  seconds: number
): Promise<{ ok: boolean; player?: PlayerRecord; error?: string }> {
  try {
    const res = await fetch("/api/admin/add-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, playerId, seconds }),
    });
    const data = (await res.json()) as { ok?: boolean; player?: PlayerRecord; error?: string };
    if (res.ok && data.player) {
      const db = loadEventDb();
      const idx = db.players.findIndex((p) => p.id === playerId);
      const normalized = normalizePlayer(data.player);
      if (idx >= 0) db.players[idx] = mergePlayer(db.players[idx], normalized);
      else db.players.push(normalized);
      saveLocal(db);
      return { ok: true, player: normalized };
    }
    return { ok: false, error: data.error || "Failed" };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

export async function adminDeletePlayer(
  password: string,
  playerId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/admin/delete-player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, playerId }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (res.ok) {
      const db = loadEventDb();
      db.players = db.players.filter((p) => p.id !== playerId);
      saveLocal(db);
      if (getActivePlayerId() === playerId) setActivePlayerId(null);
      return { ok: true };
    }
    return { ok: false, error: data.error || "Failed" };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

function uid() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalize typed/partial suspect names to consistent full display names. */
export function normalizeSuspectFullName(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[.,']/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^dr\s+/, "")
    .trim();

  if (s === "arjun" || s === "mehta" || s === "arjun mehta" || s === "mehta arjun") {
    return "Arjun Mehta";
  }
  if (s === "neha" || s === "rao" || s === "neha rao" || s === "rao neha") {
    return "Neha Rao";
  }
  if (s === "karan" || s === "patel" || s === "karan patel" || s === "patel karan") {
    return "Karan Patel";
  }
  if (s === "rohan" || s === "desai" || s === "rohan desai" || s === "desai rohan") {
    return "Rohan Desai";
  }
  if (s === "sameer" || s === "shah" || s === "sameer shah" || s === "shah sameer") {
    return "Sameer Shah";
  }
  if (!s || s === "(timed out)") return "(timed out)";
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function formatTimeUsed(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function remainingFromStart(
  gameStartTime: number | null,
  timeBonusSeconds: number,
  now = Date.now()
): number | null {
  if (gameStartTime == null) return null;
  const elapsed = Math.floor((now - gameStartTime) / 1000);
  return Math.max(0, MISSION_DURATION_SECONDS + Math.max(0, timeBonusSeconds) - elapsed);
}

/** Mirrors ROOM_TASKS order — kept here to avoid circular imports with investigationProgress. */
const PROGRESS_STEPS: { room: string; puzzle: string; id: string }[] = [
  { room: "Office", puzzle: "Laser", id: "laser" },
  { room: "Office", puzzle: "Drawer", id: "drawer" },
  { room: "Office", puzzle: "Cipher", id: "cipher" },
  { room: "Office", puzzle: "Badges", id: "folder" },
  { room: "Lab", puzzle: "Logic", id: "logic" },
  { room: "Lab", puzzle: "Report", id: "report" },
  { room: "Lab", puzzle: "Timeline", id: "timeline" },
  { room: "Lab", puzzle: "Archive", id: "archive" },
  { room: "Archives", puzzle: "Hash", id: "hash" },
  { room: "Archives", puzzle: "Archive", id: "overlay" },
  { room: "Server", puzzle: "Session", id: "session" },
  { room: "Server", puzzle: "UV", id: "uv" },
  { room: "Server", puzzle: "Wires", id: "wires" },
  { room: "Server", puzzle: "CCTV", id: "cctv" },
  { room: "Server", puzzle: "Accusation", id: "accusation" },
];

export function deriveLiveProgress(taskIds: string[]): { room: string; puzzle: string } {
  const done = new Set(taskIds);
  for (const step of PROGRESS_STEPS) {
    if (!done.has(step.id)) return { room: step.room, puzzle: step.puzzle };
  }
  return { room: "Complete", puzzle: "—" };
}

/** Create a new run entry for this name (no-op when leaderboard is frozen). */
export function startGameAsPlayer(name: string): PlayerRecord {
  const trimmed = name.trim() || "Guest";
  const player: PlayerRecord = normalizePlayer({
    id: uid(),
    name: trimmed,
    puzzlesPassed: 0,
    completedTaskIds: [],
    murderGuess: "none",
    murderGuessName: null,
    murderGuesses: [],
    timeUsedSeconds: null,
    timedOut: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "playing",
    currentRoom: "Office",
    currentPuzzle: "Laser",
    gameStartTime: Date.now(),
    timeBonusSeconds: 0,
    lastSeenAt: new Date().toISOString(),
  });
  if (LEADERBOARD_FROZEN) {
    setActivePlayerId(null);
    setAppliedBonusSeconds(0);
    return player;
  }
  const db = loadEventDb();
  db.players.push(player);
  saveEventDb(db);
  setActivePlayerId(player.id);
  setAppliedBonusSeconds(0);
  return player;
}

export function getActivePlayerId(): string | null {
  if (!canUseStorage()) return null;
  return localStorage.getItem(ACTIVE_PLAYER_KEY);
}

export function setActivePlayerId(id: string | null) {
  if (!canUseStorage()) return;
  if (id) localStorage.setItem(ACTIVE_PLAYER_KEY, id);
  else localStorage.removeItem(ACTIVE_PLAYER_KEY);
  notify();
}

export function getAppliedBonusSeconds(): number {
  if (!canUseStorage()) return 0;
  const n = Number(localStorage.getItem(APPLIED_BONUS_KEY) || "0");
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function setAppliedBonusSeconds(n: number) {
  if (!canUseStorage()) return;
  localStorage.setItem(APPLIED_BONUS_KEY, String(Math.max(0, Math.floor(n))));
}

export function getActivePlayer(): PlayerRecord | null {
  const id = getActivePlayerId();
  if (!id) return null;
  return loadEventDb().players.find((p) => p.id === id) ?? null;
}

export function syncPlayerTasks(taskIds: string[]) {
  if (LEADERBOARD_FROZEN) return;
  const id = getActivePlayerId();
  if (!id) return;
  const db = loadEventDb();
  const p = db.players.find((x) => x.id === id);
  if (!p || p.status === "finished") return;
  p.completedTaskIds = [...taskIds];
  p.puzzlesPassed = taskIds.filter((t) => t !== "accusation").length;
  const live = deriveLiveProgress(taskIds);
  p.currentRoom = live.room;
  p.currentPuzzle = live.puzzle;
  if (p.status === "waiting") {
    p.status = "playing";
    p.startedAt = p.startedAt ?? new Date().toISOString();
  }
  p.lastSeenAt = new Date().toISOString();
  saveEventDb(db);
}

export function pushPlayerHeartbeat(partial: {
  completedTaskIds?: string[];
  gameStartTime?: number | null;
  timeRemaining?: number;
  currentRoom?: string | null;
  currentPuzzle?: string | null;
}) {
  if (LEADERBOARD_FROZEN) return;
  const id = getActivePlayerId();
  if (!id) return;
  const db = loadEventDb();
  const p = db.players.find((x) => x.id === id);
  if (!p || p.status === "finished") return;

  if (partial.completedTaskIds) {
    p.completedTaskIds = [...partial.completedTaskIds];
    p.puzzlesPassed = partial.completedTaskIds.filter((t) => t !== "accusation").length;
    const live = deriveLiveProgress(partial.completedTaskIds);
    p.currentRoom = live.room;
    p.currentPuzzle = live.puzzle;
  }
  if (partial.currentRoom != null) p.currentRoom = partial.currentRoom;
  if (partial.currentPuzzle != null) p.currentPuzzle = partial.currentPuzzle;
  if (partial.gameStartTime != null) p.gameStartTime = partial.gameStartTime;
  p.lastSeenAt = new Date().toISOString();
  if (p.status === "waiting") p.status = "playing";
  saveEventDb(db);
}

export function recordMurderGuess(guessName: string, correct: boolean, timeUsedSeconds: number) {
  if (LEADERBOARD_FROZEN) return;
  const id = getActivePlayerId();
  if (!id) return;
  const db = loadEventDb();
  const p = db.players.find((x) => x.id === id);
  if (!p) return;
  const full = normalizeSuspectFullName(guessName);
  p.murderGuessName = full;
  p.murderGuess = correct ? "correct" : "incorrect";
  p.murderGuesses = [
    ...(p.murderGuesses ?? []),
    { name: full, correct, at: new Date().toISOString() },
  ];
  p.timeUsedSeconds = Math.max(0, Math.floor(timeUsedSeconds));
  if (correct) {
    p.status = "finished";
    p.finishedAt = new Date().toISOString();
    p.timedOut = false;
    p.currentRoom = "Complete";
    p.currentPuzzle = "—";
  }
  p.lastSeenAt = new Date().toISOString();
  saveEventDb(db);
}

export function recordTimeout(timeUsedSeconds: number = MISSION_DURATION_SECONDS) {
  if (LEADERBOARD_FROZEN) return;
  const id = getActivePlayerId();
  if (!id) return;
  const db = loadEventDb();
  const p = db.players.find((x) => x.id === id);
  if (!p || p.status === "finished") return;
  p.timedOut = true;
  p.status = "finished";
  p.finishedAt = new Date().toISOString();
  p.timeUsedSeconds = Math.max(0, Math.floor(timeUsedSeconds));
  if (p.murderGuess === "none") {
    p.murderGuess = "incorrect";
    p.murderGuessName = p.murderGuessName
      ? normalizeSuspectFullName(p.murderGuessName)
      : "(timed out)";
  }
  p.lastSeenAt = new Date().toISOString();
  saveEventDb(db);
}

export function formatFinishTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function isPlayerLive(p: PlayerRecord, withinMs = 20000): boolean {
  if (p.status !== "playing" || !p.lastSeenAt) return false;
  return Date.now() - new Date(p.lastSeenAt).getTime() < withinMs;
}
