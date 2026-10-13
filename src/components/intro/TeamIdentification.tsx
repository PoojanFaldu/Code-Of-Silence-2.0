import { useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { startGameAsPlayer, verifyStartPassword } from "@/lib/eventDb";
import { useGame } from "@/contexts/GameContext";
import { resetProgressHud } from "@/lib/investigationProgress";
import { resetInvestigationState } from "@/lib/investigationState";
import { clearRunSession } from "@/lib/runSession";

interface TeamIdentificationProps {
  onComplete: (playerName: string) => void;
}

export const TeamIdentification = ({ onComplete }: TeamIdentificationProps) => {
  const { resetGame, startMission } = useGame();
  const [adminPassword, setAdminPassword] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [error, setError] = useState("");

  const begin = async () => {
    setError("");
    const name = playerName.trim();
    if (!name) {
      setError("Enter a player name.");
      return;
    }
    const ok = await verifyStartPassword(adminPassword);
    if (!ok) {
      setError("Incorrect password.");
      return;
    }
    // Full wipe — clears deep-link skip unlock + prior room COMPLETE flags
    resetGame();
    clearRunSession();
    resetProgressHud();
    resetInvestigationState();
    startGameAsPlayer(name);
    startMission();
    onComplete(name);
  };

  const startAgainDifferentUser = () => {
    setAdminPassword("");
    setPlayerName("");
    setError("");
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-black flex items-center justify-center animate-fade-in">
      <div
        className="absolute top-0 left-0 w-96 h-96 bg-red-500/20 rounded-full blur-[120px] animate-pulse"
        style={{ animationDuration: "3s" }}
      />
      <div
        className="absolute bottom-0 right-0 w-96 h-96 bg-blue-500/20 rounded-full blur-[120px] animate-pulse"
        style={{ animationDuration: "3s", animationDelay: "1.5s" }}
      />

      <div className="relative z-10 w-full max-w-md px-6 animate-scale-in">
        <h1
          className="font-display text-4xl md:text-5xl font-black text-center mb-3 tracking-tight text-white"
          style={{
            textShadow: "0 0 20px rgba(0, 200, 255, 0.8), 0 0 40px rgba(0, 200, 255, 0.4)",
          }}
        >
          Start Investigation
        </h1>

        <p className="text-center text-white/60 font-body text-sm mb-10">
          Admin password required to begin a run.
        </p>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="admin-pw" className="font-body text-white/80 text-sm tracking-wide">
              Admin password
            </Label>
            <Input
              id="admin-pw"
              type="password"
              value={adminPassword}
              onChange={(e) => {
                setAdminPassword(e.target.value);
                setError("");
              }}
              placeholder="Admin password"
              className="h-12 bg-black/50 border-2 border-amber-500/30 text-white placeholder:text-white/30
                focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
              onKeyDown={(e) => e.key === "Enter" && begin()}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="player" className="font-body text-white/80 text-sm tracking-wide">
              Player name
            </Label>
            <Input
              id="player"
              type="text"
              value={playerName}
              onChange={(e) => {
                setPlayerName(e.target.value);
                setError("");
              }}
              placeholder="Enter player name"
              className="h-12 bg-black/50 border-2 border-cyan-500/30 text-white placeholder:text-white/30
                focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
              onKeyDown={(e) => e.key === "Enter" && begin()}
            />
          </div>
        </div>

        {error && <p className="mt-4 text-center text-sm text-rose-400">{error}</p>}

        <Button
          onClick={begin}
          disabled={!adminPassword.trim() || !playerName.trim()}
          className="w-full h-14 mt-8 font-display font-bold text-lg tracking-wide
            bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400
            text-white border-2 border-red-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Start Game
        </Button>

        <button
          type="button"
          onClick={startAgainDifferentUser}
          className="w-full mt-3 py-3 text-xs font-mono tracking-wider text-slate-400 hover:text-cyan-300 border border-white/10 rounded-lg hover:border-cyan-500/30 transition"
        >
          Start again with a different username
        </button>

        <div className="mt-6 text-center">
          <Link to="/leaderboard" className="text-[10px] font-mono text-slate-500 hover:text-slate-300">
            Leaderboard →
          </Link>
        </div>
      </div>
    </div>
  );
};
