import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useGLTF, PerspectiveCamera, Box, Cylinder } from "@react-three/drei";
import * as THREE from "three";
import FirstPersonController from "@/components/rooms/interaction/FirstPersonController";
import FocusDetector from "@/components/rooms/interaction/FocusDetector";
import CrosshairHud from "@/components/rooms/interaction/CrosshairHud";
import ActivePulse from "@/components/rooms/interaction/ActivePulse";
import type { FocusedInteractable, InteractTarget } from "@/components/rooms/interaction/types";
import SessionIdentificationPuzzle from "@/components/rooms/roomFour/SessionIdentificationPuzzle";
import TangledWiresPuzzle from "@/components/rooms/roomFour/TangledWiresPuzzle";
import CctvMonitor, { CCTV_CODE } from "@/components/rooms/roomFour/CctvMonitor";
import { useGame } from "@/contexts/GameContext";
import { setInvestigationState } from "@/lib/investigationState";
import { completeTask, unlockLog } from "@/lib/investigationProgress";
import { MISSION_DURATION_SECONDS, recordMurderGuess } from "@/lib/eventDb";
import { loadRunSession, setServerRoomProgress } from "@/lib/runSession";
import { Eye, Sparkles, ArrowRight, X, FileText } from "lucide-react";

/** 0 session → 1 flashlight → 2 UV → 3 wires → 4 monitor → accuse */
type Step = 0 | 1 | 2 | 3 | 4;

const ROOM4_BOUNDARY = {
  minX: -0.401,
  maxX: 0.635,
  minZ: 4.446,
  maxZ: 5.826,
  y: 3,
};

const BOX_POS: [number, number, number] = [0.81, 2.805, 4.5];
const FLASHLIGHT_POS: [number, number, number] = [-0.2, 2.76, 4.2];
/** Glass coffee table — small nudge up/in from the rim seat. */
const PAPER_POS: [number, number, number] = [0.78, 2.850, 5.38];
/** Note on the window table displaying the code for the monitor. */
const MONITOR_CODE_POS: [number, number, number] = [0.26, 2.824, 4.08];
/**
 * CCTV monitor — edit ONLY these two.
 * Position = stand base. Rotation = [x, y, z] radians (try y: 0, ±Math.PI/2, Math.PI).
 * Interact target is derived from the screen face so you don't need a second position.
 */
const MONITOR_POS: [number, number, number] = [-0.61, 2.827, 5.49];
const MONITOR_ROT: [number, number, number] = [0, Math.PI / 2, 0];
/** Local offset of the screen plane inside MonitorMesh (keep in sync with that mesh). */
const MONITOR_SCREEN_LOCAL: [number, number, number] = [0, 0.135, 0.021];

function monitorInteractPos(): [number, number, number] {
  const local = new THREE.Vector3(...MONITOR_SCREEN_LOCAL);
  local.applyEuler(new THREE.Euler(...MONITOR_ROT, "XYZ"));
  return [MONITOR_POS[0] + local.x, MONITOR_POS[1] + local.y, MONITOR_POS[2] + local.z];
}

const MONITOR_INTERACT_POS = monitorInteractPos();
const WIRES_POS: [number, number, number] = [0.35, 2.7, 5.35];

const LoadModel = () => {
  const { scene } = useGLTF("/model/RoomFourModel.glb");

  useEffect(() => {
    if (scene) {
      scene.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          // Remove the unused retro TV mesh from the equipment stand so our monitor sits there cleanly
          if (mesh.name === "Object_47" && mesh.geometry && mesh.geometry.index && !mesh.userData.tvFiltered) {
            mesh.userData.tvFiltered = true;
            const indexAttr = mesh.geometry.index;
            const posAttr = mesh.geometry.attributes.position;
            const indices = indexAttr.array;
            const newIndices: number[] = [];

            for (let i = 0; i < indices.length; i += 3) {
              const i0 = indices[i];
              const i1 = indices[i + 1];
              const i2 = indices[i + 2];

              const cx = (posAttr.getX(i0) + posAttr.getX(i1) + posAttr.getX(i2)) / 3;
              const cy = (posAttr.getY(i0) + posAttr.getY(i1) + posAttr.getY(i2)) / 3;
              const cz = (posAttr.getZ(i0) + posAttr.getZ(i1) + posAttr.getZ(i2)) / 3;

              // Filter out the vintage TV model on the stand (local mesh coordinates)
              if (cx >= -3.55 && cx <= -0.70 && cy >= -1.07 && cy <= 0.80 && cz >= 2.55 && cz <= 7.30) {
                continue;
              }
              newIndices.push(i0, i1, i2);
            }

            mesh.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
            mesh.geometry.needsUpdate = true;
          }
        }
      });
    }
  }, [scene]);

  return <primitive object={scene} position={[0, 2.5, 5]} scale={0.12} />;
};

