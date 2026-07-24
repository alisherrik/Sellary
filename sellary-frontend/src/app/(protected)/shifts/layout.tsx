import { ModuleGuard } from '@/components/ModuleGuard';

export default function ShiftsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="pos">{children}</ModuleGuard>;
}
