import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Beaker, FolderOpen, Server, Lock, CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingScreen } from "./LoadingScreen";
import { useGame } from "@/contexts/GameContext";
import { toast } from "sonner";
import {
  getInvestigationState,
  getRoomStatusLabel,
  isRoomUnlocked,
  mapLocationIdToRoom,
  resetInvestigationState,
  type RoomKey,
} from "@/lib/investigationState";
import { resetProgressHud } from "@/lib/investigationProgress";
import { clearRunSession } from "@/lib/runSession";
import { setActivePlayerId, setAppliedBonusSeconds } from "@/lib/eventDb";

interface Location {
  id: string;
  name: string;
  icon: React.ReactNode;
  position: { x: string; y: string };
  color: string;
}

interface Clue {
  text: string;
  answer: string;
  number: number;
}

interface LocationWithTeaser extends Location {
  teaser: string;
}

const locations: LocationWithTeaser[] = [
  {
    id: "office",
    name: "Dr. Verma's Office",
    icon: <BookOpen className="w-8 h-8" />,
    position: { x: "25%", y: "30%" },
    color: "hsl(45 100% 50%)",
    teaser: "A desk torn open… secrets once written, now gone.",
  },
  {
    id: "lab",
    name: "Research Lab",
    icon: <Beaker className="w-8 h-8" />,
    position: { x: "70%", y: "25%" },
    color: "hsl(180 100% 50%)",
    teaser: "The scent of chemicals and erased logs lingers.",
  },
  {
    id: "archive",
    name: "Archive Room",
    icon: <FolderOpen className="w-8 h-8" />,
    position: { x: "30%", y: "70%" },
    color: "hsl(120 100% 50%)",
    teaser: "Files missing, truths buried deep.",
  },
  {
    id: "server",
    name: "Server Room",
    icon: <Server className="w-8 h-8" />,
    position: { x: "75%", y: "65%" },
    color: "hsl(0 100% 50%)",
    teaser: "Data trails… wiped clean but still whispering.",
  },
];

const cluesData: Clue[] = [
  { text: "Files missing. Secrets exposed.", answer: "Archive Room", number: 3 },
  { text: "Chemicals. Logs erased.", answer: "Research Lab", number: 2 },
  { text: "Books scattered. Desk forced open.", answer: "Dr. Verma's Office", number: 1 },
  { text: "Logs wiped. Hour missing.", answer: "Server Room", number: 4 },
];

