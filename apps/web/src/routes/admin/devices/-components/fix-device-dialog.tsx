import type { AdminDevice } from '@dotx/shared/http/admin';
import { Dialog } from '../../../../components/ui/dialog.tsx';
import { Prompt } from '../../../../components/prompt.tsx';
import { fill, t } from '../../../../i18n/index.ts';
import { guideUrl } from '../../../../lib/guides.ts';
export function FixDeviceDialog({
  device,
  origin,
  onClose,
}: {
  device: AdminDevice;
  origin: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      title={t.devices.fixTitle.replace('{name}', device.name ?? '')}
      kind="modal"
      onClose={onClose}
    >
      <p>
        {device.compatible === false
          ? fill(t.devices.fixWireBody, {
              wire: device.wire_protocol ?? 0,
              server: device.server_wire_protocol,
            })
          : device.online
            ? t.devices.fixInterfaceBody
            : t.devices.fixOfflineBody}
      </p>
      <Prompt
        value={
          device.compatible === false
            ? fill(t.devices.fixWirePrompt, {
                name: device.name,
                origin,
                guide: guideUrl('codex/update.md'),
              })
            : fill(t.devices.fixPrompt, {
                name: device.name ?? '',
                origin,
                guide: guideUrl('troubleshooting/device.md'),
              })
        }
      />
      <p className="caption">{t.devices.fixTail}</p>
    </Dialog>
  );
}
