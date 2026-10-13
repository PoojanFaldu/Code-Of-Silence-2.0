import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { TitleScreen } from "@/components/intro/TitleScreen";
import { LogoReveal } from "@/components/intro/LogoReveal";
import { InvestigationMap } from "@/components/intro/InvestigationMap";
import { hasResumableMission, clearRunSession } from "@/lib/runSession";
import { resetInvestigationState } from "@/lib/investigationState";
import { resetProgressHud } from "@/lib/investigationProgress";
import { setActivePlayerId, setAppliedBonusSeconds } from "@/lib/eventDb";
import { useGame } from "@/contexts/GameContext";

type Phase = "title" | "logo" | "investigation";

const Index = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const skipToMap = searchParams.get("skipIntro") === "true";
  const newPlayer = searchParams.get("newPlayer") === "1";
  const { missionStarted, resetGame, startMission } = useGame();

  const [phase, setPhase] = useState<Phase>(() => {
    if (newPlayer) return "investigation";
    if (skipToMap || hasResumableMission() || missionStarted) return "investigation";
    return "title";
  });

  const wipeAndStart = () => {
    resetGame();
    clearRunSession();
    resetProgressHud();
    resetInvestigationState();
    setActivePlayerId(null);
    setAppliedBonusSeconds(0);
    startMission();
    setPhase("investigation");
    navigate("/?skipIntro=true", { replace: true });
  };

  // Free play: no name/password — wipe + start when ?newPlayer=1
  useEffect(() => {
    if (!newPlayer) return;
    wipeAndStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPlayer]);

  // Ensure mission clock runs when landing on the map
  useEffect(() => {
    if (phase === "investigation" && !missionStarted) {
      startMission();
    }
  }, [phase, missionStarted, startMission]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {phase === "title" && <TitleScreen onComplete={() => setPhase("logo")} />}
      {phase === "logo" && (
        <LogoReveal
          onComplete={() => {
            if (!missionStarted) startMission();
            setPhase("investigation");
            navigate("/?skipIntro=true", { replace: true });
          }}
        />
      )}
      {phase === "investigation" && <InvestigationMap />}
    </main>
  );
};

export default Index;