function UvPaperSheet({ uvOn }: { uvOn: boolean }) {
  return (
    <group position={PAPER_POS} rotation={[0.02, 0.35, 0]} scale={0.4}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.18, 0.003, 0.22]} />
        <meshStandardMaterial color={uvOn ? "#e9d5ff" : "#e7e5e4"} />
      </mesh>
    </group>
  );
}

function RelayPanelMesh() {
  return (
    <group position={WIRES_POS} rotation={[0, 0.4, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.14, 0.18, 0.03]} />
        <meshStandardMaterial color="#22272e" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.017]}>
        <planeGeometry args={[0.1, 0.14]} />
        <meshStandardMaterial color="#67e8f9" emissive="#0e7490" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

function MonitorMesh({ lit }: { lit: boolean }) {
  return (
    <group position={MONITOR_POS} rotation={MONITOR_ROT}>
      {/* Heavy Desktop Stand Base (sits flush on equipment stand at y=0) */}
      <mesh position={[0, 0.005, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 0.01, 0.13]} />
        <meshStandardMaterial color="#1f2329" metalness={0.8} roughness={0.3} />
      </mesh>

      {/* Chamfered Base Rim */}
      <mesh position={[0, 0.002, 0]}>
        <boxGeometry args={[0.168, 0.004, 0.138]} />
        <meshStandardMaterial color="#0f1115" metalness={0.6} roughness={0.5} />
      </mesh>

      {/* Vertical Stand Column / Riser */}
      <mesh position={[0, 0.065, -0.018]} castShadow>
        <boxGeometry args={[0.03, 0.12, 0.024]} />
        <meshStandardMaterial color="#1a1d22" metalness={0.85} roughness={0.25} />
      </mesh>

      {/* Swivel Tilt Hinge at top of stand neck */}
      <mesh position={[0, 0.125, -0.012]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.014, 0.014, 0.034, 12]} />
        <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
      </mesh>

      {/* VESA Mounting Bracket on back of monitor */}
      <mesh position={[0, 0.135, -0.02]} castShadow>
        <boxGeometry args={[0.08, 0.08, 0.01]} />
        <meshStandardMaterial color="#2a2e36" metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Monitor Main Housing / Bezel */}
      <mesh position={[0, 0.135, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.26, 0.18, 0.036]} />
        <meshStandardMaterial color="#111317" metalness={0.4} roughness={0.5} />
      </mesh>

      {/* Inner Screen Bezel Frame */}
      <mesh position={[0, 0.135, 0.018]}>
        <boxGeometry args={[0.23, 0.155, 0.004]} />
        <meshStandardMaterial color="#08090b" roughness={0.7} />
      </mesh>

      {/* Screen Display Face (lit / glowing CCTV feed or dark standby) */}
      <mesh position={[0, 0.135, 0.021]}>
        <planeGeometry args={[0.215, 0.14]} />
        <meshStandardMaterial
          color={lit ? "#22d3ee" : "#0f172a"}
          emissive={lit ? "#0891b2" : "#020617"}
          emissiveIntensity={lit ? 1.5 : 0.15}
          roughness={0.25}
        />
      </mesh>

      {/* Status LEDs on bottom-right bezel (Green power when lit / Red standby when unlit) */}
      <mesh position={[0.09, 0.065, 0.02]}>
        <circleGeometry args={[0.003, 8]} />
        <meshBasicMaterial color={lit ? "#10b981" : "#ef4444"} />
      </mesh>
      <mesh position={[0.10, 0.065, 0.02]}>
        <circleGeometry args={[0.0025, 8]} />
        <meshBasicMaterial color={lit ? "#38bdf8" : "#334155"} />
      </mesh>

      {/* Desktop Cable Coil (runs from stand neck back towards the wall) */}
      <mesh position={[0.015, 0.004, -0.05]} rotation={[0, 0.25, Math.PI / 2]}>
        <cylinderGeometry args={[0.004, 0.004, 0.08, 8]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.8} />
      </mesh>
    </group>
  );
}