export const InvestigationMap = () => {
  const navigate = useNavigate();
  const { timeRemaining, puzzleSolved, setPuzzleSolved, resetGame, startMission } = useGame();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showPuzzle, setShowPuzzle] = useState(false);
  const [clues, setClues] = useState<Clue[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [revealedNumbers, setRevealedNumbers] = useState<Set<number>>(new Set());
  const [activeTeaserId, setActiveTeaserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState<LocationWithTeaser | null>(null);
  const [investTick, setInvestTick] = useState(0);

  useEffect(() => {
    // TEMP: prefill correct answers so rooms unlock without typing
    const shuffled = [...cluesData].sort(() => Math.random() - 0.5);
    const prefilled: Record<number, string> = {};
    shuffled.forEach((clue, index) => {
      prefilled[index] = clue.answer;
    });
    setClues(shuffled);
    setAnswers(prefilled);
    setRevealedNumbers(new Set(shuffled.map((c) => c.number)));
    setPuzzleSolved(true);
  }, [setPuzzleSolved]);

  useEffect(() => {
    // Refresh lock status when returning from a room
    setInvestTick((t) => t + 1);
    const onFocus = () => setInvestTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const investigation = getInvestigationState();
  void investTick;

  const handleLocationClick = (location: LocationWithTeaser) => {
    const room = mapLocationIdToRoom(location.id);
    if (!room || !isRoomUnlocked(room, investigation)) {
      toast.error("Location locked — follow the evidence trail from the previous site.");
      return;
    }
    setLoadingLocation(location);
    setIsLoading(true);
  };

  const statusFor = (id: string) => {
    const room = mapLocationIdToRoom(id) as RoomKey | null;
    if (!room) return "LOCKED";
    return getRoomStatusLabel(room, investigation);
  };

  const handleAnswerChange = (clueIndex: number, value: string) => {
    setAnswers(prev => ({ ...prev, [clueIndex]: value }));
    
    const clue = clues[clueIndex];
    if (clue && value.trim().toLowerCase() === clue.answer.toLowerCase()) {
      const newRevealedNumbers = new Set(revealedNumbers).add(clue.number);
      setRevealedNumbers(newRevealedNumbers);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const idToRoom = (id: string) => {
    switch (id) {
      case 'office': return 'verma';
      case 'lab': return 'research';
      case 'archive': return 'archive';
      case 'server': return 'server';
      default: return undefined;
    }
  };

  if (isLoading && loadingLocation) {
    return <LoadingScreen locationName={loadingLocation.name} locationColor={loadingLocation.color} roomId={idToRoom(loadingLocation.id)} />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-black animate-fade-in">
      {/* Blueprint Background Grid */}
      <div className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'linear-gradient(rgba(0, 200, 255, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 200, 255, 0.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      
      {/* Holographic Scan Lines */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-transparent to-cyan-500/10 animate-scan" />
      </div>
      
      {/* Police Siren Effect */}
      <div className="absolute top-0 left-0 w-32 h-32 bg-red-500/20 rounded-full blur-3xl animate-pulse"
        style={{ animationDuration: '2s' }}
      />
      <div className="absolute bottom-0 right-0 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl animate-pulse"
        style={{ animationDuration: '2s', animationDelay: '1s' }}
      />

      {!showPuzzle ? (
        <>
          {/* Map Section */}
          <div className="relative w-full max-w-6xl aspect-video mx-auto mt-32 px-4">
            {/* Title */}
            <div className="absolute -top-24 left-1/2 transform -translate-x-1/2 text-center w-full">
              <h2 className="font-display text-3xl md:text-4xl font-bold text-cyan-400 mb-2 animate-fade-in whitespace-nowrap drop-shadow-[0_0_20px_rgba(0,200,255,0.8)]">
                CODE OF SILENCE
              </h2>
              <p className="font-body text-white/60 tracking-wider animate-fade-in"
                style={{ animationDelay: '0.3s' }}>
                Follow the evidence trail — rooms unlock in order
              </p>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm("Reset your local progress and start over?")) return;
                  resetGame();
                  clearRunSession();
                  resetProgressHud();
                  resetInvestigationState();
                  setActivePlayerId(null);
                  setAppliedBonusSeconds(0);
                  startMission();
                  setInvestTick((t) => t + 1);
                  toast.success("Progress reset.");
                }}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono tracking-wider text-slate-300 border border-white/20 rounded hover:border-cyan-400/50 hover:text-cyan-300"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset progress
              </button>
            </div>
            
            {/* Connection Lines */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {locations.map((location, index) => {
                const nextLocation = locations[(index + 1) % locations.length];
                return (
                  <line
                    key={`line-${location.id}`}
                    x1={location.position.x}
                    y1={location.position.y}
                    x2={nextLocation.position.x}
                    y2={nextLocation.position.y}
                    stroke={location.color}
                    strokeWidth="2"
                    strokeDasharray="5,5"
                    opacity="0.3"
                    className="animate-dash"
                  />
                );
              })}
            </svg>
            
            {/* Location Markers */}
            {locations.map((location, index) => {
              const status = statusFor(location.id);
              const locked = status === "LOCKED";
              const complete = status === "COMPLETE";
              const markerColor = locked ? "hsl(0 0% 40%)" : location.color;
              return (
              <div
                key={location.id}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 group animate-marker-appear ${
                  locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                }`}
                style={{
                  left: location.position.x,
                  top: location.position.y,
                  animationDelay: `${index * 0.2}s`,
                }}
                onMouseEnter={() => setHoveredId(location.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => handleLocationClick(location)}
              >
                {!locked && (
                <div
                  className="absolute inset-0 rounded-full animate-ping opacity-50"
                  style={{
                    width: '200px',
                    height: '120px',
                    backgroundColor: markerColor,
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    animationDuration: '2s',
                  }}
                />
                )}
                
                {/* Marker Circle */}
                <div
                  className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
                    hoveredId === location.id && !locked ? 'scale-125' : 'scale-100'
                  }`}
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    border: `3px solid ${markerColor}`,
                    boxShadow: locked ? 'none' : `0 0 30px ${markerColor}, inset 0 0 20px ${markerColor}`,
                  }}
                >
                  <div style={{ color: markerColor }}>
                    {locked ? <Lock className="w-8 h-8" /> : complete ? <CheckCircle2 className="w-8 h-8" /> : location.icon}
                  </div>
                </div>

                {/* Location Label */}
                <div
                  className={`absolute top-24 left-1/2 transform -translate-x-1/2 whitespace-nowrap transition-all duration-300 ${
                    hoveredId === location.id ? 'opacity-100 translate-y-0' : 'opacity-70 translate-y-2'
                  }`}
                >
                  <div
                    className="px-4 py-2 rounded font-body text-sm font-semibold text-center"
                    style={{
                      backgroundColor: 'rgba(0, 0, 0, 0.9)',
                      border: `1px solid ${markerColor}`,
                      color: markerColor,
                      boxShadow: locked ? 'none' : `0 0 20px ${markerColor}`,
                    }}
                  >
                    <div>{location.name}</div>
                    <div className="text-[10px] tracking-wider mt-0.5 opacity-80">{status}</div>
                  </div>
                </div>
                
                {/* Hover Ring Effect */}
                {hoveredId === location.id && (
                  <div
                    className="absolute inset-0 rounded-full animate-ping"
                    style={{
                      width: '100px',
                      height: '100px',
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      border: `2px solid ${location.color}`,
                      animationDuration: '1s',
                    }}
                  />
                )}

                {/* Teaser Text - Appears on Click */}
                {activeTeaserId === location.id && (
                  <div
                    className="absolute top-28 left-1/2 transform -translate-x-1/2 animate-fade-in"
                    style={{ animationDuration: '0.5s', zIndex: 1000 }}
                  >
                    <div
                      className="px-6 py-3 rounded-lg font-body text-sm italic backdrop-blur-sm"
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.95)',
                        border: `2px solid ${location.color}`,
                        color: location.color,
                        boxShadow: `0 0 30px ${location.color}, inset 0 0 15px ${location.color}20`,
                        maxWidth: '640px',
                        whiteSpace: 'normal',
                        textAlign: 'center',
                        // keep a simple appear animation (rely on setTimeout to hide)
                        animation: 'fade-in 0.5s ease-out',
                      }}
                    >
                      {location.teaser}
                    </div>
                  </div>
                )}
              </div>
            );
            })}
          </div>
        </>
      ) : (
        <>
          {/* Puzzle Section */}
          <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-20">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-cyan-400 mb-4 text-center animate-fade-in"
              style={{
                textShadow: '0 0 20px rgba(0, 200, 255, 0.8)',
              }}>
              Decode the Investigation Sequence
            </h2>
            
            {/* Progress Indicator */}
            <div className="mb-8 text-center">
              <p className="font-body text-white/70 text-lg">
                Progress: <span className={`font-bold ${revealedNumbers.size === 4 ? 'text-green-400' : 'text-cyan-400'}`}>
                  {revealedNumbers.size}/4
                </span> clues solved
              </p>
            </div>

            {/* Clue Lines */}
            <div className="w-full max-w-3xl space-y-6">
              {clues.map((clue, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-4 animate-fade-in"
                  style={{ 
                    animationDelay: `${index * 0.15}s`,
                  }}
                >
                  {/* Clue Text */}
                  <div className="flex-1 px-6 py-4 rounded-lg border-2 border-white/20 bg-black/50 backdrop-blur-sm">
                    <p className="font-body text-white text-lg">
                      {clue.text}
                    </p>
                  </div>

                  {/* Input Box */}
                  <div className="relative w-72">
                    <Input
                      type="text"
                      value={answers[index] || ''}
                      onChange={(e) => handleAnswerChange(index, e.target.value)}
                      placeholder="Enter room name"
                      className="h-12 bg-black/50 border-2 border-cyan-500/30 text-white placeholder:text-white/30 font-body
                        focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition-all duration-300"
                      style={{
                        boxShadow: '0 0 20px rgba(0, 200, 255, 0.1)',
                      }}
                    />
                  </div>

                  {/* Revealed Number */}
                  <div className="w-16 h-12 flex items-center justify-center">
                    {revealedNumbers.has(clue.number) && (
                      <div 
                        className="font-mono text-3xl font-bold animate-scale-in"
                        style={{
                          color: 'hsl(0 100% 60%)',
                          textShadow: '0 0 20px rgba(255, 0, 0, 0.8), 0 0 40px rgba(255, 0, 0, 0.4)',
                          animation: 'scale-in 0.3s ease-out, pulse 1.5s ease-in-out',
                        }}
                      >
                        {clue.number}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Back to Map Button */}
            <Button
              onClick={() => setShowPuzzle(false)}
              className="mt-12 h-12 px-6 font-body font-semibold bg-black/50 hover:bg-black/70 text-white border-2 border-white/30 hover:border-white/50 transition-all duration-300"
            >
              ⬅ Back to Map
            </Button>
          </div>
        </>
      )}

      {/* Corner Grid Accents */}
      <div className="absolute top-0 left-0 w-32 h-32 border-t-2 border-l-2 border-cyan-500/50" />
      <div className="absolute top-0 right-0 w-32 h-32 border-t-2 border-r-2 border-cyan-500/50" />
      <div className="absolute bottom-0 left-0 w-32 h-32 border-b-2 border-l-2 border-cyan-500/50" />
      <div className="absolute bottom-0 right-0 w-32 h-32 border-b-2 border-r-2 border-cyan-500/50" />
    </div>
  );
};
