import { createContext, useContext } from 'react';

export type ConfirmRequest = {
  title: string;
  body: string;
  confirm: string;
  /** Names the outcome of declining, when "Cancel" would be vague. */
  cancel?: string;
  danger?: boolean;
  /** Keep the dialog open on failure, with the error beside the action. */
  onConfirm?: () => Promise<unknown>;
};

/** Resolves true after confirmation succeeds; Escape and Cancel resolve false. */
export type AskConfirm = (request: ConfirmRequest) => Promise<boolean>;

export const ConfirmContext = createContext<AskConfirm>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}
