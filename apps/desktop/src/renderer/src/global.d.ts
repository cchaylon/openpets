import type { DeskPetApi } from "../../shared-types";

declare global {
  interface Window {
    readonly deskpet: DeskPetApi;
  }
}

export {};
