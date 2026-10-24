import { useState } from "react";

import type { ControlCenterSnapshot, PetSummary } from "../../shared-types";
import type { ToastKind } from "./Ui";
import { FolderPlusIcon, PackageIcon } from "./Ui";

interface PetsPageProps {
  readonly snapshot: ControlCenterSnapshot;
  readonly onSnapshot: (snapshot: ControlCenterSnapshot) => void;
  readonly onToast: (kind: ToastKind, text: string) => void;
}

type ImportKind = "folder" | "zip";

export function PetsPage({ snapshot, onSnapshot, onToast }: PetsPageProps) {
  const [busy, setBusy] = useState<string | null>(null);

  async function handleImport(kind: ImportKind): Promise<void> {
    setBusy(kind);
    try {
      const result = kind === "folder"
        ? await window.deskpet.importPetFolder()
        : await window.deskpet.importPetZip();
      onToast(result.ok ? "success" : "error", result.message);
      if (result.ok) {
        onSnapshot(await window.deskpet.getSnapshot());
      }
    } catch (error) {
      onToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleSetDefault(pet: PetSummary): Promise<void> {
    setBusy(pet.id);
    try {
      onSnapshot(await window.deskpet.setDefaultPet(pet.id));
      onToast("success", `已切换到 ${pet.displayName}`);
    } catch (error) {
      onToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(pet: PetSummary): Promise<void> {
    const confirmed = window.confirm(`确定移除宠物「${pet.displayName}」吗？本地文件也会删除。`);
    if (!confirmed) {
      return;
    }
    setBusy(pet.id);
    try {
      onSnapshot(await window.deskpet.removePet(pet.id));
      onToast("success", `已移除 ${pet.displayName}`);
    } catch (error) {
      onToast("error", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-navy">我的宠物</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            宠物包需包含 <code className="rounded bg-slate-100 px-1 py-0.5">pet.json</code> 与{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">spritesheet.webp</code>
            （或 <code className="rounded bg-slate-100 px-1 py-0.5">spritesheet.svg</code>），兼容 OpenPets 宠物格式。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={() => void handleImport("folder")}
          >
            <FolderPlusIcon className="h-4 w-4" />
            {busy === "folder" ? "导入中…" : "导入文件夹"}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            onClick={() => void handleImport("zip")}
          >
            <PackageIcon className="h-4 w-4" />
            {busy === "zip" ? "导入中…" : "导入 ZIP"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.pets.map((pet, index) => {
          const active = pet.id === snapshot.currentPetId;
          const working = busy === pet.id;
          return (
            <article
              key={pet.id}
              className={`card flex flex-col overflow-hidden transition ${active ? "ring-2 ring-brand/60" : ""}`}
            >
              <div className="relative flex h-44 items-center justify-center bg-[radial-gradient(circle_at_50%_35%,#eef4ff_0%,#f8fafc_60%,#f1f5f9_100%)]">
                <div className="pet-thumb">
                  <div
                    className="pet-thumb-sprite"
                    style={{
                      backgroundImage: `url("${pet.spriteUrl}")`,
                      backgroundSize: `1536px ${pet.spriteVersion === 2 ? 2288 : 1872}px`,
                      animationDelay: `${-0.7 * (index % 5)}s`,
                    }}
                  />
                </div>
                <div className="absolute left-3 top-3 flex gap-1.5">
                  {pet.builtIn ? (
                    <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm">
                      内置
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm">
                      已导入
                    </span>
                  )}
                  {active ? (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-white shadow-sm">
                      使用中
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-navy">{pet.displayName}</h3>
                  <span className="mt-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 font-display text-[10px] text-slate-500">
                    v{pet.spriteVersion}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{pet.description}</p>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    className={active ? "btn-secondary flex-1" : "btn-primary flex-1"}
                    disabled={active || busy !== null}
                    onClick={() => void handleSetDefault(pet)}
                  >
                    {active ? "当前使用" : working ? "切换中…" : "设为默认"}
                  </button>
                  {pet.builtIn ? null : (
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={busy !== null}
                      onClick={() => void handleRemove(pet)}
                    >
                      移除
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="card p-5">
        <p className="text-sm font-medium text-navy">宠物来源</p>
        <div className="mt-3 grid gap-3 text-xs leading-5 text-muted sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="font-medium text-slate-700">本地导入</p>
            <p className="mt-1">
              支持直接选择文件夹，或选择只包含 <code>pet.json</code> 与精灵图的 ZIP 包。导入前会校验格式、尺寸与透明通道。
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="font-medium text-slate-700">内置宠物</p>
            <p className="mt-1">Hoodie Cat 随应用提供，无需联网，始终可作为默认选择。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
