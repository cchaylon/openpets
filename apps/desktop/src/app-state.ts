import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app } from "electron";

import {
  BUILT_IN_PET_ID,
  DEFAULT_PET_SCALE,
  PET_SCALE_OPTIONS,
  type AiVoicePreferencePatch,
  type AiVoicePreferences,
  type PetScale,
  type Point,
  type PreferencePatch,
  type Preferences,
} from "./shared-types.js";
import { logInfo, logWarn } from "./logger.js";
import { isSafePetId } from "./pet-package.js";

export interface InstalledPetRecord {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly spriteVersion: 1 | 2;
  readonly installedAt: number;
}

export interface PersistedState {
  readonly version: 1;
  readonly preferences: Preferences;
  readonly installedPets: readonly InstalledPetRecord[];
}

const defaultAiVoicePreferences: AiVoicePreferences = {
  enabled: true,
  otaUrl: "",
};

const defaultPreferences: Preferences = {
  defaultPetId: BUILT_IN_PET_ID,
  petScale: DEFAULT_PET_SCALE,
  showOnLaunch: true,
  launchAtLogin: false,
  alwaysOnTop: true,
  aiVoice: { ...defaultAiVoicePreferences },
};

let state: PersistedState = createDefaultState();
let statePath = "";
const listeners = new Set<(snapshot: PersistedState) => void>();

export function initAppState(): void {
  const userDataPath = app.getPath("userData");
  mkdirSync(userDataPath, { recursive: true });
  statePath = join(userDataPath, "deskpet-state.json");
  state = loadState(statePath);
  logInfo("state", "state loaded", {
    path: statePath,
    installedPets: state.installedPets.length,
    defaultPetId: state.preferences.defaultPetId,
  });
}

export function getAppState(): Readonly<PersistedState> {
  return state;
}

