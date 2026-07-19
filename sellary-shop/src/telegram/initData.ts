export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramInitData {
  user: TelegramUser;
  authDate: number;
  hash: string;
  raw: string;
}

export function parseInitData(raw: string): TelegramInitData | null {
  if (!raw) return null;
  try {
    const params = new URLSearchParams(raw);
    const userStr = params.get('user');
    const authDateStr = params.get('auth_date');
    const hash = params.get('hash');
    if (!userStr || !authDateStr || !hash) return null;
    const user = JSON.parse(userStr) as TelegramUser;
    const authDate = parseInt(authDateStr, 10);
    if (!user?.id || isNaN(authDate)) return null;
    return { user, authDate, hash, raw };
  } catch {
    return null;
  }
}

const DEV_INIT_DATA = (() => {
  const user = JSON.stringify({ id: 0, first_name: 'Dev', username: 'dev' });
  return `auth_date=1700000000&user=${encodeURIComponent(user)}&hash=dev`;
})();

export function getInitDataString(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initData) return tg.initData as string;
  } catch {
    // not in browser
  }
  // Only use the dev fallback in development builds — never in production/staging.
  if (import.meta.env.DEV) return DEV_INIT_DATA;
  return '';
}

export function getInitData(): TelegramInitData | null {
  return parseInitData(getInitDataString());
}
