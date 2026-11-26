import { useState } from "react";
import { MiniAppShell } from "./MiniAppShell";
import type { AthenaeumConfig } from "../../types/athenaeum";

/* ==================== CHAMBER AUTOMATIONS ==================== */
interface AutomationsProps {
  config: AthenaeumConfig;
  onTestWebhook: () => Promise<string>;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function AutomationsMiniApp({
  config,
  onTestWebhook,
  onOpenSettings,
  onClose,
}: AutomationsProps) {
  const [status, setStatus] = useState<string | null>(null);

  return (
    <MiniAppShell
      title="Automations"
      subtitle="Home Assistant room scenes and n8n workflow bridge"
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="smoked-glass rounded-[12px] p-6">
          <div className="font-ui text-[0.64rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
            Home Assistant Focus Scene
          </div>
          <h3 className="mt-2 font-editorial text-[1.4rem] text-[var(--text-ivory)]">
            Deep Work Lighting Trigger
          </h3>
          <p className="mt-2 font-reading text-[0.96rem] text-[var(--text-muted)]">
            Endpoint: {config.homeAssistantWebhookUrl || "Not configured in config.json"}
          </p>
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                const msg = await onTestWebhook();
                setStatus(msg);
              }}
              className="smoked-glass smoked-glass-hover cursor-pointer rounded-full px-5 py-2 font-ui text-[0.7rem] uppercase tracking-[0.14em] text-[var(--text-ivory)]"
            >
              Test Focus Scene
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="cursor-pointer bg-transparent border-0 font-ui text-[0.7rem] uppercase tracking-[0.14em] text-[var(--accent-luminous)] hover:underline"
            >
              Configure in Settings
            </button>
          </div>
          {status && (
            <div className="mt-3 font-ui text-[0.72rem] text-[var(--accent-luminous)]">
              {status}
            </div>
          )}
        </div>

        <div className="smoked-glass rounded-[12px] p-6">
          <div className="font-ui text-[0.64rem] uppercase tracking-[0.2em] text-[var(--accent-brass)]">
            n8n Orchestration Slot
          </div>
          <h3 className="mt-2 font-editorial text-[1.4rem] text-[var(--text-ivory)]">
            Evening Synthesis & Digest
          </h3>
          <p className="mt-2 font-reading text-[0.96rem] text-[var(--text-muted)]">
            Webhook: {config.n8nWebhookUrl || "Reserved for local n8n triggers"}
          </p>
        </div>
      </div>
    </MiniAppShell>
  );
}