export function subscribeAppState(listener: (snapshot: PersistedState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updatePreferences(patch: PreferencePatch): Readonly<Preferences> {
  const preferences: Preferences = {
    ...state.preferences,
    ...(patch.petScale === undefined ? {} : { petScale: normalizePetScale(patch.petScale) }),
    ...(patch.showOnLaunch === undefined ? {} : { showOnLaunch: normalizeBoolean(patch.showOnLaunch, state.preferences.showOnLaunch) }),
    ...(patch.launchAtLogin === undefined ? {} : { launchAtLogin: normalizeBoolean(patch.launchAtLogin, state.preferences.launchAtLogin) }),
    ...(patch.alwaysOnTop === undefined ? {} : { alwaysOnTop: normalizeBoolean(patch.alwaysOnTop, state.preferences.alwaysOnTop) }),
    ...(patch.aiVoice === undefined ? {} : { aiVoice: mergeAiVoicePreferences(state.preferences.aiVoice, patch.aiVoice) }),
  };
  commit({ ...state, preferences: normalizePreferences(preferences, state.installedPets) });
  return state.preferences;
}

export function setDefaultPetId(petId: string): Readonly<Preferences> {
  if (typeof petId !== "string" || petId.length === 0) {
    throw new Error("宠物 ID 非法。");
  }
  const preferences = normalizePreferences({ ...state.preferences, defaultPetId: petId }, state.installedPets);
  commit({ ...state, preferences });
  return state.preferences;
}

export function setInstalledPets(records: readonly InstalledPetRecord[]): void {
  const installedPets = normalizeInstalledPets(records);
  const preferences = normalizePreferences(state.preferences, installedPets);
  commit({ ...state, installedPets, preferences });
}

export function setPetPosition(position: Point | undefined): void {
  const preferences = normalizePreferences({ ...state.preferences, petPosition: position }, state.installedPets);
  commit({ ...state, preferences });
}

export function resetPetPosition(): void {
  const { petPosition: _ignored, ...preferences } = state.preferences;
  commit({ ...state, preferences: normalizePreferences(preferences, state.installedPets) });
}

function commit(nextState: PersistedState): void {
  state = nextState;
  persist();
  for (const listener of listeners) {
    listener(state);
  }
}

function createDefaultState(): PersistedState {
  return {
    version: 1,
    preferences: { ...defaultPreferences },
    installedPets: [],
  };
}

function loadState(path: string): PersistedState {
  if (!existsSync(path)) {
    return createDefaultState();
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return normalizeState(parsed);
  } catch (error) {
    quarantineCorruptState(path, error);
    return createDefaultState();
  }
}

function quarantineCorruptState(path: string, error: unknown): void {
  logWarn("state", "state file unreadable; using defaults", {
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    renameSync(path, `${path}.corrupt-${Date.now()}`);
  } catch {
    // Best-effort quarantine.
  }
}

function normalizeState(value: unknown): PersistedState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("State root must be an object.");
  }
  const record = value as Record<string, unknown>;
  const installedPets = normalizeInstalledPets(record.installedPets);
  return {
    version: 1,
    installedPets,
    preferences: normalizePreferences(record.preferences, installedPets),
  };
}

function normalizePreferences(value: unknown, installedPets: readonly InstalledPetRecord[]): Preferences {
  const record = isRecord(value) ? value : {};
  const defaultPetId = typeof record.defaultPetId === "string" && isKnownPetId(record.defaultPetId, installedPets)
    ? record.defaultPetId
    : BUILT_IN_PET_ID;
  return {
    defaultPetId,
    petScale: normalizePetScale(record.petScale),
    showOnLaunch: normalizeBoolean(record.showOnLaunch, defaultPreferences.showOnLaunch),
    launchAtLogin: normalizeBoolean(record.launchAtLogin, defaultPreferences.launchAtLogin),
    alwaysOnTop: normalizeBoolean(record.alwaysOnTop, defaultPreferences.alwaysOnTop),
    aiVoice: normalizeAiVoicePreferences(record.aiVoice),
    ...(isPoint(record.petPosition) ? { petPosition: { x: Math.round(record.petPosition.x), y: Math.round(record.petPosition.y) } } : {}),
  };
}

function mergeAiVoicePreferences(current: AiVoicePreferences, patch: AiVoicePreferencePatch): AiVoicePreferences {
  return normalizeAiVoicePreferences({
    enabled: patch.enabled === undefined ? current.enabled : patch.enabled,
    otaUrl: patch.otaUrl === undefined ? current.otaUrl : patch.otaUrl,
  }, current);
}

function normalizeAiVoicePreferences(value: unknown, fallback: AiVoicePreferences = defaultAiVoicePreferences): AiVoicePreferences {
  const record = isRecord(value) ? value : {};
  return {
    enabled: normalizeBoolean(record.enabled, fallback.enabled),
    otaUrl: normalizeOtaUrl(record.otaUrl, fallback.otaUrl),
  };
}

function normalizeOtaUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length > 512) {
    return fallback;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeInstalledPets(value: unknown): InstalledPetRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const records: InstalledPetRecord[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const { id, displayName, description, spriteVersion } = candidate;
    if (typeof id !== "string" || !isSafePetId(id) || seen.has(id)) continue;
    if (typeof displayName !== "string" || displayName.trim().length === 0) continue;
    if (typeof description !== "string") continue;
    seen.add(id);
    records.push({
      id,
      displayName: displayName.slice(0, 80),
      description: description.slice(0, 500),
      spriteVersion: spriteVersion === 2 ? 2 : 1,
      installedAt: typeof candidate.installedAt === "number" ? candidate.installedAt : Date.now(),
    });
  }
  return records;
}

function normalizePetScale(value: unknown): PetScale {
  return PET_SCALE_OPTIONS.find((option) => option.value === value)?.value ?? DEFAULT_PET_SCALE;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isKnownPetId(petId: string, installedPets: readonly InstalledPetRecord[]): boolean {
  return petId === BUILT_IN_PET_ID || installedPets.some((pet) => pet.id === petId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is Point {
  return isRecord(value)
    && typeof value.x === "number"
    && Number.isFinite(value.x)
    && typeof value.y === "number"
    && Number.isFinite(value.y);
}

function persist(): void {
  const path = statePath;
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}
