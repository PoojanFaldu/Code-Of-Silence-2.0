import fs from "fs";
import path from "path";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

type MurderGuessEntry = { name: string; correct: boolean; at: string };

type PlayerRecord = {
  id: string;
  name: string;
  puzzlesPassed: number;
  completedTaskIds: string[];
  murderGuess: string;
  murderGuessName: string | null;
  murderGuesses?: MurderGuessEntry[];
  timeUsedSeconds: number | null;
  timedOut: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
  currentRoom?: string | null;
  currentPuzzle?: string | null;
  gameStartTime?: number | null;
  timeBonusSeconds?: number;
  lastSeenAt?: string | null;
};

type EventDb = { players: PlayerRecord[]; deletedIds: string[] };

/** Event over — reject all leaderboard writes; GET still serves final results. */
const LEADERBOARD_FROZEN = true;

function dataPath(root: string) {
  return path.join(root, "data", "event-db.json");
}

function normalizePlayer(raw: Partial<PlayerRecord> & { id: string; name: string }): PlayerRecord {
  return {
    id: raw.id,
    name: raw.name,
    puzzlesPassed: raw.puzzlesPassed ?? 0,
    completedTaskIds: Array.isArray(raw.completedTaskIds) ? raw.completedTaskIds : [],
    murderGuess: raw.murderGuess ?? "none",
    murderGuessName: raw.murderGuessName ?? null,
    murderGuesses: Array.isArray(raw.murderGuesses) ? raw.murderGuesses : [],
    timeUsedSeconds: raw.timeUsedSeconds ?? null,
    timedOut: Boolean(raw.timedOut),
    startedAt: raw.startedAt ?? null,
    finishedAt: raw.finishedAt ?? null,
    status: raw.status ?? "waiting",
    currentRoom: raw.currentRoom ?? null,
    currentPuzzle: raw.currentPuzzle ?? null,
    gameStartTime: raw.gameStartTime ?? null,
    timeBonusSeconds: Math.max(0, Math.floor(raw.timeBonusSeconds ?? 0)),
    lastSeenAt: raw.lastSeenAt ?? null,
  };
}

function ensureDb(root: string): EventDb {
  const file = dataPath(root);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    const empty: EventDb = { players: [], deletedIds: [] };
    fs.writeFileSync(file, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<EventDb>;
    const deletedIds = Array.isArray(parsed.deletedIds)
      ? [...new Set(parsed.deletedIds.filter((id): id is string => typeof id === "string"))]
      : [];
    const deleted = new Set(deletedIds);
    const players = Array.isArray(parsed.players)
      ? parsed.players
          .map((p) => normalizePlayer(p as PlayerRecord))
          .filter((p) => !deleted.has(p.id))
      : [];
    return { players, deletedIds };
  } catch {
    return { players: [], deletedIds: [] };
  }
}

function writeDb(root: string, db: EventDb) {
  const file = dataPath(root);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const deleted = new Set(db.deletedIds ?? []);
  const clean: EventDb = {
    players: (db.players ?? []).filter((p) => !deleted.has(p.id)),
    deletedIds: [...deleted],
  };
  fs.writeFileSync(file, JSON.stringify(clean, null, 2), "utf8");
}

function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function startPassword() {
  return (
    process.env.START_PASSWORD?.trim() ||
    process.env.VITE_START_PASSWORD?.trim() ||
    "Accisalt@123"
  );
}

function adminPassword() {
  return (
    process.env.ADMIN_PASSWORD?.trim() ||
    process.env.VITE_ADMIN_PASSWORD?.trim() ||
    "Accisalt@123"
  );
}

function mergeGuesses(a: MurderGuessEntry[] = [], b: MurderGuessEntry[] = []) {
  const key = (g: MurderGuessEntry) => `${g.at}|${g.name}|${g.correct}`;
  const map = new Map<string, MurderGuessEntry>();
  [...a, ...b].forEach((g) => map.set(key(g), g));
  return [...map.values()].sort((x, y) => x.at.localeCompare(y.at));
}

function mergePlayer(server: PlayerRecord, incoming: PlayerRecord): PlayerRecord {
  const remoteScore = (incoming.puzzlesPassed ?? 0) + (incoming.finishedAt ? 1000 : 0);
  const localScore = (server.puzzlesPassed ?? 0) + (server.finishedAt ? 1000 : 0);
  const preferIncoming = remoteScore >= localScore;
  const base = preferIncoming ? { ...server, ...incoming } : { ...incoming, ...server };
  return normalizePlayer({
    ...base,
    timeBonusSeconds: Math.max(server.timeBonusSeconds ?? 0, incoming.timeBonusSeconds ?? 0),
    murderGuesses: mergeGuesses(server.murderGuesses, incoming.murderGuesses),
  });
}

