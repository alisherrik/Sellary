const cardLabels: Record<string, string> = { alif: 'Alif', eskhata: 'Eskhata', dc: 'DC' };

export function PaymentChip({ method, cardType }: { method: string; cardType?: string | null }) {
  const m = (method || '').toLowerCase();
  const ct = (cardType || '').toLowerCase();
  let label = '💵 Наличные';
  let cls = 'bg-zinc-100 text-zinc-600 dark:bg-gray-700 dark:text-gray-300';
  if (m === 'card') {
    label = `💳 ${ct ? (cardLabels[ct] ?? cardType) : 'Карта'}`;
    cls = 'bg-sky-50 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300';
  } else if (m === 'mobile') {
    label = '📱 Мобильный';
    cls = 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300';
  }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}
