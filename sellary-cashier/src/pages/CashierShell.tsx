import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';
import { POSPage } from './POSPage';

export function CashierShell() {
  const { isAuthenticated, restoreSession } = useAuthStore();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function check() {
      if (!isAuthenticated) {
        const restored = await restoreSession();
        if (restored) {
          setChecking(false);
          return;
        }
        navigate('/login', { replace: true });
      } else {
        setChecking(false);
      }
    }
    check();
  }, []);

  if (checking) {
    return null;
  }

  if (!isAuthenticated) {
    return null;
  }

  return <POSPage />;
}
