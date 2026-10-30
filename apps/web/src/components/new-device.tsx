import { Dialog } from './ui/dialog.tsx';
import { Prompt } from './prompt.tsx';
import { fill, t } from '../i18n/index.ts';
import { guideUrl } from '../lib/guides.ts';

/** The same Mac handoff is reachable from Overview and the empty device list. */
export function NewDeviceDialog({
  open,
  origin,
  onClose,
}: {
  open: boolean;
  origin: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title={t.overview.addMacTitle} kind="modal" onClose={onClose}>
      <p>{t.overview.macSheetBody}</p>
      <Prompt value={fill(t.overview.macPrompt, { origin, guide: guideUrl('codex/connect.md') })} />
      <p className="caption">{t.overview.macSheetTail}</p>
    </Dialog>
  );
}
