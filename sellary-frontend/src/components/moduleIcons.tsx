import {
  ReceiptPercentIcon,
  ShoppingCartIcon,
  UsersIcon,
  CubeIcon,
  TruckIcon,
  BuildingStorefrontIcon,
  ChartBarIcon,
  BanknotesIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import type { ModuleKey } from '@/lib/modules';

// Shared icon set for the workspace shell (rail buttons + /apps launcher
// cards) so both stay visually in sync. Heroicons outline is used in place of
// hand-drawn SVGs from the prototype — same 24x24/stroke visual weight, and
// consistent with icons already used elsewhere in the app (Layout, ShiftGate).
export const MODULE_ICONS: Record<ModuleKey | 'settings', typeof ShoppingCartIcon> = {
  register: ShoppingCartIcon,
  sales: ReceiptPercentIcon,
  customers: UsersIcon,
  inventory: CubeIcon,
  purchasing: TruckIcon,
  shop: BuildingStorefrontIcon,
  reports: ChartBarIcon,
  finance: BanknotesIcon,
  settings: Cog6ToothIcon,
};
