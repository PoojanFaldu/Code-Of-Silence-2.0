import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  getInvestigationState,
  isRoomUnlocked,
  resetInvestigationState,
  unlockServerRoomForTesting,
  type RoomKey,
} from "@/lib/investigationState";
import { resetProgressHud, seedProgressThroughArchives } from "@/lib/investigationProgress";
import { clearRunSession } from "@/lib/runSession";
import { setActivePlayerId, setAppliedBonusSeconds } from "@/lib/eventDb";
import InvestigationHud from "@/components/rooms/InvestigationHud";
import { useGame } from "@/contexts/GameContext";

const RoomOne = lazy(() => import("@/components/rooms/RoomOne"));
const RoomTwo = lazy(() => import("@/components/rooms/RoomTwo"));
const RoomThree = lazy(() => import("@/components/rooms/RoomThree"));
const RoomFour = lazy(() => import("@/components/rooms/RoomFour"));

function normalizeRoom(raw: string): RoomKey {
  const v = raw.toLowerCase();
  if (v === "research") return "research";
  if (v === "archive" || v === "archives") return "archive";
  if (v === "server") return "server";
  return "verma";
}

const Game = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { missionStarted, startMission, setPuzzleSolved, resetGame } = useGame();
  const roomName = normalizeRoom(searchParams.get("room") || "verma");
  const skipPrior = searchParams.get("skip") === "1";
  const [skipReady, setSkipReady] = useState(!skipPrior);

  useEffect(() => {
    if (skipPrior) {
      unlockServerRoomForTesting();
      seedProgressThroughArchives();
      setPuzzleSolved(true);
    }
    if (!missionStarted) startMission();
    setSkipReady(true);
  }, [skipPrior, missionStarted, startMission, setPuzzleSolved]);

  const unlocked = useMemo(
    () => skipPrior || isRoomUnlocked(roomName, getInvestigationState()),
    [roomName, skipPrior, skipReady]
  );

  useEffect(() => {
    if (!skipReady) return;
    if (!unlocked) {
      navigate("/?skipIntro=true", { replace: true });
    }
  }, [unlocked, navigate, skipReady]);

  const handleReset = () => {
    if (!window.confirm("Reset your local progress and start over?")) return;
    resetGame();
    clearRunSession();
    resetProgressHud();
    resetInvestigationState();
    setActivePlayerId(null);
    setAppliedBonusSeconds(0);
    startMission();
    navigate("/?skipIntro=true", { replace: true });
  };

  const getRoomComponent = () => {
    switch (roomName) {
      case "verma":
        return <RoomOne />;
      case "research":
        return <RoomTwo />;
      case "archive":
        return <RoomThree />;
      case "server":
        return <RoomFour />;
      default:
        return <RoomOne />;
    }
  };

  const getRoomTitle = () => {
    switch (roomName) {
      case "verma":
        return "Dr. Verma's Office";
      case "research":
        return "Research Lab";
      case "archive":
        return "Archives";
      case "server":
        return "Server Room";
      default:
        return "Loading Room";
    }
  };

  if (!skipReady || !unlocked) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-black text-white gap-4">
        <Lock className="w-10 h-10 text-red-500" />
        <p className="font-mono text-sm text-slate-300">
          {skipPrior ? "Opening Server Room…" : "Location locked — follow the evidence trail."}
        </p>
        {!skipPrior && (
          <Link to="/?skipIntro=true">
            <Button variant="outline">Return to Investigation Map</Button>
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black relative">
      <div className="fixed top-4 left-4 z-50 flex gap-2">
        <Link to="/?skipIntro=true">
          <Button
            variant="outline"
            size="sm"
            className="font-display font-bold bg-black/80 border-red-900/70 text-white hover:bg-red-900/20 hover:border-red-600"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Map
          </Button>
        </Link>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="font-display font-bold bg-black/80 border-white/20 text-slate-200 hover:bg-white/10 hover:border-white/40"
        >
          <RotateCcw className="w-4 h-4 mr-1.5" />
          Reset
        </Button>
      </div>

      <InvestigationHud currentRoom={roomName} />

      <Suspense
        fallback={
          <div className="h-screen w-screen flex flex-col items-center justify-center bg-black">
            <div className="relative mb-8">
              <div className="w-20 h-20 border-4 border-red-900/30 border-t-red-600 rounded-full animate-spin" />
            </div>
            <div className="text-red-600 text-3xl font-display font-bold mb-2 animate-pulse">
              {getRoomTitle()}
            </div>
            <div className="text-white/60 text-lg font-display mb-4">Loading investigation site...</div>
          </div>
        }
      >
        {getRoomComponent()}
      </Suspense>
    </div>
  );
};

export default Game;
