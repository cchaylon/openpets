import { useEffect, useState } from "react";

import { PET_SCALE_OPTIONS, type AiVoicePreferences, type ControlCenterSnapshot, type PreferencePatch } from "../../shared-types";
import { Section, SettingRow, Toggle, type ToastKind } from "./Ui";

interface SettingsPageProps {
  readonly snapshot: ControlCenterSnapshot;
  readonly onSnapshot: (snapshot: ControlCenterSnapshot) => void;
  readonly onToast: (kind: ToastKind, text: string) => void;
}

export function SettingsPage({ snapshot, onSnapshot, onToast }: SettingsPageProps) {
  const [busy, setBusy] = useState(false);
  const preferences = snapshot.preferences;
  const currentPet = snapshot.pets.find((pet) => pet.id === snapshot.currentPetId) ?? snapshot.pets[0];
  const [aiVoiceDraft, setAiVoiceDraft] = useState<AiVoicePreferences>(preferences.aiVoice);
  const aiVoiceSignature = `${preferences.aiVoice.enabled}|${preferences.aiVoice.otaUrl}`;

  useEffect(() => {
    setAiVoiceDraft(preferences.aiVoice);
  }, [aiVoiceSignature]);

  const aiVoiceDirty = aiVoiceDraft.enabled !== preferences.aiVoice.enabled
    || aiVoiceDraft.otaUrl !== preferences.aiVoice.otaUrl;

  async function update(patch: PreferencePatch): Promise<void> {
    setBusy(true);
    try {
      onSnapshot(await window.deskpet.updatePreferences(patch));
    } catch (error) {
      onToast("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveAiVoice(): Promise<void> {
    const otaUrl = aiVoiceDraft.otaUrl.trim();
    if (otaUrl.length > 0 && !isHttpUrl(otaUrl)) {
      onToast("error", "OTA 地址必须以 http:// 或 https:// 开头。");
      return;
    }
    setBusy(true);
    try {
      const next = await window.deskpet.updatePreferences({
        aiVoice: {
          enabled: aiVoiceDraft.enabled,
          otaUrl,
        },
      });
      onSnapshot(next);
      setAiVoiceDraft(next.preferences.aiVoice);
      onToast("success", "AI语音对话设置已保存。");
    } catch (error) {
      onToast("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetPosition(): Promise<void> {
    setBusy(true);
    try {
      onSnapshot(await window.deskpet.resetPetPosition());
      onToast("success", "已把宠物移回默认位置。");
    } catch (error) {
      onToast("error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Section title="外观" description="只影响宠物本身，不影响控制中心。">
        <SettingRow
          title="宠物大小"
          description="调整后宠物窗口会立即缩放，并保持右下角位置不变。"
          control={
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {PET_SCALE_OPTIONS.map((option) => {
                const active = preferences.petScale === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={busy}
                    onClick={() => void update({ petScale: option.value })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      active ? "bg-white text-navy shadow-sm" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          }
        />
      </Section>

      <Section title="AI语音对话" description="接入 AI 语音服务后，长按 Alt 进行语音对话，点击宠物可以输入文字对话。">
        <SettingRow
          title="启用 AI语音对话"
          description="关闭后长按 Alt 与点击宠物都不会连接 AI 语音服务；文字输入框仍可打开查看历史。"
          control={
            <Toggle
              label="启用 AI语音对话"
              checked={aiVoiceDraft.enabled}
              disabled={busy}
              onChange={(checked) => setAiVoiceDraft({ ...aiVoiceDraft, enabled: checked })}
            />
          }
        />
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-navy">OTA 地址</span>
            <input
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-navy outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              type="url"
              value={aiVoiceDraft.otaUrl}
              placeholder="http://192.168.1.10:8003/xiaozhi/ota/"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setAiVoiceDraft({ ...aiVoiceDraft, otaUrl: event.target.value })}
            />
            <span className="mt-1 block text-xs leading-5 text-muted">
              单模块部署填 <code className="rounded bg-slate-100 px-1 py-0.5">http://服务器IP:8003/xiaozhi/ota/</code>；
              全模块部署填 <code className="rounded bg-slate-100 px-1 py-0.5">http://服务器IP:8002/xiaozhi/ota/</code>。
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-navy">设备 ID（自动生成）</span>
            <input
              className="mt-1.5 w-full cursor-default rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-display text-sm text-slate-600 outline-none"
              type="text"
              value={snapshot.aiVoiceDeviceId}
              readOnly
              spellCheck={false}
            />
            <span className="mt-1 block text-xs leading-5 text-muted">
              由本机唯一标识动态生成，固定为 MAC 格式；同一台电脑每次启动一致，不同电脑不同。
              全模块部署还需要在智控台输入激活码完成绑定。
            </span>
          </label>
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-muted">{aiVoiceDirty ? "有未保存的修改" : "修改后点击保存生效。"}</span>
            <button type="button" className="btn-primary" disabled={busy || !aiVoiceDirty} onClick={() => void saveAiVoice()}>
              保存 AI语音对话设置
            </button>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-muted">
            <p className="font-medium text-slate-700">使用方式</p>
            <p className="mt-1">长按 Alt 说话，松开后等待 AI 回答；点击宠物打开文字输入框。回答会以文字气泡显示在宠物旁边。</p>
          </div>
        </div>
      </Section>

      <Section title="宠物窗口" description="控制宠物在桌面上的显示方式。">
        <SettingRow
          title="启动时显示宠物"
          description="关闭后应用仍会在托盘运行，可以随时从托盘菜单重新显示。"
          control={
            <Toggle
              label="启动时显示宠物"
              checked={preferences.showOnLaunch}
              disabled={busy}
              onChange={(checked) => void update({ showOnLaunch: checked })}
            />
          }
        />
        <SettingRow
          title="始终置顶"
          description="让宠物显示在普通窗口上方。关闭后会和其他窗口一样参与前后层级。"
          control={
            <Toggle
              label="始终置顶"
              checked={preferences.alwaysOnTop}
              disabled={busy}
              onChange={(checked) => void update({ alwaysOnTop: checked })}
            />
          }
        />
        <SettingRow
          title="重置位置"
          description="把宠物移回主屏幕右下角，并清除已记住的位置。"
          control={
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void resetPosition()}>
              重置位置
            </button>
          }
        />
      </Section>

      <Section title="系统" description="与应用启动相关。">
        <SettingRow
          title="开机自启动"
          description="登录系统后自动启动 DeskPet。部分 Linux 桌面环境可能不支持。"
          control={
            <Toggle
              label="开机自启动"
              checked={preferences.launchAtLogin}
              disabled={busy}
              onChange={(checked) => void update({ launchAtLogin: checked })}
            />
          }
        />
      </Section>

      <Section title="关于" description="当前安装信息。">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-muted">版本</p>
            <p className="mt-1 font-display text-sm text-navy">v{snapshot.appVersion}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-muted">当前宠物</p>
            <p className="mt-1 text-sm text-navy">{currentPet?.displayName ?? "未选择"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-muted">桌面状态</p>
            <p className="mt-1 text-sm text-navy">{snapshot.petVisible ? "正在显示" : "已隐藏"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-muted">许可证</p>
            <p className="mt-1 text-sm text-navy">MIT</p>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted">
          DeskPet 是一个在 OpenPets 基础上精简重写的桌面宠物应用，保留宠物核心、宠物选择、设置，并接入 AI语音对话。
        </p>
      </Section>
    </div>
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