function json(res: import("http").ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function attachApi(server: ViteDevServer | PreviewServer, root: string) {
  server.middlewares.use(async (req, res, next) => {
    const url = req.url?.split("?")[0] ?? "";

    if (url === "/api/event-db" && req.method === "GET") {
      const db = ensureDb(root);
      // Clients only need the live roster — never rehydrate deleted rows
      json(res, 200, { players: db.players });
      return;
    }

    if (url === "/api/event-db" && req.method === "POST") {
      if (LEADERBOARD_FROZEN) {
        const db = ensureDb(root);
        json(res, 200, { ok: true, frozen: true, count: db.players.length });
        return;
      }
      try {
        const raw = await readBody(req);
        const incoming = JSON.parse(raw) as EventDb;
        const incomingPlayers = Array.isArray(incoming.players)
          ? incoming.players.map((p) => normalizePlayer(p as PlayerRecord))
          : [];
        const serverDb = ensureDb(root);
        const deleted = new Set(serverDb.deletedIds ?? []);
        const byId = new Map<string, PlayerRecord>();
        serverDb.players.forEach((p) => byId.set(p.id, p));
        incomingPlayers.forEach((p) => {
          if (deleted.has(p.id)) return; // admin delete is permanent
          const existing = byId.get(p.id);
          byId.set(p.id, existing ? mergePlayer(existing, p) : p);
        });
        const merged: EventDb = {
          players: [...byId.values()].filter((p) => !deleted.has(p.id)),
          deletedIds: [...deleted],
        };
        writeDb(root, merged);
        json(res, 200, { ok: true, count: merged.players.length });
      } catch {
        json(res, 400, { ok: false, error: "Invalid payload" });
      }
      return;
    }

    if (url === "/api/start/verify" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { password?: string };
        const ok = (body.password ?? "") === startPassword();
        json(res, ok ? 200 : 401, { ok });
      } catch {
        json(res, 400, { ok: false });
      }
      return;
    }

    if (url === "/api/admin/verify" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { password?: string };
        const ok = (body.password ?? "") === adminPassword();
        json(res, ok ? 200 : 401, { ok });
      } catch {
        json(res, 400, { ok: false });
      }
      return;
    }

    if (url === "/api/admin/add-time" && req.method === "POST") {
      if (LEADERBOARD_FROZEN) {
        json(res, 403, { ok: false, error: "Leaderboard frozen" });
        return;
      }
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { password?: string; playerId?: string; seconds?: number };
        if ((body.password ?? "") !== adminPassword()) {
          json(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        const seconds = Math.floor(Number(body.seconds) || 0);
        if (!body.playerId || seconds === 0) {
          json(res, 400, { ok: false, error: "playerId and non-zero seconds required" });
          return;
        }
        const db = ensureDb(root);
        const p = db.players.find((x) => x.id === body.playerId);
        if (!p) {
          json(res, 404, { ok: false, error: "Player not found" });
          return;
        }
        p.timeBonusSeconds = Math.max(0, (p.timeBonusSeconds ?? 0) + seconds);
        // If finished/timed out and adding time, reopen as playing so they can continue after refresh
        if (seconds > 0 && p.status === "finished" && p.timedOut) {
          p.status = "playing";
          p.timedOut = false;
          p.finishedAt = null;
        }
        writeDb(root, db);
        json(res, 200, { ok: true, player: p });
      } catch {
        json(res, 400, { ok: false, error: "Invalid payload" });
      }
      return;
    }

    if (url === "/api/admin/delete-player" && req.method === "POST") {
      if (LEADERBOARD_FROZEN) {
        json(res, 403, { ok: false, error: "Leaderboard frozen" });
        return;
      }
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw) as { password?: string; playerId?: string };
        if ((body.password ?? "") !== adminPassword()) {
          json(res, 401, { ok: false, error: "Unauthorized" });
          return;
        }
        if (!body.playerId) {
          json(res, 400, { ok: false, error: "playerId required" });
          return;
        }
        const db = ensureDb(root);
        const before = db.players.length;
        db.players = db.players.filter((p) => p.id !== body.playerId);
        if (db.players.length === before) {
          json(res, 404, { ok: false, error: "Player not found" });
          return;
        }
        const deleted = new Set(db.deletedIds ?? []);
        deleted.add(body.playerId);
        db.deletedIds = [...deleted];
        writeDb(root, db);
        json(res, 200, { ok: true });
      } catch {
        json(res, 400, { ok: false, error: "Invalid payload" });
      }
      return;
    }

    next();
  });
}

/** Disk-backed event DB + admin verify — survives Vite/server restarts. */
export function eventApiPlugin(): Plugin {
  return {
    name: "cos-event-api",
    configureServer(server) {
      attachApi(server, server.config.root);
    },
    configurePreviewServer(server) {
      attachApi(server, server.config.root);
    },
  };
}
