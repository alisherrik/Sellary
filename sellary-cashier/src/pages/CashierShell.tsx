import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';
import { POSPage } from './POSPage';
import { PinUnlockPage } from './PinUnlockPage';
import { NeedsReauthBanner } from '../components/NeedsReauthBanner';
import { OfflineFirstRunScreen } from '../components/OfflineFirstRunScreen';

type Gate = 'checking' | 'pos' | 'pin' | 'offline-first-run';

export function CashierShell() {
  const { isAuthenticated, restoreSession } = useAuthStore();
  const navigate = useNavigate();
  const [gate, setGate] = useState<Gate>('checking');

  useEffect(() => {
    async function check() {
      if (isAuthenticated) {
        setGate('pos');
        return;
      }
      const provisioned = await restoreSession();
      if (provisioned) {
        setGate('pin'); // device + PIN exist → unlock (token may be expired)
        return;
      }
      // Not provisioned. If device exists but PIN is missing, resume setup.
      if (useAuthStore.getState().hasDevice && !useAuthStore.getState().hasPin) {
        navigate('/pin-setup', { replace: true });
        return;
      }
      if (navigator.onLine) {
        navigate('/login', { replace: true });
      } else {
        setGate('offline-first-run');
      }
    }
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isAuthenticated) {
    return (
      <>
        <NeedsReauthBanner />
        <POSPage />
      </>
    );
  }
  if (gate === 'pin') return <PinUnlockPage />;
  if (gate === 'offline-first-run') return <OfflineFirstRunScreen />;
  return null;
}