function MonitorCodeNote() {
  const noteTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 384;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Bright amber/yellow sticky note background
    ctx.fillStyle = "#fef08a";
    ctx.fillRect(0, 0, 512, 384);

    // Warm border
    ctx.strokeStyle = "#eab308";
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 502, 374);

    // Dark header banner
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(24, 28, 464, 76);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 32px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CODE FOR MONITOR", 256, 66);

    // Large 3-digit CCTV code (847)
    ctx.fillStyle = "#020617";
    ctx.font = "900 128px monospace";
    ctx.fillText(CCTV_CODE, 256, 215);

    // Bottom caption
    ctx.fillStyle = "#475569";
    ctx.font = "bold 24px monospace";
    ctx.fillText("CCTV ACCESS CODE", 256, 318);

    // Top tape strip
    ctx.fillStyle = "rgba(251, 191, 36, 0.85)";
    ctx.fillRect(206, 0, 100, 22);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }, []);

  return (
    <group position={MONITOR_CODE_POS} rotation={[-Math.PI / 2 + 0.16, 0, -0.15]}>
      <mesh castShadow receiveShadow>
        <planeGeometry args={[0.18, 0.135]} />
        {noteTexture ? (
          <meshStandardMaterial
            map={noteTexture}
            emissive="#ca8a04"
            emissiveIntensity={0.25}
            roughness={0.4}
            side={THREE.DoubleSide}
          />
        ) : (
          <meshStandardMaterial color="#fef08a" side={THREE.DoubleSide} />
        )}
      </mesh>
    </group>
  );
}

/** Normalize typed accusation: ignore case, punctuation, and extra spaces. */
function normalizeAccusation(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^dr\s+/, "")
    .trim();
}

function isArjunAccusation(raw: string) {
  const s = normalizeAccusation(raw);
  return s === "arjun" || s === "mehta" || s === "arjun mehta" || s === "mehta arjun";
}

function isNehaAccusation(raw: string) {
  const s = normalizeAccusation(raw);
  return s === "neha" || s === "rao" || s === "neha rao" || s === "rao neha";
}

function isKaranAccusation(raw: string) {
  const s = normalizeAccusation(raw);
  return s === "karan" || s === "patel" || s === "karan patel" || s === "patel karan";
}

function isRohanAccusation(raw: string) {
  const s = normalizeAccusation(raw);
  return s === "rohan" || s === "desai" || s === "rohan desai" || s === "desai rohan";
}

function isSameerAccusation(raw: string) {
  const s = normalizeAccusation(raw);
  return s === "sameer" || s === "shah" || s === "sameer shah" || s === "shah sameer";
}

