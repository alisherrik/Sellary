'use client';

import { useRouter } from 'next/navigation';
import {
  UserGroupIcon,
  TruckIcon,
  ChartBarIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';

const moreItems = [
  { label: 'Клиенты', href: '/customers', icon: UserGroupIcon },
  { label: 'Поставщики', href: '/suppliers', icon: UserGroupIcon },
  { label: 'Закупки', href: '/purchase-orders', icon: TruckIcon },
  { label: 'Отчеты', href: '/reports', icon: ChartBarIcon },
  { label: 'Настройки', href: '/settings', icon: Cog6ToothIcon },
];

interface MoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MoreSheet({ isOpen, onClose }: MoreSheetProps) {
  const router = useRouter();

  if (!isOpen) return null;

  const handleNavigate = (href: string) => {
    router.push(href);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50 animate-scale-in"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 animate-slide-up rounded-t-3xl bg-white pb-safe">
        <div className="mx-auto mt-3 h-1 w-8 rounded-full bg-gray-300" />
        <div className="mt-4 px-4 pb-8">
          <h2 className="mb-3 text-sm font-semibold text-gray-500">Меню</h2>
          <div className="space-y-1">
            {moreItems.map((item) => (
              <button
                key={item.href}
                onClick={() => handleNavigate(item.href)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 hover:bg-gray-50"
              >
                <item.icon className="h-5 w-5 text-gray-500" />
                <span className="text-sm font-medium text-gray-900">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
