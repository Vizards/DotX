import { en, type Messages } from './en.ts';
import { zh } from './zh.ts';

export type Lang = 'en' | 'zh';

// Follow the system language; there is no manual switch. Prefix match so
// zh-CN, zh-TW and zh-Hans all resolve to Chinese. (§18.1)
export const lang: Lang = (() => {
  const locale = navigator.languages?.[0] ?? navigator.language ?? 'en';
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
})();

export const t: Messages = lang === 'zh' ? zh : en;

export const locale: string = lang === 'zh' ? 'zh-CN' : 'en';

export type ErrorCode = keyof Messages['errors'];

/** Localized message for a server error code, falling back to its text. */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'CLAIM_ATTEMPTS_EXHAUSTED' && 'details' in error) {
      const details = error.details;
      const seconds =
        details && typeof details === 'object' && 'retry_after_seconds' in details
          ? details.retry_after_seconds
          : undefined;
      if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0)
        return fill(t.claim.rateLimited, { seconds: Math.ceil(seconds) });
    }
    if (code in t.errors) return t.errors[code as ErrorCode];
    return error.message;
  }
  return String(error);
}

/** Fill {name} placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

/** "3 hours ago" / "in 14 minutes" from a millisecond timestamp. */
export function since(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

const stamp = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

export const dateTime = (at: number): string => stamp.format(at);
export const date = (at: number): string => day.format(at);
