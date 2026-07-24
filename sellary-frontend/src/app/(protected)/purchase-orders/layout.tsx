import { ModuleGuard } from '@/components/ModuleGuard';

export default function PurchaseOrdersLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="purchasing">{children}</ModuleGuard>;
}
