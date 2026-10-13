/** Lightweight persistent investigation state for Code of Silence */

import { resetProgressHud } from "@/lib/investigationProgress";

export type RoomKey = "verma" | "research" | "archive" | "server";

export type InvestigationState = {
  room1Complete: boolean;
  room2Complete: boolean;
  room3Complete: boolean;
  room4Complete: boolean;
  nehaSuspect: boolean;
  nehaRedHerringRevealed: boolean;
  arjunEvidenceFound: boolean;
  finalUnlocked: boolean;
  caseSolved: boolean;
};

const STORAGE_KEY = "the_last_session_investigation";
/** Session-only deep-link unlock (`?skip=1`) — must not mark rooms COMPLETE. */
const SKIP_UNLOCK_KEY = "cos_skip_unlock";

const DEFAULT_STATE: InvestigationState = {
  room1Complete: false,
  room2Complete: false,
  room3Complete: false,
  room4Complete: false,
  nehaSuspect: false,
  nehaRedHerringRevealed: false,
  arjunEvidenceFound: false,
  finalUnlocked: false,
  caseSolved: false,
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readRaw(): string | null {
  if (!canUseStorage()) return null;
  const local = localStorage.getItem(STORAGE_KEY);
  if (local != null) return local;
  try {
    const session = sessionStorage.getItem(STORAGE_KEY);
    if (session != null) {
      localStorage.setItem(STORAGE_KEY, session);
      return session;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function getInvestigationState(): InvestigationState {
  if (!canUseStorage()) return { ...DEFAULT_STATE };
  try {
    const raw = readRaw();
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function setInvestigationState(patch: Partial<InvestigationState>): InvestigationState {
  const next = { ...getInvestigationState(), ...patch };
  if (canUseStorage()) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return next;
}

export function isSkipUnlockActive(): boolean {
  if (!canUseStorage()) return false;
  try {
    return sessionStorage.getItem(SKIP_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearSkipUnlock() {
  if (!canUseStorage()) return;
  try {
    sessionStorage.removeItem(SKIP_UNLOCK_KEY);
  } catch {
    /* ignore */
  }
}

/** Wipe room completion, HUD tasks, and deep-link skip unlock. */
export function resetInvestigationState() {
  if (canUseStorage()) {
    localStorage.removeItem(STORAGE_KEY);
    const keys = [
      "room1_neha_suspect",
      "room1_to_lab",
      "room2_neha_suspect",
      "room2_exp17_archive",
      "room2_history_missing",
      "room3_puzzle5_solved",
      "room3_puzzle6_solved",
    ];
    keys.forEach((k) => {
      localStorage.removeItem(k);
      try {
        sessionStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    });
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    clearSkipUnlock();
  }
  resetProgressHud();
}

/**
 * Dev/test deep-link (`?skip=1`): unlock all rooms for this browser tab only.
 * Does NOT mark rooms COMPLETE — New Player must start from a clean map.
 */
export function unlockServerRoomForTesting() {
  if (!canUseStorage()) return;
  try {
    sessionStorage.setItem(SKIP_UNLOCK_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Room unlock rules for continuous investigation */
export function isRoomUnlocked(room: RoomKey, state = getInvestigationState()): boolean {
  if (isSkipUnlockActive()) return true;
  switch (room) {
    case "verma":
      return true;
    case "research":
      return state.room1Complete;
    case "archive":
      return state.room2Complete;
    case "server":
      return state.room3Complete;
    default:
      return false;
  }
}

export function isRoomComplete(room: RoomKey, state = getInvestigationState()): boolean {
  switch (room) {
    case "verma":
      return state.room1Complete;
    case "research":
      return state.room2Complete;
    case "archive":
      return state.room3Complete;
    case "server":
      return state.room4Complete;
    default:
      return false;
  }
}

export function mapLocationIdToRoom(id: string): RoomKey | null {
  switch (id) {
    case "office":
    case "verma":
      return "verma";
    case "lab":
    case "research":
      return "research";
    case "archive":
    case "archives":
      return "archive";
    case "server":
      return "server";
    default:
      return null;
  }
}

export function getRoomStatusLabel(room: RoomKey, state = getInvestigationState()): string {
  if (isRoomComplete(room, state)) return "COMPLETE";
  if (isRoomUnlocked(room, state)) return "AVAILABLE";
  return "LOCKED";
}

/** Acceptable answers for final accusation */
export function isCorrectMurderer(answer: string): boolean {
  const n = answer.toLowerCase().trim().replace(/\s+/g, " ");
  return (
    n === "arjun" ||
    n === "arjun mehta" ||
    n === "dr arjun mehta" ||
    n === "dr. arjun mehta" ||
    n === "doctor arjun mehta"
  );
}

export function isNehaAccusation(answer: string): boolean {
  const n = answer.toLowerCase().trim().replace(/\s+/g, " ");
  return n === "neha" || n === "neha rao" || n === "n. rao" || n === "n rao";
}
