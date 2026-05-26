export interface Dragon {
  id: number;
  x: number;          // percentage 0-100 of play area width
  y: number;          // percentage 0-100 of play area height
  size: number;       // diameter in px
  lifetime: number;   // total seconds before it escapes
  elapsed: number;    // seconds since spawn
  tapped: boolean;    // true = scored, animating out
  escaped: boolean;   // true = missed, animating out
  color: string;      // dragon body color
  scale: number;      // current animation scale (0->1 on spawn, 1->0 on exit)
  rotation: number;   // current wing flap rotation in degrees
}

export type GamePhase = "idle" | "playing" | "over";
