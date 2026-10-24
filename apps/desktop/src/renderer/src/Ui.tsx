import type { ReactNode } from "react";

export type Route = "pets" | "settings";
export type ToastKind = "success" | "error";

export interface ToastState {
  readonly id: number;
  readonly kind: ToastKind;
  readonly text: string;
}

interface SidebarProps {
  readonly route: Route;
  readonly onChange: (route: Route) => void;
}

export function Sidebar({ route, onChange }: SidebarProps) {
  return (
    <aside className="flex w-[228px] shrink-0 flex-col bg-gradient-to-b from-[#102149] to-[#0b1830] px-4 py-6">
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand text-white shadow-[0_10px_24px_rgba(23,109,242,0.35)]">
          <PawIcon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-base font-semibold text-white">DeskPet</p>
          <p className="text-xs text-slate-400">桌面宠物</p>
        </div>
      </div>

      <nav className="space-y-1">
        <button
          type="button"
          className={`nav-item ${route === "pets" ? "nav-item-active" : ""}`}
          onClick={() => onChange("pets")}
        >
          <PawIcon className="h-4 w-4" />
          宠物
        </button>
        <button
          type="button"
          className={`nav-item ${route === "settings" ? "nav-item-active" : ""}`}
          onClick={() => onChange("settings")}
        >
          <GearIcon className="h-4 w-4" />
          设置
        </button>
      </nav>

      <div className="mt-auto rounded-2xl bg-white/5 p-3 text-xs leading-5 text-slate-400">
        双击宠物、或右键宠物选择“打开控制中心”，都可以快速回到这里。
      </div>
    </aside>
  );
}

interface SectionProps {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}

export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="card p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-navy">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  readonly title: string;
  readonly description: string;
  readonly control: ReactNode;
}

export function SettingRow({ title, description, control }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-sm font-medium text-navy">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}

interface ToggleProps {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
}

export function Toggle({ checked, disabled = false, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-brand" : "bg-slate-300"} ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

interface ToastProps {
  readonly toast: ToastState;
  readonly onClose: () => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div
        className={`flex max-w-sm items-start gap-3 rounded-2xl px-4 py-3 text-sm shadow-[0_18px_50px_rgba(15,23,42,0.22)] ${
          toast.kind === "success" ? "bg-[#0f2a52] text-white" : "bg-rose-600 text-white"
        }`}
      >
        <span className="mt-0.5">
          {toast.kind === "success" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}
        </span>
        <p className="flex-1 leading-5">{toast.text}</p>
        <button type="button" className="text-white/70 transition hover:text-white" onClick={onClose} aria-label="关闭提示">
          ×
        </button>
      </div>
    </div>
  );
}

export function PawIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="15.5" rx="5.2" ry="4.2" />
      <circle cx="6.2" cy="9.2" r="1.8" />
      <circle cx="10" cy="6" r="1.8" />
      <circle cx="14" cy="6" r="1.8" />
      <circle cx="17.8" cy="9.2" r="1.8" />
    </svg>
  );
}

export function GearIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.15.63.72 1.08 1.37 1.08H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function FolderPlusIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

export function PackageIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" />
      <path d="m4.4 7.6 7.6 4.3 7.6-4.3M12 12v9" />
    </svg>
  );
}

export function CheckIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

export function AlertIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}
