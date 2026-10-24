import type { PetReaction } from "./shared-types.js";

export const CHAT_PANEL_MIN_WIDTH = 360;
export const CHAT_PANEL_EXTRA_HEIGHT = 320;
export const VOICE_PANEL_MIN_WIDTH = 340;
export const VOICE_PANEL_EXTRA_HEIGHT = 210;

interface SpriteState {
  readonly row: number;
  readonly frames: number;
  readonly durationMs: number;
  readonly iterations: number | "infinite";
}

/**
 * Atlas rows follow the OpenPets pet format:
 * idle, run right, run left, wave, jump, fail, wait, run, review.
 */
const spriteStates: Record<PetReaction, SpriteState> = {
  idle: { row: 0, frames: 6, durationMs: 5500, iterations: "infinite" },
  waving: { row: 3, frames: 4, durationMs: 700, iterations: 2 },
  jumping: { row: 4, frames: 5, durationMs: 840, iterations: 2 },
  failed: { row: 5, frames: 8, durationMs: 1220, iterations: 2 },
  waiting: { row: 6, frames: 6, durationMs: 1010, iterations: "infinite" },
  running: { row: 7, frames: 6, durationMs: 820, iterations: "infinite" },
  review: { row: 8, frames: 6, durationMs: 1030, iterations: "infinite" },
};

export function reactionDurationMs(reaction: PetReaction): number {
  const state = spriteStates[reaction];
  const iterations = state.iterations === "infinite" ? 1 : state.iterations;
  return Math.max(1400, state.durationMs * iterations);
}
