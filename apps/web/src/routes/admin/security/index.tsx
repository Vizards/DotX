import { NameDialog } from '../../../components/ui/name-dialog.tsx';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { sessionQuery } from '../../../queries/session.ts';
import { securityQuery } from '../../../queries/login.ts';
import { removeLoginMutation, renamePasskeyMutation } from '../../../mutations/login.ts';
import { PasswordForm, PasskeyForm } from '../../../components/auth/login-methods.tsx';
import { Alert, Loading } from '../../../components/ui/feedback.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Dialog } from '../../../components/ui/dialog.tsx';
import { useConfirm } from '../../../components/confirm-context.ts';
import { date, t } from '../../../i18n/index.ts';

export const Route = createFileRoute('/admin/security/')({ component: Security });

type Editing = { kind: 'password' } | { kind: 'passkey' } | null;

function Security() {
  const session = useQuery(sessionQuery());
  const security = useQuery(securityQuery());
  const client = useQueryClient();
  const csrf = session.data?.authenticated ? session.data.csrf_token! : '';
  const remove = useMutation(removeLoginMutation(csrf));
  const rename = useMutation(renamePasskeyMutation(csrf));
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Editing>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  if (security.isPending) return <Loading />;
  if (security.error)
    return (
      <Alert
        error={security.error}
        retry={() => {
          void security.refetch();
        }}
      />
    );

  const info = security.data;
  const onlyPasskey = !info.password_enabled && info.passkeys.length === 1;
  const reload = () => window.location.reload();

  const removePassword = async () => {
    await confirm({
      title: t.security.removePasswordTitle,
      body: t.security.removePasswordBody,
      confirm: t.security.removeConfirm,
      danger: true,
      onConfirm: async () => {
        await remove.mutateAsync(undefined);
        reload();
      },
    });
  };

  const removePasskey = async (id: string) => {
    await confirm({
      title: t.security.removePasskeyTitle,
      body: t.security.removePasskeyBody,
      confirm: t.security.removeConfirm,
      danger: true,
      onConfirm: async () => {
        await remove.mutateAsync(id);
        reload();
      },
    });
  };

  return (
    <>
      <div className="page-head">
        <h1>{t.security.title}</h1>
      </div>

      <div className="settings-grid">
        <section className="card">
          <h2>{t.security.passwordTitle}</h2>
          <p>{info.password_enabled ? t.security.passwordSet : t.security.passwordUnset}</p>
          <div className="card-actions">
            <Button variant="outline" onClick={() => setEditing({ kind: 'password' })}>
              {info.password_enabled
                ? t.security.passwordChangeAction
                : t.security.passwordSetAction}
            </Button>
            {info.password_enabled && (
              <Button
                variant="danger"
                disabled={remove.isPending || !info.passkeys.length}
                title={!info.passkeys.length ? t.security.passwordKeepOne : undefined}
                onClick={() => void removePassword()}
              >
                {t.security.passwordRemove}
              </Button>
            )}
          </div>
        </section>

        <section className="card">
          <h2>
            {t.security.passkeyTitle}
            <span className="count">{info.passkeys.length}</span>
          </h2>
          {info.passkeys.length ? (
            <ul className="passkeys">
              {info.passkeys.map((passkey) => (
                <li key={passkey.id}>
                  <span>
                    {passkey.name || '—'}
                    <small className="num">
                      {t.security.passkeyAdded.replace('{date}', date(passkey.created_at))}
                    </small>
                  </span>
                  <span className="passkey-acts">
                    <button
                      type="button"
                      className="act"
                      onClick={() => {
                        rename.reset();
                        setRenaming({ id: passkey.id, name: passkey.name });
                      }}
                    >
                      {t.security.passkeyRename}
                    </button>
                    <button
                      type="button"
                      className="act act--danger"
                      disabled={remove.isPending || onlyPasskey}
                      title={onlyPasskey ? t.security.passkeyRemoveLast : undefined}
                      onClick={() => void removePasskey(passkey.id)}
                    >
                      {t.security.passkeyRemove}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>{t.security.passkeyEmpty}</p>
          )}
          <div className="card-actions">
            <Button variant="outline" onClick={() => setEditing({ kind: 'passkey' })}>
              {t.security.addPasskey}
            </Button>
          </div>
        </section>
      </div>

      <Dialog
        open={editing !== null}
        title={editing?.kind === 'passkey' ? t.security.addPasskey : t.security.passwordTitle}
        kind="modal"
        showClose={false}
        onClose={() => setEditing(null)}
      >
        {editing?.kind === 'password' && (
          <>
            <p>{t.security.passwordDialogBody}</p>
            <PasswordForm
              auth={{ csrf }}
              submitLabel={t.forms.savePassword}
              onSubmit={() => {
                setEditing(null);
                reload();
              }}
            />
          </>
        )}
        {editing?.kind === 'passkey' && (
          <>
            <p>{t.security.description}</p>
            <PasskeyForm
              auth={{ csrf }}
              name
              label={t.security.passkeyCreate}
              onSubmit={() => {
                setEditing(null);
                reload();
              }}
            />
          </>
        )}
        <div className="acts">
          <Button onClick={() => setEditing(null)}>{t.common.cancel}</Button>
        </div>
      </Dialog>

      {renaming && (
        <NameDialog
          key={renaming.id}
          title={t.security.passkeyRenameTitle}
          label={t.security.passkeyNameLabel}
          placeholder={t.security.passkeyNamePlaceholder}
          initialValue={renaming.name}
          changedOnly={false}
          busy={rename.isPending}
          error={rename.error}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            const result = await rename.mutateAsync({ id: renaming.id, name });
            client.setQueryData(securityQuery().queryKey, { ...info, passkeys: result.passkeys });
          }}
        />
      )}
    </>
  );
}
