'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface SalesChartProps {
  data: Array<{ date: string; total_sales: number }>;
  days: number;
}

export default function SalesChart({ data, days }: SalesChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl bg-gray-50 px-4 py-10 text-center text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400">
        Недостаточно данных для графика
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip formatter={(value) => formatCurrency(Number(value))} />
        <Line type="monotone" dataKey="total_sales" stroke="#2563eb" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
