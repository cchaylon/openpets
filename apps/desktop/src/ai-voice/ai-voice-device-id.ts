import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { arch, hostname, networkInterfaces, platform } from "node:os";

let cachedDeviceId: string | null = null;

/**
 * Derives a stable MAC-format device ID from this computer's own identifier.
 * The same machine always produces the same ID, while different machines
 * produce different IDs without persisting or sharing any hardware value.
 */
export function getAiVoiceDeviceId(): string {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }
  cachedDeviceId = deriveDeviceId();
  return cachedDeviceId;
}

function deriveDeviceId(): string {
  const machineId = readMachineId() ?? readNetworkFallback();
  const digest = createHash("sha256")
    .update(`deskpet-ai-voice|${platform()}|${arch()}|${machineId}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 6));
  // Keep the address unicast and mark it as locally administered, matching the
  // `02:xx:xx:xx:xx:xx` convention used by virtual devices.
  bytes[0] = (bytes[0] | 0x02) & 0xfe;
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(":");
}

function readMachineId(): string | null {
  if (process.platform === "win32") {
    return readWindowsMachineGuid();
  }
  if (process.platform === "darwin") {
    return readMacPlatformUuid();
  }
  return readLinuxMachineId();
}

function readWindowsMachineGuid(): string | null {
  try {
    const output = execFileSync(
      "reg",
      ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { encoding: "utf8", timeout: 3000, windowsHide: true },
    );
    const match = /MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i.exec(output);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function readMacPlatformUuid(): string | null {
  try {
    const output = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
      encoding: "utf8",
      timeout: 3000,
    });
    const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(output);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function readLinuxMachineId(): string | null {
  for (const filePath of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      if (!existsSync(filePath)) {
        continue;
      }
      const value = readFileSync(filePath, "utf8").trim();
      if (value.length > 0) {
        return value;
      }
    } catch {
      // Try the next machine-id location.
    }
  }
  return null;
}

function readNetworkFallback(): string {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .map((entry) => entry.mac)
    .filter((mac) => mac && mac !== "00:00:00:00:00:00")
    .sort();
  return `${hostname()}|${addresses[0] ?? "no-mac"}`;
}
