import { ModuleGuard } from '@/components/ModuleGuard';

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="finance">{children}</ModuleGuard>;
}
