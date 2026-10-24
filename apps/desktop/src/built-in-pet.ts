import { BUILT_IN_PET_ID, type PetSummary } from "./shared-types.js";

export function petSpriteUrl(petId: string): string {
  return `petdesk-asset://spritesheet/${encodeURIComponent(petId)}`;
}

export const builtInPet: PetSummary = {
  id: BUILT_IN_PET_ID,
  displayName: "Hoodie Cat",
  description: "应用内置宠物，离线也可使用。",
  builtIn: true,
  spriteVersion: 2,
  spriteUrl: petSpriteUrl(BUILT_IN_PET_ID),
};
