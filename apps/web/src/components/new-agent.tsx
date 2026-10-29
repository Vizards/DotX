import { useState } from 'react';
import type { ServiceInfo } from '@dotx/shared/http/service';
import { Dialog } from './ui/dialog.tsx';
import { Tabs } from './ui/tabs.tsx';
import { Prompt } from './prompt.tsx';
import { fill, t } from '../i18n/index.ts';

/** Opening or copying this dialog never creates a server record. */
export function NewAgentDialog({
  open,
  title,
  service,
  onClose,
}: {
  open: boolean;
  title: string;
  service: ServiceInfo;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title={title} kind="modal" onClose={onClose}>
      <ConnectionInstructions service={service} />
    </Dialog>
  );
}
function ConnectionInstructions({ service }: { service: ServiceInfo }) {
  const [mode, setMode] = useState<'agent' | 'manual'>('agent');
  return (
    <>
      <Tabs
        value={mode}
        onChange={setMode}
        items={[
          { value: 'agent', label: t.agents.copyPrompt },
          { value: 'manual', label: t.agents.manual },
        ]}
      />
      {mode === 'agent' ? (
        <>
          <p className="lede">{t.agents.sendPromptHint}</p>
          <Prompt
            value={fill(t.agents.connectPrompt, {
              address: service.mcp_url,
              guide: new URL('personal-agents/index.md', service.guides_url).href,
            })}
            label={t.agents.copyPrompt}
          />
        </>
      ) : (
        <>
          <p>{t.agents.manualHint}</p>
          <Prompt value={service.mcp_url} label={t.common.copy} />
        </>
      )}
    </>
  );
}
