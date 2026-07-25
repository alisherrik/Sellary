'use client';

import { ChangeEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowRightOnRectangleIcon, BuildingOffice2Icon } from '@heroicons/react/24/outline';
import { useAuthStore } from '@/lib/store';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import BottomSheet from './BottomSheet';

interface MobileAccountSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Mobile counterpart to the desktop header's account cluster: who you are,
 * which company you're in, whether the server is reachable, and the way out.
 * Without this the shell has no logout at all — a real problem on the shared
 * device a shift is handed over on.
 */
export default function MobileAccountSheet({ isOpen, onClose }: MobileAccountSheetProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const currentCompany = useAuthStore((state) => state.currentCompany);
  const companies = useAuthStore((state) => state.companies);
  const switchCompany = useAuthStore((state) => state.switchCompany);
  const logout = useAuthStore((state) => state.logout);
  const [switching, setSwitching] = useState(false);

  const companyList = companies ?? [];

  const handleCompanyChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const companyId = Number(event.target.value);
    if (!companyId || companyId === currentCompany?.id) {
      return;
    }

    setSwitching(true);
    try {
      await switchCompany(companyId);
      queryClient.clear();
      onClose();
      router.replace('/apps');
      toast.success('Компания успешно переключена.');
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail || error?.message || 'Не удалось переключить компанию.',
      );
    } finally {
      setSwitching(false);
    }
  };

  const handleLogout = () => {
    logout();
    onClose();
    router.push('/login');
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Аккаунт">
      <div className="px-4 pb-8 pt-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center bg-[var(--erp-accent)] text-[17px] font-extrabold text-white">
            {user?.username?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[15px] font-extrabold text-[var(--erp-text)]">
              {user?.full_name || user?.username || 'Пользователь'}
            </div>
            <div className="text-[12px] capitalize text-[var(--erp-muted)]">
              {currentCompany?.role || ''}
            </div>
          </div>
          <div className="ml-auto">
            <ConnectionStatus />
          </div>
        </div>

        <label className="mt-6 block">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[var(--erp-muted)]">
            Компания
          </span>
          <span className="mt-1.5 flex min-h-[44px] items-center gap-2 border border-[var(--erp-divider)] px-3">
            <BuildingOffice2Icon className="h-4 w-4 shrink-0 text-[var(--erp-muted)]" />
            <select
              value={currentCompany?.id ?? ''}
              onChange={handleCompanyChange}
              disabled={companyList.length <= 1 || switching}
              className="min-h-[44px] w-full bg-transparent text-[14px] font-bold text-[var(--erp-text)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] disabled:cursor-not-allowed"
            >
              {companyList.length === 0 && <option value="">{currentCompany?.name || 'Нет компании'}</option>}
              {companyList.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </span>
        </label>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-6 flex min-h-[44px] w-full items-center justify-center gap-2 border-2 border-[var(--erp-divider)] px-4 text-[15px] font-extrabold text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
        >
          <ArrowRightOnRectangleIcon className="h-5 w-5" />
          Выйти
        </button>
      </div>
    </BottomSheet>
  );
}
