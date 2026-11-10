import { Dialog } from '../ui/dialog.tsx';
import { Prompt } from '../prompt.tsx';
import { fill, t } from '../../i18n/index.ts';
import { guideUrl } from '../../lib/guides.ts';

export function RecoverDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title={t.login.recoverTitle} kind="modal" onClose={onClose}>
      <section className="recover-part">
        <p>{t.login.recoverAgentBody}</p>
        <Prompt
          value={fill(t.login.recoverPrompt, {
            origin: window.location.origin,
            guide: guideUrl('troubleshooting/browser-login.md'),
          })}
        />
      </section>
    </Dialog>
  );
}
