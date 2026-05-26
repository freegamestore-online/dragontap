import {
  GameShell,
  GameTopbar,
  GameAuth,
  GameButton,
  useGameSounds,
  useLeaderboard,
  Leaderboard,
} from "@freegamestore/games";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHighScore } from "./hooks/useHighScore";
import { useGameLoop } from "./hooks/useGameLoop";
import type { Dragon, GamePhase } from "./types";

// ---- tuning knobs ----
const MAX_MISSES = 3;
const INITIAL_SPAWN_INTERVAL = 2.0;   // seconds between spawns at score 0
const MIN_SPAWN_INTERVAL = 0.6;       // fastest spawn rate
const INITIAL_DRAGON_LIFETIME = 3.0;  // seconds a dragon stays before escaping
const MIN_DRAGON_LIFETIME = 1.2;      // fastest lifetime
const DRAGON_MIN_SIZE = 48;
const DRAGON_MAX_SIZE = 72;
const SCORE_PER_TAP = 10;
const SPEED_RAMP_SCORE = 200;         // score at which max difficulty is reached
const SPAWN_IN_DURATION = 0.25;       // seconds for pop-in animation
const EXIT_DURATION = 0.35;           // seconds for exit animation
const COMBO_WINDOW = 1.5;             // seconds to keep a combo alive
const FLASH_DURATION = 0.15;          // seconds for the hit flash

// ---- dragon colors ----
const DRAGON_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#8b5cf6", // purple
  "#10b981", // emerald
  "#3b82f6", // blue
  "#ec4899", // pink
  "#f59e0b", // amber
  "#06b6d4", // cyan
];

let nextId = 0;

function randomDragonColor(): string {
  return DRAGON_COLORS[Math.floor(Math.random() * DRAGON_COLORS.length)]!;
}

/** Get spawn interval for a given score */
function getSpawnInterval(score: number): number {
  const t = Math.min(score / SPEED_RAMP_SCORE, 1);
  return INITIAL_SPAWN_INTERVAL + (MIN_SPAWN_INTERVAL - INITIAL_SPAWN_INTERVAL) * t;
}

/** Get dragon lifetime for a given score */
function getDragonLifetime(score: number): number {
  const t = Math.min(score / SPEED_RAMP_SCORE, 1);
  return INITIAL_DRAGON_LIFETIME + (MIN_DRAGON_LIFETIME - INITIAL_DRAGON_LIFETIME) * t;
}

// ---- SVG dragon ----
function DragonSVG({ color, wingAngle }: { color: string; wingAngle: number }) {
  const wingRotate = Math.sin(wingAngle) * 20;
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))" }}>
      {/* Left wing */}
      <g transform={`rotate(${wingRotate}, 30, 50)`}>
        <path d="M30,50 Q10,30 5,20 Q15,35 30,40 Z" fill={color} opacity={0.7} />
      </g>
      {/* Right wing */}
      <g transform={`rotate(${-wingRotate}, 70, 50)`}>
        <path d="M70,50 Q90,30 95,20 Q85,35 70,40 Z" fill={color} opacity={0.7} />
      </g>
      {/* Body */}
      <ellipse cx={50} cy={55} rx={18} ry={22} fill={color} />
      {/* Belly */}
      <ellipse cx={50} cy={60} rx={12} ry={14} fill="#fde68a" opacity={0.6} />
      {/* Head */}
      <circle cx={50} cy={32} r={12} fill={color} />
      {/* Eyes */}
      <circle cx={44} cy={30} r={3} fill="white" />
      <circle cx={56} cy={30} r={3} fill="white" />
      <circle cx={45} cy={29} r={1.5} fill="#1a1a1a" />
      <circle cx={57} cy={29} r={1.5} fill="#1a1a1a" />
      {/* Nostrils */}
      <circle cx={47} cy={36} r={1} fill="#fbbf24" />
      <circle cx={53} cy={36} r={1} fill="#fbbf24" />
      {/* Tail */}
      <path d="M50,77 Q55,85 60,88 Q55,90 50,85 Q48,88 45,85" fill={color} stroke={color} strokeWidth={1} />
      {/* Horns */}
      <path d="M42,22 L38,12 L44,24" fill="#f59e0b" />
      <path d="M58,22 L62,12 L56,24" fill="#f59e0b" />
    </svg>
  );
}

