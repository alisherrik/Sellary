import { ModuleGuard } from '@/components/ModuleGuard';

export default function PurchaseReportLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="purchasing">{children}</ModuleGuard>;
}
