import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { app } from "electron";
import yauzl from "yauzl";

import { logWarn } from "./logger.js";
import { isSafePetId, maxPetJsonBytes, maxPetSpritesheetBytes, readPetMetadata, validatePetAtlas } from "./pet-package.js";
import type { InstalledPetRecord } from "./app-state.js";

const allowedZipFiles = new Set(["pet.json", "spritesheet.webp", "spritesheet.svg"]);

export function getPetRoot(): string {
  return join(app.getPath("userData"), "pets");
}

export function petDirectory(petId: string): string {
  if (!isSafePetId(petId)) {
    throw new Error(`宠物 ID 非法：${petId}`);
  }
  const root = resolve(getPetRoot());
  const target = resolve(root, petId);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("宠物路径越界。");
  }
  return target;
}

export async function listInstalledPets(): Promise<InstalledPetRecord[]> {
  const root = getPetRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const records: InstalledPetRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || !isSafePetId(entry.name)) {
      continue;
    }
    try {
      const metadata = await readPetMetadata(petDirectory(entry.name));
      records.push({
        id: metadata.id,
        displayName: metadata.displayName,
        description: metadata.description,
        spriteVersion: metadata.spriteVersion,
        installedAt: Date.now(),
      });
    } catch (error) {
      logWarn("pets", "skip unreadable installed pet", {
        petId: entry.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return records;
}

export async function installPetFromDirectory(sourceDirectory: string): Promise<InstalledPetRecord> {
  const metadata = await readPetMetadata(sourceDirectory);
  await validatePetAtlas(sourceDirectory, metadata);

  const root = getPetRoot();
  mkdirSync(root, { recursive: true });
  const destination = petDirectory(metadata.id);
  if (existsSync(destination)) {
    throw new Error(`已存在同 ID 的宠物：${metadata.id}`);
  }

  const tempDirectory = join(root, `.install-${randomUUID()}`);
  mkdirSync(tempDirectory);
  try {
    await copyFile(join(sourceDirectory, "pet.json"), join(tempDirectory, "pet.json"));
    await copyFile(
      join(sourceDirectory, metadata.spritesheetPath),
      join(tempDirectory, metadata.spritesheetPath),
    );
    await rename(tempDirectory, destination);
  } catch (error) {
    rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    id: metadata.id,
    displayName: metadata.displayName,
    description: metadata.description,
    spriteVersion: metadata.spriteVersion,
    installedAt: Date.now(),
  };
}

export async function installPetFromZip(zipPath: string): Promise<InstalledPetRecord> {
  const root = getPetRoot();
  mkdirSync(root, { recursive: true });
  const extractionDirectory = join(root, `.extract-${randomUUID()}`);
  mkdirSync(extractionDirectory);
  try {
    await extractPetZip(zipPath, extractionDirectory);
    return await installPetFromDirectory(extractionDirectory);
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true });
  }
}

export async function removeInstalledPet(petId: string): Promise<void> {
  const directory = petDirectory(petId);
  await rm(directory, { recursive: true, force: true });
}

async function extractPetZip(zipPath: string, targetDirectory: string): Promise<void> {
  const zip = await openZip(zipPath);
  try {
    const entries = await readZipEntries(zip);
    if (entries.length === 0) {
      throw new Error("ZIP 为空。");
    }
    if (entries.length > 3) {
      throw new Error("ZIP 文件过多：只能包含 pet.json 和一张精灵图。");
    }

    const names = new Set<string>();
    let layout: string | null = null;
    for (const entry of entries) {
      const target = normalizeZipEntryName(entry.fileName);
      if (target === null) {
        continue;
      }
      if (layout === null) {
        layout = target.topLevel;
      } else if (layout !== target.topLevel) {
        throw new Error("ZIP 文件必须全部位于根目录或同一个顶层文件夹。");
      }
      if (names.has(target.name)) {
        throw new Error(`ZIP 包含重复文件：${target.name}`);
      }
      names.add(target.name);
      if (target.name === "pet.json" && entry.uncompressedSize > maxPetJsonBytes) {
        throw new Error("pet.json 超出大小限制。");
      }
      if (target.name !== "pet.json" && entry.uncompressedSize > maxPetSpritesheetBytes) {
        throw new Error("精灵图超出大小限制。");
      }
      await extractZipEntry(zip, entry, join(targetDirectory, target.name));
    }

    if (names.has("spritesheet.webp") && names.has("spritesheet.svg")) {
      throw new Error("ZIP 不能同时包含 spritesheet.webp 和 spritesheet.svg。");
    }
  } finally {
    zip.close();
  }
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error("无法打开 ZIP。"));
          return;
        }
        resolveZip(zip);
      },
    );
  });
}

function readZipEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolveEntries, reject) => {
    const entries: yauzl.Entry[] = [];
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    zip.on("error", fail);
    zip.on("entry", (entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.on("end", () => {
      if (settled) return;
      settled = true;
      resolveEntries(entries);
    });
    zip.readEntry();
  });
}

function extractZipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, targetPath: string): Promise<void> {
  return new Promise((resolveEntry, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("无法读取 ZIP 文件。"));
        return;
      }
      const output = createWriteStream(targetPath, { flags: "wx" });
      const fail = (streamError: Error): void => {
        output.destroy();
        reject(streamError);
      };
      stream.on("error", fail);
      output.on("error", fail);
      output.on("close", resolveEntry);
      stream.pipe(output);
    });
  });
}

interface ZipEntryTarget {
  readonly name: string;
  readonly topLevel: string;
}

/** Returns the relative file name and layout folder, or null for directory entries. */
function normalizeZipEntryName(fileName: string): ZipEntryTarget | null {
  if (fileName.includes("\0") || fileName.includes("\\")) {
    throw new Error("ZIP 包含非法路径分隔符。");
  }
  if (fileName.startsWith("/") || /^[a-zA-Z]:\//.test(fileName)) {
    throw new Error("ZIP 包含绝对路径。");
  }
  if (fileName.endsWith("/")) {
    return null;
  }
  const parts = fileName.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error("ZIP 包含不安全路径。");
  }
  if (parts.length > 2) {
    throw new Error("ZIP 目录层级过深。");
  }
  const name = parts.length === 1 ? parts[0] : parts[1];
  if (!name || !allowedZipFiles.has(name)) {
    throw new Error(`ZIP 包含不支持的文件：${name}`);
  }
  return { name, topLevel: parts.length === 1 ? "" : parts[0] };
}