// ---- floating score text ----
interface FloatingScore {
  id: number;
  x: number;
  y: number;
  value: number;
  age: number;
}

export default function App() {
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [dragons, setDragons] = useState<Dragon[]>([]);
  const [floatingScores, setFloatingScores] = useState<FloatingScore[]>([]);
  const [combo, setCombo] = useState(0);
  const [flash, setFlash] = useState(false);
  const [highScore, updateHighScore] = useHighScore("dragontap-highscore");
  const { topScores, recentScores, submitScore, loading: lbLoading } = useLeaderboard("dragontap");
  const submittedRef = useRef(false);
  const sounds = useGameSounds();
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;

  // Mutable refs for the game loop
  const scoreRef = useRef(score);
  const missesRef = useRef(misses);
  const dragonsRef = useRef(dragons);
  const phaseRef = useRef(phase);
  const comboRef = useRef(combo);
  const lastTapTimeRef = useRef(0);
  const spawnTimerRef = useRef(0);

  scoreRef.current = score;
  missesRef.current = misses;
  dragonsRef.current = dragons;
  phaseRef.current = phase;
  comboRef.current = combo;

  // Submit score on game over
  useEffect(() => {
    if (phase === "over" && !submittedRef.current) {
      submittedRef.current = true;
      updateHighScore(score);
      submitScore(score);
    }
    if (phase !== "over") {
      submittedRef.current = false;
    }
  }, [phase, score, submitScore, updateHighScore]);

  const startGame = useCallback(() => {
    setPhase("playing");
    setScore(0);
    setMisses(0);
    setDragons([]);
    setFloatingScores([]);
    setCombo(0);
    spawnTimerRef.current = 0;
    nextId = 0;
  }, []);

  // Spawn a dragon at a random position
  const spawnDragon = useCallback(() => {
    const currentScore = scoreRef.current;
    const size = DRAGON_MIN_SIZE + Math.random() * (DRAGON_MAX_SIZE - DRAGON_MIN_SIZE);
    const margin = 10;
    const newDragon: Dragon = {
      id: nextId++,
      x: margin + Math.random() * (100 - 2 * margin),
      y: margin + Math.random() * (100 - 2 * margin),
      size,
      lifetime: getDragonLifetime(currentScore),
      elapsed: 0,
      tapped: false,
      escaped: false,
      color: randomDragonColor(),
      scale: 0,
      rotation: Math.random() * Math.PI * 2,
    };
    setDragons((prev) => [...prev, newDragon]);
  }, []);

  // Handle tapping a dragon
  const tapDragon = useCallback((id: number) => {
    if (phaseRef.current !== "playing") return;

    const now = performance.now() / 1000;
    const timeSinceLastTap = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    // Combo logic
    let newCombo: number;
    if (timeSinceLastTap < COMBO_WINDOW) {
      newCombo = comboRef.current + 1;
    } else {
      newCombo = 1;
    }
    setCombo(newCombo);

    const comboMultiplier = Math.min(newCombo, 5);
    const points = SCORE_PER_TAP * comboMultiplier;

    setDragons((prev) => {
      const dragon = prev.find((d) => d.id === id);
      if (!dragon || dragon.tapped || dragon.escaped) return prev;
      return prev.map((d) => (d.id === id ? { ...d, tapped: true, elapsed: d.elapsed } : d));
    });

    setScore((prev) => prev + points);
    soundsRef.current.playScore();

    if (newCombo >= 3) {
      soundsRef.current.playClear();
    }

    // Flash effect
    setFlash(true);
    setTimeout(() => setFlash(false), FLASH_DURATION * 1000);

    // Floating score
    const dragon = dragonsRef.current.find((d) => d.id === id);
    if (dragon) {
      const floatId = nextId++;
      setFloatingScores((prev) => [
        ...prev,
        { id: floatId, x: dragon.x, y: dragon.y, value: points, age: 0 },
      ]);
    }
  }, []);

  // Game loop
  useGameLoop(
    (dt) => {
      if (phaseRef.current !== "playing") return;

      // Spawn timer
      spawnTimerRef.current += dt;
      const interval = getSpawnInterval(scoreRef.current);
      if (spawnTimerRef.current >= interval) {
        spawnTimerRef.current = 0;
        spawnDragon();
      }

      // Update dragons
      let newMisses = 0;
      setDragons((prev) => {
        const updated: Dragon[] = [];
        for (const d of prev) {
          const elapsed = d.elapsed + dt;

          let scale: number;
          if (d.tapped) {
            const exitProgress = Math.min((elapsed - d.elapsed) / EXIT_DURATION, 1);
            scale = 1 - exitProgress;
            if (exitProgress >= 1) continue;
          } else if (d.escaped) {
            const exitProgress = Math.min((elapsed - d.lifetime) / EXIT_DURATION, 1);
            scale = 1 - exitProgress;
            if (exitProgress >= 1) continue;
          } else if (elapsed < SPAWN_IN_DURATION) {
            scale = elapsed / SPAWN_IN_DURATION;
          } else if (elapsed >= d.lifetime) {
            newMisses++;
            soundsRef.current.playError();
            updated.push({ ...d, elapsed, escaped: true, scale: 1 });
            continue;
          } else {
            scale = 1;
            const timeLeft = d.lifetime - elapsed;
            if (timeLeft < 1) {
              scale = 1 + Math.sin(elapsed * 15) * 0.08;
            }
          }

          const rotation = d.rotation + dt * 8;
          updated.push({ ...d, elapsed, scale, rotation });
        }
        return updated;
      });

      if (newMisses > 0) {
        setMisses((prev) => {
          const total = prev + newMisses;
          if (total >= MAX_MISSES) {
            soundsRef.current.playGameOver();
            setPhase("over");
          }
          return total;
        });
      }

      // Update floating scores
      setFloatingScores((prev) =>
        prev.map((f) => ({ ...f, age: f.age + dt })).filter((f) => f.age < 1)
      );
    },
    phase !== "playing"
  );

  // Miss indicators
  const hearts = Array.from({ length: MAX_MISSES }, (_, i) => {
    const alive = i < MAX_MISSES - misses;
    return (
      <span
        key={i}
        className="text-lg"
        style={{ opacity: alive ? 1 : 0.2, transition: "opacity 0.2s" }}
      >
        {alive ? "❤️" : "\u{1F5A4}"}
      </span>
    );
  });

  const isNewHighScore = phase === "over" && score > 0 && score >= highScore;

  return (
    <GameShell
      topbar={
        <GameTopbar
          title="Dragon Tap"
          stats={[
            { label: "Score", value: score, accent: true },
            { label: "Combo", value: `${combo}x` },
          ]}
          rules={
            <div>
              <h3 style={{ marginBottom: "0.5rem", fontWeight: 700 }}>Dragon Tap</h3>
              <p>Tap the dragons before they fly away!</p>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>How to Play</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>Tap or click dragons as they appear</li>
                <li>Chain fast taps for combo multipliers (up to 5x)</li>
                <li>Dragons speed up as your score climbs</li>
              </ul>
              <h4 style={{ marginTop: "0.75rem", fontWeight: 600 }}>Rules</h4>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.25rem" }}>
                <li>Miss 3 dragons and it is game over</li>
                <li>Dragons that pulse are about to escape</li>
              </ul>
            </div>
          }
          onRestart={phase === "playing" ? startGame : undefined}
          actions={<GameAuth />}
        />
      }
    >
      <div
        className="relative w-full h-full overflow-hidden"
        style={{
          background: flash ? "rgba(239, 68, 68, 0.08)" : "transparent",
          transition: "background 0.1s",
        }}
      >
        {/* Lives display */}
        {phase === "playing" && (
          <div
            className="absolute top-2 left-1/2 flex gap-1 z-10"
            style={{ transform: "translateX(-50%)" }}
          >
            {hearts}
          </div>
        )}

        {/* Combo display */}
        {phase === "playing" && combo >= 3 && (
          <div
            className="absolute top-10 left-1/2 z-10 font-bold text-sm pointer-events-none"
            style={{
              transform: "translateX(-50%)",
              color: "var(--accent)",
              fontFamily: "Fraunces, serif",
              animation: "combo-pulse 0.5s ease-in-out infinite",
            }}
          >
            {combo}x COMBO!
          </div>
        )}

        {/* Dragons */}
        {dragons.map((dragon) => (
          <button
            key={dragon.id}
            onClick={() => tapDragon(dragon.id)}
            disabled={dragon.tapped || dragon.escaped}
            className="absolute cursor-pointer"
            style={{
              left: `${dragon.x}%`,
              top: `${dragon.y}%`,
              width: dragon.size,
              height: dragon.size,
              transform: `translate(-50%, -50%) scale(${dragon.scale})`,
              transition: dragon.tapped ? `transform ${EXIT_DURATION}s ease-in` : undefined,
              opacity: dragon.escaped ? 0.4 : 1,
              zIndex: dragon.tapped || dragon.escaped ? 0 : 1,
              background: "none",
              border: "none",
              padding: 0,
              outline: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <DragonSVG color={dragon.color} wingAngle={dragon.rotation} />
            {/* Time remaining indicator bar */}
            {!dragon.tapped && !dragon.escaped && dragon.elapsed > SPAWN_IN_DURATION && (
              <div
                className="absolute bottom-0 left-1/2 h-1 rounded-full"
                style={{
                  width: "80%",
                  transform: "translateX(-50%)",
                  background: "var(--line)",
                  overflow: "hidden",
                }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(0, (1 - dragon.elapsed / dragon.lifetime) * 100)}%`,
                    background: dragon.elapsed / dragon.lifetime > 0.7 ? "var(--error)" : "var(--accent)",
                    transition: "width 0.1s linear",
                  }}
                />
              </div>
            )}
          </button>
        ))}

        {/* Floating scores */}
        {floatingScores.map((f) => (
          <div
            key={f.id}
            className="absolute pointer-events-none font-bold"
            style={{
              left: `${f.x}%`,
              top: `${f.y}%`,
              transform: `translate(-50%, ${-40 - f.age * 60}px)`,
              opacity: 1 - f.age,
              color: "var(--accent)",
              fontFamily: "Fraunces, serif",
              fontSize: f.value > SCORE_PER_TAP ? "1.5rem" : "1.2rem",
              textShadow: "0 1px 3px rgba(0,0,0,0.3)",
              zIndex: 10,
            }}
          >
            +{f.value}
          </div>
        ))}

        {/* Start screen */}
        {phase === "idle" && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-6 z-20"
            style={{ background: "rgba(0,0,0,0.4)" }}
          >
            <div className="text-center">
              <div className="mx-auto mb-4" style={{ width: 120, height: 120 }}>
                <DragonSVG color="#ef4444" wingAngle={0} />
              </div>
              <h1
                className="text-4xl font-bold mb-2"
                style={{ fontFamily: "Fraunces, serif", color: "#fff" }}
              >
                Dragon Tap
              </h1>
              <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.7)" }}>
                Tap the dragons before they escape!
              </p>
              <GameButton variant="primary" size="lg" onClick={startGame}>
                Play
              </GameButton>
            </div>
          </div>
        )}

        {/* Game over screen */}
        {phase === "over" && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center z-20"
            style={{ background: "rgba(0,0,0,0.6)" }}
          >
            <div
              className="flex flex-col items-center gap-4 p-8 rounded-2xl max-w-sm w-full mx-4"
              style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
            >
              {/* Sad dragon */}
              <div style={{ width: 80, height: 80, opacity: 0.6 }}>
                <DragonSVG color="#ef4444" wingAngle={0} />
              </div>

              <h2
                className="text-2xl font-bold"
                style={{ fontFamily: "Fraunces, serif", color: "var(--ink)" }}
              >
                Game Over
              </h2>

              {isNewHighScore && (
                <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                  New High Score!
                </p>
              )}

              <div className="flex gap-8 text-center">
                <div>
                  <div className="text-3xl font-bold" style={{ color: "var(--accent)", fontFamily: "Fraunces, serif" }}>
                    {score}
                  </div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>Score</div>
                </div>
                <div>
                  <div className="text-3xl font-bold" style={{ color: "var(--ink)", fontFamily: "Fraunces, serif" }}>
                    {highScore}
                  </div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>Best</div>
                </div>
              </div>

              <GameButton variant="primary" size="lg" block onClick={startGame}>
                Play Again
              </GameButton>

              {/* Leaderboard */}
              <div className="w-full mt-2">
                <Leaderboard
                  topScores={topScores}
                  recentScores={recentScores}
                  loading={lbLoading}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CSS animation for combo pulse */}
      <style>{`
        @keyframes combo-pulse {
          0%, 100% { transform: translateX(-50%) scale(1); }
          50% { transform: translateX(-50%) scale(1.15); }
        }
      `}</style>
    </GameShell>
  );
}
