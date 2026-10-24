import { useEffect, useRef, useState } from "react";

import type { ControlCenterSnapshot } from "../../shared-types";
import { PetsPage } from "./PetsPage";
import { SettingsPage } from "./SettingsPage";
import { Sidebar, Toast, type Route, type ToastKind, type ToastState } from "./Ui";

export function App() {
  const [snapshot, setSnapshot] = useState<ControlCenterSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>("pets");
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    let active = true;
    if (!window.deskpet) {
      setLoadError("请在 DeskPet 应用内打开控制中心。");
      return undefined;
    }
    window.deskpet.getSnapshot()
      .then((next) => {
        if (active) {
          setSnapshot(next);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(errorMessage(error));
        }
      });
    window.deskpet.onSnapshotChanged((next) => setSnapshot(next));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  function showToast(kind: ToastKind, text: string): void {
    toastId.current += 1;
    setToast({ id: toastId.current, kind, text });
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="card max-w-md p-8 text-center">
          <p className="text-lg font-semibold text-navy">无法加载控制中心</p>
          <p className="mt-2 text-sm text-muted">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          正在加载…
        </div>
      </div>
    );
  }

  const currentPet = snapshot.pets.find((pet) => pet.id === snapshot.currentPetId) ?? snapshot.pets[0];

  return (
    <div className="flex h-full">
      <Sidebar route={route} onChange={setRoute} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200/80 bg-white/70 px-8 py-5 backdrop-blur">
          <div>
            <h1 className="text-xl font-semibold text-navy">{route === "pets" ? "宠物" : "设置"}</h1>
            <p className="mt-1 text-sm text-muted">
              {route === "pets" ? "选择常驻桌面的伙伴，或导入自己的宠物。" : "调整宠物的外观与窗口行为，修改即时生效。"}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
            <span className={`h-2 w-2 rounded-full ${snapshot.petVisible ? "bg-emerald-500" : "bg-slate-400"}`} />
            {snapshot.petVisible ? "桌面上" : "已隐藏"} · {currentPet?.displayName ?? "未选择"}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {route === "pets" ? (
            <PetsPage snapshot={snapshot} onSnapshot={setSnapshot} onToast={showToast} />
          ) : (
            <SettingsPage snapshot={snapshot} onSnapshot={setSnapshot} onToast={showToast} />
          )}
        </div>
      </main>

      {toast ? <Toast key={toast.id} toast={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
