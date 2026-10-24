export const BUILT_IN_PET_ID = "builtin";

export const PET_SCALE_OPTIONS = [
  { label: "小", value: 0.5 },
  { label: "中", value: 0.75 },
  { label: "大", value: 1 },
  { label: "特大", value: 1.25 },
] as const;

export type PetScale = (typeof PET_SCALE_OPTIONS)[number]["value"];

export const DEFAULT_PET_SCALE: PetScale = 0.75;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface AiVoicePreferences {
  readonly enabled: boolean;
  readonly otaUrl: string;
}

export interface Preferences {
  readonly defaultPetId: string;
  readonly petScale: PetScale;
  readonly showOnLaunch: boolean;
  readonly launchAtLogin: boolean;
  readonly alwaysOnTop: boolean;
  readonly aiVoice: AiVoicePreferences;
  readonly petPosition?: Point;
}

export interface AiVoicePreferencePatch {
  readonly enabled?: unknown;
  readonly otaUrl?: unknown;
}

export interface PreferencePatch {
  readonly petScale?: unknown;
  readonly showOnLaunch?: unknown;
  readonly launchAtLogin?: unknown;
  readonly alwaysOnTop?: unknown;
  readonly aiVoice?: AiVoicePreferencePatch;
}

export interface PetSummary {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly builtIn: boolean;
  readonly spriteVersion: 1 | 2;
  readonly spriteUrl: string;
}

export interface ControlCenterSnapshot {
  readonly appVersion: string;
  readonly preferences: Preferences;
  readonly pets: readonly PetSummary[];
  readonly currentPetId: string;
  readonly petVisible: boolean;
  readonly aiVoiceDeviceId: string;
}

export interface ImportPetResult {
  readonly ok: boolean;
  readonly message: string;
}

export type PetReaction = "idle" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review";

export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  readonly id: number;
  readonly role: ConversationRole;
  readonly text: string;
}

export interface PetConversationView {
  readonly chatOpen: boolean;
  readonly messages: readonly ConversationMessage[];
  readonly bubble: string;
  readonly voiceActive: boolean;
  readonly voiceLabel: string;
  readonly chatStatus: string;
}

export type PetWindowLayout = "base" | "chat" | "voice";

export interface DeskPetApi {
  getSnapshot(): Promise<ControlCenterSnapshot>;
  updatePreferences(patch: PreferencePatch): Promise<ControlCenterSnapshot>;
  setDefaultPet(petId: string): Promise<ControlCenterSnapshot>;
  importPetFolder(): Promise<ImportPetResult>;
  importPetZip(): Promise<ImportPetResult>;
  removePet(petId: string): Promise<ControlCenterSnapshot>;
  resetPetPosition(): Promise<ControlCenterSnapshot>;
  onSnapshotChanged(listener: (snapshot: ControlCenterSnapshot) => void): void;
}
