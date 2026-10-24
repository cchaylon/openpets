import type { Stats } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

import { BUILT_IN_PET_ID } from "./shared-types.js";
import {
  getPetSpritesheetSpec,
  validateSvgSpritesheet,
  type PetSpritesheetPath,
} from "./pet-spritesheet.js";

export const maxPetJsonBytes = 128 * 1024;
export const maxPetSpritesheetBytes = 100 * 1024 * 1024;

export interface PetMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly spritesheetPath: PetSpritesheetPath;
  readonly spriteVersion: 1 | 2;
}

const safePetIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isSafePetId(value: string): boolean {
  return safePetIdPattern.test(value) && value !== BUILT_IN_PET_ID;
}

export function validatePetMetadata(value: unknown): PetMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("pet.json 必须是对象。");
  }
  const record = value as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "string" || !isSafePetId(id)) {
    throw new Error("pet.json 的 id 非法：只允许小写字母、数字、下划线或短横线，且不能是 builtin。");
  }
  const displayName = record.displayName;
  if (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.length > 80) {
    throw new Error("pet.json 的 displayName 必须是 1-80 个字符。");
  }
  const description = record.description;
  if (typeof description !== "string" || description.trim().length === 0 || description.length > 500) {
    throw new Error("pet.json 的 description 必须是 1-500 个字符。");
  }
  const spec = getPetSpritesheetSpec(record);
  return {
    id,
    displayName: displayName.trim(),
    description: description.trim(),
    spritesheetPath: spec.spritesheetPath,
    spriteVersion: spec.version,
  };
}

export async function readPetMetadata(directory: string): Promise<PetMetadata> {
  const bytes = await readBoundedRegularFile(join(directory, "pet.json"), maxPetJsonBytes, "pet.json");
  let parsed: unknown;
  try {
    // Windows editors and PowerShell may save UTF-8 with a BOM.
    parsed = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("pet.json 不是合法的 JSON。");
  }
  return validatePetMetadata(parsed);
}

export async function validatePetAtlas(directory: string, metadata: PetMetadata): Promise<void> {
  const width = 1536;
  const height = metadata.spriteVersion === 2 ? 2288 : 1872;
  const atlasPath = join(directory, metadata.spritesheetPath);
  const limit = metadata.spritesheetPath === "spritesheet.svg" ? 8 * 1024 * 1024 : maxPetSpritesheetBytes;
  const bytes = await readBoundedRegularFile(atlasPath, limit, metadata.spritesheetPath);

  if (metadata.spritesheetPath === "spritesheet.svg") {
    validateSvgSpritesheet(bytes, width, height);
    return;
  }

  let imageMetadata: sharp.Metadata;
  const image = sharp(bytes, { animated: true, failOn: "error", limitInputPixels: 50_000_000 });
  try {
    imageMetadata = await image.metadata();
  } catch {
    throw new Error("spritesheet.webp 无法解析。");
  }
  if (imageMetadata.format !== "webp") {
    throw new Error("spritesheet.webp 必须是 WebP 格式。");
  }
  if (!imageMetadata.hasAlpha) {
    throw new Error("spritesheet.webp 必须包含透明通道。");
  }
  if ((imageMetadata.pages ?? 1) !== 1) {
    throw new Error("spritesheet.webp 只能包含一张图。");
  }
  if (imageMetadata.width !== width || imageMetadata.height !== height) {
    throw new Error(`spritesheet.webp 尺寸必须是 ${width}x${height}。`);
  }
  try {
    await image.raw().toBuffer();
  } catch {
    throw new Error("spritesheet.webp 无法完整解码。");
  }
}

export async function readBoundedRegularFile(path: string, maxBytes: number, label: string): Promise<Buffer> {
  let stats: Stats;
  try {
    stats = await lstat(path);
  } catch {
    throw new Error(`缺少 ${label}。`);
  }
  if (!stats.isFile()) {
    throw new Error(`${label} 必须是普通文件。`);
  }
  if (stats.size <= 0) {
    throw new Error(`${label} 是空文件。`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`${label} 超出大小限制。`);
  }
  return readFile(path);
}
