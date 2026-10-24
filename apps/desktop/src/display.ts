import { screen } from "electron";

import type { PetScale, Point } from "./shared-types.js";

const frameWidth = 192;
const frameHeight = 208;
const horizontalPadding = 48;
const verticalPadding = 44;
const initialMargin = 24;

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export function getPetWindowSize(scale: PetScale): WindowSize {
  return {
    width: Math.ceil(frameWidth * scale) + horizontalPadding,
    height: Math.ceil(frameHeight * scale) + verticalPadding,
  };
}

export function getDefaultPetPosition(size: WindowSize): Point {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + workArea.width - size.width - initialMargin),
    y: Math.round(workArea.y + workArea.height - size.height - initialMargin),
  };
}

export function clampPetPosition(position: Point, size: WindowSize): Point {
  const centre = {
    x: position.x + size.width / 2,
    y: position.y + size.height / 2,
  };
  const { workArea } = screen.getDisplayNearestPoint(centre);
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);
  return {
    x: Math.min(Math.max(Math.round(position.x), workArea.x), maxX),
    y: Math.min(Math.max(Math.round(position.y), workArea.y), maxY),
  };
}
