import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  EVENT_DB_EVENT,
  formatFinishTime,
  formatTimeUsed,
  loadEventDb,
  refreshEventDbFromServer,
  type PlayerRecord,
} from "@/lib/eventDb";

function guessLabel(p: PlayerRecord) {
  if (p.murderGuess === "correct") return "Correct";
  if (p.murderGuess === "incorrect") return "Wrong";
  return "—";
}

export default function Leaderboard() {
  const [players, setPlayers] = useState<PlayerRecord[]>([]);

  useEffect(() => {
    const refresh = () => setPlayers(loadEventDb().players);
    const pull = () => {
      void refreshEventDbFromServer().then((db) => setPlayers(db.players));
    };
    pull();
    window.addEventListener(EVENT_DB_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const id = window.setInterval(pull, 2500);
    return () => {
      window.removeEventListener(EVENT_DB_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.clearInterval(id);
    };
  }, []);

  const sorted = [...players].sort((a, b) => {
    const rank = (p: PlayerRecord) => {
      if (p.murderGuess === "correct") return 0;
      if (p.status === "finished") return 1;
      if (p.status === "playing") return 2;
      return 3;
    };
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    if (a.murderGuess === "correct" && b.murderGuess === "correct") {
      return (a.timeUsedSeconds ?? 99999) - (b.timeUsedSeconds ?? 99999);
    }
    return b.puzzlesPassed - a.puzzlesPassed;
  });

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-[0.2em]">LEADERBOARD</h1>
            <p className="text-xs text-slate-500 mt-1 font-mono">
              CODE OF SILENCE · FINAL RESULTS · FROZEN
            </p>
          </div>
          <div className="flex gap-3 text-xs font-mono">
            <Link to="/?newPlayer=1" className="text-cyan-400 hover:text-cyan-300">
              Play again
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-cyan-500/20 overflow-x-auto bg-gradient-to-b from-cyan-950/20 to-black">
          <table className="w-full text-left text-sm min-w-[720px]">
            <thead className="bg-black/60 text-[10px] uppercase tracking-wider text-cyan-400/80">
              <tr>
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Puzzles</th>
                <th className="px-4 py-3">Guess</th>
                <th className="px-4 py-3">Time used</th>
                <th className="px-4 py-3">Time out</th>
                <th className="px-4 py-3">Finished at</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    No results recorded.
                  </td>
                </tr>
              ) : (
                sorted.map((p) => (
                  <tr key={p.id} className="border-t border-white/10">
                    <td className="px-4 py-3 font-semibold">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-cyan-200">{p.puzzlesPassed}</td>
                    <td
                      className={`px-4 py-3 font-mono text-xs tracking-wide ${
                        p.murderGuess === "correct"
                          ? "text-emerald-400"
                          : p.murderGuess === "incorrect"
                            ? "text-rose-400"
                            : "text-slate-500"
                      }`}
                    >
                      {guessLabel(p)}
                    </td>
                    <td className="px-4 py-3 font-mono text-cyan-100/90">
                      {formatTimeUsed(p.timeUsedSeconds)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {p.timedOut ? (
                        <span className="text-amber-400">YES</span>
                      ) : (
                        <span className="text-slate-600">no</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                      {formatFinishTime(p.finishedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-600 font-mono">
          Time used = mission time consumed (includes −2:00 puzzle and −10:00 accusation penalties).
        </p>
      </div>
    </div>
  );
}
