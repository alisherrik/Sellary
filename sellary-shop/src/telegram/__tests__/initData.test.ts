import { parseInitData } from '../initData';

describe('parseInitData', () => {
  it('returns null for empty string', () => {
    expect(parseInitData('')).toBeNull();
  });

  it('parses a valid initData query string', () => {
    const user = JSON.stringify({ id: 42, first_name: 'Ali', username: 'ali' });
    const initDataStr = `auth_date=1700000000&user=${encodeURIComponent(user)}&hash=abc`;
    const result = parseInitData(initDataStr);
    expect(result).not.toBeNull();
    expect(result!.user.id).toBe(42);
    expect(result!.user.first_name).toBe('Ali');
    expect(result!.authDate).toBe(1700000000);
    expect(result!.hash).toBe('abc');
  });

  it('returns null when user field is missing', () => {
    expect(parseInitData('auth_date=1&hash=x')).toBeNull();
  });

  it('returns null when auth_date is missing', () => {
    const user = encodeURIComponent(JSON.stringify({ id: 1 }));
    expect(parseInitData(`user=${user}&hash=x`)).toBeNull();
  });
});