const RoomFour = () => {
  const { penalizeWrongAccusation, timeRemaining } = useGame();
  const savedServer = loadRunSession().rooms.server;
  const [showSession, setShowSession] = useState(false);
  const [sessionDone, setSessionDone] = useState(() => savedServer.sessionDone);
  const [uvEnabled, setUvEnabled] = useState(() => savedServer.uvEnabled);
  const [showUvClue, setShowUvClue] = useState(false);
  const [showWires, setShowWires] = useState(false);
  const [wiresDone, setWiresDone] = useState(() => savedServer.wiresDone);
  const [showMonitor, setShowMonitor] = useState(false);
  const [cctvUnlocked, setCctvUnlocked] = useState(() => savedServer.cctvUnlocked);
  const [showMonitorCodeNote, setShowMonitorCodeNote] = useState(false);
  const [showFinalQuestion, setShowFinalQuestion] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [accusation, setAccusation] = useState("");
  const [answerError, setAnswerError] = useState("");
  const [focused, setFocused] = useState<FocusedInteractable>(null);
  const [step, setStepState] = useState<Step>(() => {
    return Math.min(4, Math.max(0, savedServer.step)) as Step;
  });
  const setStep = (next: Step) => {
    setStepState(next);
    setServerRoomProgress({ step: next });
  };

  const modalOpen =
    showSession || showUvClue || showWires || showMonitor || showFinalQuestion || gameWon || showMonitorCodeNote;
  const controlsEnabled = !modalOpen;

  const activePos =
    step === 0
      ? BOX_POS
      : step === 1
        ? FLASHLIGHT_POS
        : step === 2
          ? PAPER_POS
          : step === 3
            ? WIRES_POS
            : step === 4
              ? MONITOR_INTERACT_POS
              : null;

  const targets: InteractTarget[] = useMemo(
    () => [
      {
        id: "box",
        label: sessionDone ? "Session terminal" : "Session log",
        position: BOX_POS,
        active: step === 0,
        maxDistance: 1.8,
      },
      {
        id: "flashlight",
        label: uvEnabled ? "UV flashlight (on)" : "UV flashlight",
        position: FLASHLIGHT_POS,
        active: step === 1,
        maxDistance: 1.8,
      },
      {
        id: "paper",
        label: "Faded printout",
        position: PAPER_POS,
        active: step === 2 && uvEnabled,
        maxDistance: 1.8,
      },
      {
        id: "wires",
        label: "Relay circuit",
        position: WIRES_POS,
        active: step === 3 && !wiresDone,
        maxDistance: 1.8,
      },
      {
        id: "monitor",
        label: cctvUnlocked ? "CCTV feed" : "CCTV monitor",
        position: MONITOR_INTERACT_POS,
        active: step === 4 && wiresDone,
        maxDistance: 2.3,
      },
      {
        id: "monitor_code",
        label: "Code for monitor",
        position: MONITOR_CODE_POS,
        active: true,
        maxDistance: 2.5,
      },
    ],
    [step, sessionDone, uvEnabled, wiresDone, cctvUnlocked]
  );

  const handleInteract = (id: string) => {
    if (id === "monitor_code") {
      setShowMonitorCodeNote(true);
    }
    if (id === "box" && step === 0) {
      if (sessionDone) setStep(1);
      else setShowSession(true);
    }
    if (id === "flashlight" && step === 1) {
      setUvEnabled(true);
      setStep(2);
      setServerRoomProgress({ uvEnabled: true, step: 2 });
    }
    if (id === "paper" && step === 2 && uvEnabled) {
      setShowUvClue(true);
    }
    if (id === "wires" && step === 3 && !wiresDone) {
      setShowWires(true);
    }
    if (id === "monitor" && wiresDone) {
      setShowMonitor(true);
    }
  };

  const accuse = () => {
    const timeUsed = Math.max(0, MISSION_DURATION_SECONDS - timeRemaining);
    if (isArjunAccusation(accusation)) {
      completeTask("accusation");
      recordMurderGuess(accusation.trim(), true, timeUsed);
      setInvestigationState({ room4Complete: true, caseSolved: true });
      setGameWon(true);
      setShowFinalQuestion(false);
      return;
    }
    recordMurderGuess(accusation.trim(), false, timeUsed);
    penalizeWrongAccusation();
    if (isNehaAccusation(accusation)) {
      setAnswerError("Neha Rao was investigating after the fact.\nTry again.");
      return;
    }
    if (isKaranAccusation(accusation)) {
      setAnswerError("Technical access alone does not prove the murder.\nTry again.");
      return;
    }
    if (isRohanAccusation(accusation)) {
      setAnswerError("Security admin work does not connect him to the murder.\nTry again.");
      return;
    }
    if (isSameerAccusation(accusation)) {
      setAnswerError(
        "Sameer had a motive, but the evidence does not connect him to the murder.\nTry again."
      );
      return;
    }
    setAnswerError("That name does not fit the evidence.\nTry again.");
  };

  return (
    <div className="h-screen w-screen bg-black relative">
      <Canvas camera={{ position: [0, 3, 5], fov: 75 }}>
        <PerspectiveCamera makeDefault position={[0, 3, 5]} fov={75} />

        {uvEnabled ? (
          <>
            <ambientLight intensity={0.8} color="#8a2be2" />
            <pointLight position={[0, 5, 0]} intensity={0.5} color="#4b0082" />
          </>
        ) : (
          <>
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
            <pointLight position={[0, 5, 0]} intensity={1} />
            <pointLight position={[5, 3, 5]} intensity={0.5} color="#ffffff" />
          </>
        )}

        <Suspense fallback={null}>
          <LoadModel />
          {(step >= 2 || uvEnabled) && <UvPaperSheet uvOn={uvEnabled} />}
          {step === 3 && !wiresDone && <RelayPanelMesh />}
          <MonitorMesh lit={step === 4 || cctvUnlocked} />
          <MonitorCodeNote />

          <group position={BOX_POS}>
            <Box scale={[0.15, 0.08, 0.15]}>
              <meshStandardMaterial color={sessionDone ? "#3f6212" : "#444444"} />
            </Box>
          </group>

          {step >= 1 && (
            <group position={FLASHLIGHT_POS}>
              <Cylinder rotation={[0, 0, Math.PI / 2]} scale={[0.02, 0.12, 0.02]}>
                <meshStandardMaterial color="#111111" metalness={0.4} roughness={0.4} />
              </Cylinder>
            </group>
          )}

          {activePos && <ActivePulse position={activePos} visible={controlsEnabled} />}

          <FirstPersonController
            boundary={ROOM4_BOUNDARY}
            controlsEnabled={controlsEnabled}
            moveSpeed={0.006}
          />
          <FocusDetector
            targets={targets}
            enabled={controlsEnabled}
            maxDistance={1.8}
            onFocusChange={setFocused}
            onInteract={handleInteract}
          />
        </Suspense>
      </Canvas>

      <CrosshairHud focused={focused} visible={controlsEnabled} />

      {uvEnabled && (
        <div className="absolute top-8 left-1/2 z-20 -translate-x-1/2 pointer-events-none">
          <div className="rounded-lg border border-purple-500/50 bg-purple-900/80 px-4 py-2">
            <p className="font-mono text-xs font-bold text-purple-200">UV ON</p>
          </div>
        </div>
      )}

      {wiresDone && step === 4 && !showMonitor && !showFinalQuestion && !gameWon && (
        <div className="absolute top-20 left-1/2 z-20 -translate-x-1/2 pointer-events-none">
          <div className="rounded-lg border border-cyan-500/40 bg-cyan-950/80 px-4 py-2">
            <p className="font-mono text-[11px] text-cyan-100">CCTV monitor unlocked</p>
          </div>
        </div>
      )}

      {showSession && (
        <SessionIdentificationPuzzle
          onClose={() => setShowSession(false)}
          onSolved={() => {
            completeTask("session");
            unlockLog("session_full");
            setSessionDone(true);
            setShowSession(false);
            setStep(1);
            setServerRoomProgress({ sessionDone: true, step: 1 });
          }}
        />
      )}

      {showUvClue && !showWires && !showMonitor && !showFinalQuestion && !gameWon && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="relative bg-[#0d0714] border border-purple-500/40 p-5 sm:p-6 rounded-2xl max-w-lg w-full space-y-4 my-auto shadow-2xl shadow-purple-950/60">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-purple-500/20 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-500/40 bg-purple-500/10 text-purple-300">
                  <Eye className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-purple-100">UV ARCHIVE</h2>
                  <p className="text-[10px] font-mono text-purple-400/80">ULTRAVIOLET PRINT RECOVERY</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUvClue(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Verma's Note */}
            <div className="rounded-xl border border-purple-500/25 bg-purple-950/20 p-3.5 space-y-1 shadow-inner">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-purple-300/80">
                <Sparkles className="h-3 w-3 text-purple-400" />
                <span>Recovered Note · Prof. Dev Verma</span>
              </div>
              <p className="font-serif italic text-xs text-purple-100/90 leading-relaxed">
                &ldquo;Someone has been altering the research records. I know where the discrepancy began. I need to speak with them before this goes any further.&rdquo;
              </p>
            </div>

            {/* 5 Suspect Threads - Compact cards */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] uppercase font-mono tracking-widest text-purple-300/80 px-0.5">
                <span>Suspect Threads</span>
                <span className="text-slate-500">5 Profiles</span>
              </div>

              <div className="space-y-1.5 font-mono text-xs">
                {(
                  [
                    {
                      name: "Dr. Arjun Mehta",
                      tag: "RESEARCH",
                      badge: "border-rose-500/40 bg-rose-500/15 text-rose-300",
                      summary: "Altered Exp-17 results (84.2% → 91.7%). Verma planned to confront him.",
                    },
                    {
                      name: "Neha Rao",
                      tag: "INVESTIGATOR",
                      badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
                      summary: "Reviewed archive to trace discrepancies; actions indicate investigation.",
                    },
                    {
                      name: "Karan Patel",
                      tag: "NETWORK",
                      badge: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
                      summary: "Server equipment access. Badge found near Network Room; no murder link.",
                    },
                    {
                      name: "Rohan Desai",
                      tag: "SECURITY",
                      badge: "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
                      summary: "Administered CCTV & surveillance infrastructure across the facility.",
                    },
                    {
                      name: "Dr. Sameer Shah",
                      tag: "DISPUTE",
                      badge: "border-amber-500/40 bg-amber-500/15 text-amber-300",
                      summary: "Heated credit dispute over publications; strong motive, but no forensic tie.",
                    },
                  ] as const
                ).map((card) => (
                  <div
                    key={card.name}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-xl border border-purple-500/20 bg-black/60 px-3 py-2 transition hover:border-purple-400/40"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-100 text-xs">{card.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wider ${card.badge}`}>
                        {card.tag}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 leading-tight sm:text-right max-w-sm">
                      {card.summary}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-slate-500 text-center font-mono">
              Next step: Restore the relay circuit, then access the wall monitor.
            </p>

            {/* Action button */}
            <button
              type="button"
              onClick={() => {
                completeTask("uv");
                unlockLog("uv_archive");
                setInvestigationState({ arjunEvidenceFound: true, finalUnlocked: true });
                setShowUvClue(false);
                setStep(3);
                setServerRoomProgress({ step: 3 });
                setShowWires(true);
              }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold tracking-widest shadow-lg shadow-purple-950/50 transition cursor-pointer"
            >
              <span>OPEN RELAY CIRCUIT</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {showWires && !showMonitor && !showFinalQuestion && !gameWon && (
        <TangledWiresPuzzle
          onClose={() => setShowWires(false)}
          onSolved={() => {
            completeTask("wires");
            unlockLog("wires_signal");
            setWiresDone(true);
            setShowWires(false);
            setStep(4);
            setServerRoomProgress({ wiresDone: true, step: 4 });
          }}
        />
      )}

      {showMonitor && !showFinalQuestion && !gameWon && (
        <CctvMonitor
          unlocked={cctvUnlocked}
          onClose={() => setShowMonitor(false)}
          onUnlocked={() => {
            completeTask("cctv");
            setCctvUnlocked(true);
            setServerRoomProgress({ cctvUnlocked: true });
          }}
          onAccuse={() => {
            setShowMonitor(false);
            setShowFinalQuestion(true);
          }}
        />
      )}

      {showMonitorCodeNote && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-amber-500/40 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl shadow-amber-950/40 text-center animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-amber-400" />
                <span>Recovered Note · Window Table</span>
              </span>
              <button
                type="button"
                onClick={() => setShowMonitorCodeNote(false)}
                className="text-slate-400 hover:text-white p-1 rounded transition cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="bg-amber-100 rounded-xl p-6 text-slate-900 space-y-2 shadow-inner border border-amber-300">
              <p className="text-[11px] font-mono uppercase tracking-widest text-amber-800 font-bold">
                CODE FOR MONITOR
              </p>
              <div className="text-4xl font-mono font-black tracking-widest text-slate-950 py-1">
                {CCTV_CODE}
              </div>
              <p className="text-[10px] font-mono text-amber-700">
                3-digit access code for CCTV terminal
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowMonitorCodeNote(false)}
              className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono text-xs font-bold tracking-widest transition cursor-pointer shadow-md"
            >
              CLOSE
            </button>
          </div>
        </div>
      )}

      {showFinalQuestion && !gameWon && (
        <div className="absolute inset-0 bg-black/95 z-50 flex items-center justify-center p-4">
          <div className="bg-black/90 border border-red-900/60 p-8 rounded-2xl max-w-md w-full space-y-6 shadow-2xl shadow-red-950/40 backdrop-blur-md">
            <div className="text-center space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-red-500/80 bg-red-950/40 border border-red-900/40 px-2.5 py-1 rounded-full">
                Final Accusation
              </span>
              <h2 className="text-xl sm:text-2xl text-white font-black tracking-wide font-mono mt-2">
                WHO KILLED PROFESSOR DEV VERMA?
              </h2>
              <p className="text-xs text-rose-400/80 font-mono">
                Penalty for wrong accusation: −10:00
              </p>
            </div>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setAnswerError("");
                accuse();
              }}
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="suspect-input"
                  className="block text-[10px] font-mono uppercase tracking-widest text-slate-400 text-center"
                >
                  Type the killer's name
                </label>
                <input
                  id="suspect-input"
                  type="text"
                  autoFocus
                  value={accusation}
                  onChange={(e) => {
                    setAccusation(e.target.value);
                    setAnswerError("");
                  }}
                  placeholder="Enter suspect name..."
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-xl border border-white/20 bg-white/[0.04] px-4 py-3.5 font-mono text-sm text-center text-white placeholder:text-slate-600 focus:border-red-500/70 focus:bg-red-950/10 focus:outline-none transition"
                />
              </div>

              {answerError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-950/30 px-3.5 py-2.5 text-center text-xs font-mono text-rose-300 whitespace-pre-line leading-relaxed">
                  {answerError}
                </div>
              )}

              <button
                type="submit"
                disabled={!accusation.trim()}
                className="w-full py-3.5 border border-red-800/80 bg-red-950/60 hover:bg-red-900/70 disabled:opacity-40 disabled:hover:bg-red-950/60 text-white rounded-xl font-mono text-xs font-bold tracking-widest shadow-lg shadow-red-950/50 transition cursor-pointer"
              >
                SUBMIT ACCUSATION
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setShowFinalQuestion(false);
                setShowMonitor(true);
              }}
              className="w-full py-2 text-xs font-mono tracking-wider text-slate-400 hover:text-slate-200 transition text-center cursor-pointer"
            >
              ← BACK TO CCTV
            </button>
          </div>
        </div>
      )}

      {gameWon && (
        <div className="absolute inset-0 bg-black z-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center space-y-6">
            <h1 className="text-4xl text-emerald-400 font-black tracking-widest">CASE CLOSED</h1>
            <div className="text-left text-slate-300 text-sm space-y-3 leading-relaxed">
              <p>
                Dr. Arjun Mehta altered Experiment 17. Professor Dev Verma discovered it and meant
                to confront him that night.
              </p>
              <p>
                Neha Rao, Karan Patel, Rohan Desai, and Dr. Sameer Shah each looked suspicious for
                different reasons — but the evidence did not connect them to the murder.
              </p>
            </div>
            <div className="flex flex-col gap-2 items-center">
              <button
                onClick={() => (window.location.href = "/leaderboard")}
                className="px-8 py-3 bg-white text-black rounded font-bold text-sm tracking-widest"
              >
                LEADERBOARD
              </button>
              <button
                onClick={() => (window.location.href = "/?newPlayer=1")}
                className="px-6 py-2 text-xs font-mono tracking-wider text-slate-400 hover:text-white border border-white/10 rounded"
              >
                Play again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomFour;
