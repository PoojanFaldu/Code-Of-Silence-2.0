/** Persist active mission timer + in-room puzzle steps across refresh. */

import { getActivePlayerId, LEADERBOARD_FROZEN } from "@/lib/eventDb";

export type RoomId = "verma" | "research" | "archive" | "server";

export type RoomFourFlags = {
  step: number;
  sessionDone: boolean;
  uvEnabled: boolean;
  wiresDone: boolean;
  cctvUnlocked: boolean;
};

export type RunSession = {
  playerId: string | null;
  missionStarted: boolean;
  /** Absolute timeline anchor (penalties shift this earlier). */
  gameStartTime: number | null;
  timedOut: boolean;
  puzzleSolved: boolean;
  rooms: {
    verma: { step: number };
    research: { step: number };
    archive: { step: number; hashSolved: boolean; archiveSolved: boolean };
    server: RoomFourFlags;
  };
};

const KEY = "cos_run_session";

const DEFAULT_SESSION: RunSession = {
  playerId: null,
  missionStarted: false,
  gameStartTime: null,
  timedOut: false,
  puzzleSolved: false,
  rooms: {
    verma: { step: 0 },
    research: { step: 0 },
    archive: { step: 0, hashSolved: false, archiveSolved: false },
    server: {
      step: 0,
      sessionDone: false,
      uvEnabled: false,
      wiresDone: false,
      cctvUnlocked: false,
    },
  },
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadRunSession(): RunSession {
  if (!canUseStorage()) return structuredClone(DEFAULT_SESSION);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SESSION);
    const parsed = JSON.parse(raw) as Partial<RunSession>;
    return {
      ...structuredClone(DEFAULT_SESSION),
      ...parsed,
      rooms: {
        verma: { ...DEFAULT_SESSION.rooms.verma, ...parsed.rooms?.verma },
        research: { ...DEFAULT_SESSION.rooms.research, ...parsed.rooms?.research },
        archive: { ...DEFAULT_SESSION.rooms.archive, ...parsed.rooms?.archive },
        server: { ...DEFAULT_SESSION.rooms.server, ...parsed.rooms?.server },
      },
    };
  } catch {
    return structuredClone(DEFAULT_SESSION);
  }
}

export function saveRunSession(patch: Partial<RunSession>) {
  if (!canUseStorage()) return;
  const current = loadRunSession();
  const next: RunSession = {
    ...current,
    ...patch,
    rooms: patch.rooms
      ? {
          verma: { ...current.rooms.verma, ...patch.rooms.verma },
          research: { ...current.rooms.research, ...patch.rooms.research },
          archive: { ...current.rooms.archive, ...patch.rooms.archive },
          server: { ...current.rooms.server, ...patch.rooms.server },
        }
      : current.rooms,
    playerId: patch.playerId !== undefined ? patch.playerId : getActivePlayerId() ?? current.playerId,
  };
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function clearRunSession() {
  if (!canUseStorage()) return;
  localStorage.removeItem(KEY);
}

export function setRoomStep(room: "verma" | "research", step: number) {
  const s = loadRunSession();
  saveRunSession({
    rooms: {
      ...s.rooms,
      [room]: { ...s.rooms[room], step },
    },
  });
}

export function setArchiveRoomProgress(patch: Partial<RunSession["rooms"]["archive"]>) {
  const s = loadRunSession();
  saveRunSession({
    rooms: {
      ...s.rooms,
      archive: { ...s.rooms.archive, ...patch },
    },
  });
}

export function setServerRoomProgress(patch: Partial<RoomFourFlags>) {
  const s = loadRunSession();
  saveRunSession({
    rooms: {
      ...s.rooms,
      server: { ...s.rooms.server, ...patch },
    },
  });
}

export function hasResumableMission(): boolean {
  const s = loadRunSession();
  if (!s.missionStarted || s.gameStartTime == null || s.timedOut) return false;
  // Free-play (frozen LB) has no leaderboard player id — resume from local session alone
  if (LEADERBOARD_FROZEN) return true;
  return Boolean(getActivePlayerId());
}
