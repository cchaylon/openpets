import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { app, protocol } from "electron";

import { petDirectory } from "./pet-install.js";
import { readPetMetadata } from "./pet-package.js";
import { petSpritesheetMimeType } from "./pet-spritesheet.js";
import { BUILT_IN_PET_ID } from "./shared-types.js";
import { logWarn } from "./logger.js";

export const petAssetScheme = "petdesk-asset";

/** Must run before `app.whenReady()`. */
export function registerPetAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: petAssetScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/** Must run after `app.whenReady()`. */
export function registerPetAssetProtocol(): void {
  protocol.handle(petAssetScheme, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "spritesheet") {
        return notFound();
      }

      const petId = decodeURIComponent(url.pathname.replace(/^\//, ""));
      if (petId === BUILT_IN_PET_ID) {
        const bytes = await readFile(join(app.getAppPath(), "assets", "default-pet-spritesheet.webp"));
        return imageResponse(bytes, "image/webp");
      }

      const directory = petDirectory(petId);
      const metadata = await readPetMetadata(directory);
      const bytes = await readFile(join(directory, metadata.spritesheetPath));
      return imageResponse(bytes, petSpritesheetMimeType(metadata.spritesheetPath));
    } catch (error) {
      logWarn("pet-asset", "sprite request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return notFound();
    }
  });
}

function imageResponse(bytes: Buffer, contentType: string): Response {
  return new Response(bytes, {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
