import { createContext, useCallback, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { toast } from "sonner";
import { resetInvestigationState } from "@/lib/investigationState";
import { resetProgressHud } from "@/lib/investigationProgress";
import {
  getActivePlayerId,
  getAppliedBonusSeconds,
  loadEventDb,
  MISSION_DURATION_SECONDS,
  pushPlayerHeartbeat,
  recordTimeout,
  refreshEventDbFromServer,
  setAppliedBonusSeconds,
} from "@/lib/eventDb";
import { getCompletedTasks } from "@/lib/investigationProgress";
import { clearRunSession, loadRunSession, saveRunSession } from "@/lib/runSession";

/** Deducted from the mission timer on each wrong puzzle guess. */
export const WRONG_ANSWER_PENALTY_SECONDS = 120;
/** Deducted on each wrong final murderer accusation. */
export const WRONG_ACCUSATION_PENALTY_SECONDS = 600;

interface GameContextType {
  timeRemaining: number;
  timedOut: boolean;
  /** True only after admin starts a run with password + player name. */
  missionStarted: boolean;
  puzzleSolved: boolean;
  setPuzzleSolved: (solved: boolean) => void;
  websiteUrl: string;
  setWebsiteUrl: (url: string) => void;
  resetGame: () => void;
  /** Call after admin password + name succeed — starts the 60:00 countdown. */
  startMission: () => void;
  deductTime: (seconds: number) => void;
  /** Add time to the active mission clock (admin bonus). */
  addTime: (seconds: number) => void;
  penalizeWrongAnswer: () => void;
  penalizeWrongAccusation: () => void;
  clearTimedOut: () => void;
  gameStartTime: number | null;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

const GAME_DURATION = MISSION_DURATION_SECONDS;
const DEFAULT_WEBSITE_URL = "https://code-of-silence-unlocked-53719-03265-76-14967.lovable.app/";

function initialFromSession() {
  const s = loadRunSession();
  const activeId = getActivePlayerId();
  const resumable =
    s.missionStarted &&
    s.gameStartTime != null &&
    !s.timedOut &&
    (activeId ? (s.playerId == null || s.playerId === activeId) : true);

  if (!resumable) {
    return {
      gameStartTime: null as number | null,
      missionStarted: false,
      puzzleSolved: false,
      timeRemaining: GAME_DURATION,
      timedOut: false,
    };
  }

  const elapsed = Math.floor((Date.now() - (s.gameStartTime as number)) / 1000);
  const remaining = Math.max(0, GAME_DURATION + getAppliedBonusSeconds() - elapsed);
  return {
    gameStartTime: s.gameStartTime,
    missionStarted: true,
    puzzleSolved: s.puzzleSolved,
    timeRemaining: remaining,
    timedOut: remaining <= 0 || s.timedOut,
  };
}

export const GameProvider = ({ children }: { children: ReactNode }) => {
  const boot = initialFromSession();
  const [gameStartTime, setGameStartTime] = useState<number | null>(boot.gameStartTime);
  const [missionStarted, setMissionStarted] = useState(boot.missionStarted);
  const [puzzleSolved, setPuzzleSolvedState] = useState<boolean>(boot.puzzleSolved);
  const [websiteUrl, setWebsiteUrlState] = useState<string>(DEFAULT_WEBSITE_URL);
  const [timeRemaining, setTimeRemaining] = useState<number>(boot.timeRemaining);
  const [timedOut, setTimedOut] = useState(boot.timedOut);
  const timeRemainingRef = useRef(boot.timeRemaining);
  timeRemainingRef.current = timeRemaining;

  useEffect(() => {
    if (!missionStarted || timedOut || gameStartTime == null) return;

    const tick = () => {
      const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
      const remaining = Math.max(0, GAME_DURATION + getAppliedBonusSeconds() - elapsed);
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        setTimedOut(true);
        saveRunSession({ timedOut: true, missionStarted: true, gameStartTime });
        recordTimeout(GAME_DURATION + getAppliedBonusSeconds());
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [gameStartTime, missionStarted, timedOut]);

  useEffect(() => {
    if (!missionStarted || gameStartTime == null) return;
    saveRunSession({
      missionStarted: true,
      gameStartTime,
      timedOut,
      puzzleSolved,
      playerId: getActivePlayerId(),
    });
  }, [missionStarted, gameStartTime, timedOut, puzzleSolved]);

  const setPuzzleSolved = (solved: boolean) => {
    setPuzzleSolvedState(solved);
    saveRunSession({ puzzleSolved: solved });
  };

  const setWebsiteUrl = (url: string) => {
    setWebsiteUrlState(url);
  };

  const deductTime = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    const now = Date.now();
    setMissionStarted(true);
    setTimedOut(false);
    setGameStartTime((prev) => {
      const base = prev ?? (now - (GAME_DURATION + getAppliedBonusSeconds() - timeRemainingRef.current) * 1000);
      // Positive seconds = lose time (start earlier so elapsed grows).
      const next = base - seconds * 1000;
      saveRunSession({ gameStartTime: next, missionStarted: true, timedOut: false });
      return next;
    });
    setTimeRemaining((prev) => {
      const next = Math.max(0, prev - seconds);
      if (next <= 0) {
        setTimedOut(true);
        saveRunSession({ timedOut: true });
        recordTimeout(GAME_DURATION + getAppliedBonusSeconds());
      }
      return next;
    });
  }, []);

  const addTime = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    setTimedOut(false);
    setAppliedBonusSeconds(getAppliedBonusSeconds() + seconds);
    setTimeRemaining((prev) => prev + seconds);
    toast.success(
      `+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} added by admin.`
    );
  }, []);

  const penalizeWrongAnswer = useCallback(() => {
    deductTime(WRONG_ANSWER_PENALTY_SECONDS);
    toast.error("−2:00 deducted from mission timer.");
  }, [deductTime]);

  const penalizeWrongAccusation = useCallback(() => {
    deductTime(WRONG_ACCUSATION_PENALTY_SECONDS);
    toast.error("−10:00 deducted from mission timer.");
  }, [deductTime]);

  const clearTimedOut = useCallback(() => {
    setTimedOut(false);
  }, []);

  const resetGame = useCallback(() => {
    setGameStartTime(null);
    setMissionStarted(false);
    setPuzzleSolvedState(false);
    setWebsiteUrlState(DEFAULT_WEBSITE_URL);
    setTimeRemaining(GAME_DURATION);
    setTimedOut(false);
    clearRunSession();
    resetInvestigationState();
    resetProgressHud();
    setAppliedBonusSeconds(0);
  }, []);

  // Heartbeat + apply admin time bonuses
  useEffect(() => {
    if (!missionStarted || gameStartTime == null) return;

    const beat = () => {
      pushPlayerHeartbeat({
        completedTaskIds: getCompletedTasks(),
        gameStartTime,
        timeRemaining: timeRemainingRef.current,
      });
    };

    const pollBonus = async () => {
      await refreshEventDbFromServer();
      const id = getActivePlayerId();
      if (!id) return;
      const player = loadEventDb().players.find((p) => p.id === id);
      if (!player) return;
      const remoteBonus = player.timeBonusSeconds ?? 0;
      const applied = getAppliedBonusSeconds();
      if (remoteBonus > applied) {
        addTime(remoteBonus - applied);
      }
    };

    beat();
    const hb = window.setInterval(beat, 5000);
    const bonus = window.setInterval(() => void pollBonus(), 4000);
    void pollBonus();
    return () => {
      window.clearInterval(hb);
      window.clearInterval(bonus);
    };
  }, [missionStarted, gameStartTime, addTime]);

  const startMission = useCallback(() => {
    const existing = loadRunSession();
    const start = existing.gameStartTime ?? Date.now();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    setTimedOut(false);
    setPuzzleSolvedState(existing.puzzleSolved ?? false);
    setTimeRemaining(existing.gameStartTime ? remaining : GAME_DURATION);
    setGameStartTime(start);
    setMissionStarted(true);
    saveRunSession({
      missionStarted: true,
      gameStartTime: start,
      timedOut: false,
      puzzleSolved: existing.puzzleSolved ?? false,
      playerId: getActivePlayerId(),
    });
  }, []);

  return (
    <GameContext.Provider
      value={{
        timeRemaining,
        timedOut,
        missionStarted,
        puzzleSolved,
        setPuzzleSolved,
        websiteUrl,
        setWebsiteUrl,
        resetGame,
        startMission,
        deductTime,
        addTime,
        penalizeWrongAnswer,
        penalizeWrongAccusation,
        clearTimedOut,
        gameStartTime,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
};
