import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import Index from "./pages/Index";
import Game from "./pages/Game";
import NotFound from "./pages/NotFound";
import CodeOfSilence from "./pages/CodeOfSilence";
import Leaderboard from "./pages/Leaderboard";
import Admin from "./pages/Admin";
import { useGame } from "./contexts/GameContext";
import GlobalTimer from "./components/common/GlobalTimer";

const queryClient = new QueryClient();

const TimedOutOverlay = () => {
  const { timedOut, missionStarted, resetGame } = useGame();
  const navigate = useNavigate();

  if (!timedOut || !missionStarted) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 p-6">
      <div className="max-w-md w-full text-center space-y-5 border border-rose-500/40 rounded-xl p-8 bg-rose-950/20">
        <h1 className="text-3xl font-black tracking-widest text-rose-400">TIME EXPIRED</h1>
        <p className="text-sm text-slate-300 leading-relaxed">
          The mission timer reached zero. Start again anytime — free play is not saved to the
          leaderboard.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              resetGame();
              navigate("/leaderboard");
            }}
            className="w-full py-3 bg-white text-black rounded font-bold text-sm tracking-widest"
          >
            VIEW LEADERBOARD
          </button>
          <button
            type="button"
            onClick={() => {
              resetGame();
              navigate("/?newPlayer=1");
            }}
            className="w-full py-2.5 border border-white/15 rounded font-mono text-xs tracking-wider text-slate-300 hover:text-white"
          >
            Play again
          </button>
        </div>
      </div>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <TimedOutOverlay />
        <GlobalTimer />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/game" element={<Game />} />
          <Route path="/code-of-silence" element={<CodeOfSilence />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
