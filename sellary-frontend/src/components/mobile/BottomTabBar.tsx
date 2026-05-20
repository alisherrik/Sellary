'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShoppingBagIcon,
  CubeIcon,
  ArrowUturnLeftIcon,
  HomeIcon,
  EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';
import {
  ShoppingBagIcon as ShoppingBagSolid,
  CubeIcon as CubeSolid,
  ArrowUturnLeftIcon as ArrowUturnLeftSolid,
  HomeIcon as HomeSolid,
} from '@heroicons/react/24/solid';

const tabs = [
  {
    label: 'Касса',
    href: '/pos',
    icon: ShoppingBagIcon,
    activeIcon: ShoppingBagSolid,
  },
  {
    label: 'Товары',
    href: '/products',
    icon: CubeIcon,
    activeIcon: CubeSolid,
  },
  {
    label: 'Продажи',
    href: '/sales',
    icon: ArrowUturnLeftIcon,
    activeIcon: ArrowUturnLeftSolid,
  },
  {
    label: 'Дашборд',
    href: '/dashboard',
    icon: HomeIcon,
    activeIcon: HomeSolid,
  },
];

interface BottomTabBarProps {
  onMoreClick: () => void;
}

export default function BottomTabBar({ onMoreClick }: BottomTabBarProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || (href !== '/pos' && href !== '/dashboard' && pathname.startsWith(href));

  return (
    <nav
      className="flex h-14 shrink-0 items-center border-t border-gray-200 bg-white"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {tabs.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-1"
          >
            {active ? (
              <tab.activeIcon className="h-6 w-6 text-blue-600" />
            ) : (
              <tab.icon className="h-6 w-6 text-gray-400" />
            )}
            <span
              className={`text-[10px] font-medium ${
                active ? 'text-blue-600' : 'text-gray-400'
              }`}
            >
              {tab.label}
            </span>
          </Link>
        );
      })}

      <button
        onClick={onMoreClick}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-1"
      >
        <EllipsisHorizontalIcon className="h-6 w-6 text-gray-400" />
        <span className="text-[10px] font-medium text-gray-400">Ещё</span>
      </button>
    </nav>
  );
}
