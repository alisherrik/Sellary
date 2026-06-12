import { CheckIcon, LockClosedIcon } from '@heroicons/react/20/solid';

import type { PurchaseOrderStatus } from '@/lib/types';

export type PurchaseOrderStep = 'supplier' | 'items' | 'review' | 'receive';

const steps: Array<{ id: PurchaseOrderStep; label: string; number: number }> = [
  { id: 'supplier', label: 'Поставщик', number: 1 },
  { id: 'items', label: 'Товары', number: 2 },
  { id: 'review', label: 'Проверка', number: 3 },
  { id: 'receive', label: 'Приёмка', number: 4 },
];

interface PurchaseOrderStepperProps {
  mode: 'editor' | 'detail';
  currentStep: PurchaseOrderStep;
  status: PurchaseOrderStatus;
  onStepChange?: (step: PurchaseOrderStep) => void;
}

export default function PurchaseOrderStepper({
  mode,
  currentStep,
  status,
  onStepChange,
}: PurchaseOrderStepperProps) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  const receiptUnlocked = ['sent', 'partially_received', 'received'].includes(status);

  return (
    <nav aria-label="Этапы закупки" className="overflow-x-auto">
      <ol className="flex min-w-[620px] items-center" role="list">
        {steps.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isUnavailable = step.id === 'receive' && !receiptUnlocked;
          const isComplete =
            !isUnavailable &&
            (index < currentIndex ||
              (mode === 'detail' && step.id !== 'receive' && status !== 'draft'));
          const state = isUnavailable
            ? 'недоступно'
            : isCurrent
              ? 'текущий'
              : isComplete
                ? 'завершено'
                : 'ожидает';
          const canClick = Boolean(onStepChange && !isUnavailable && mode === 'editor');

          return (
            <li
              key={step.id}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`${step.label}, ${state}`}
              className="flex min-w-36 flex-1 items-center last:flex-none"
            >
              <button
                type="button"
                disabled={!canClick}
                onClick={() => onStepChange?.(step.id)}
                className="group flex min-h-11 items-center gap-2 rounded-md px-2 text-left disabled:cursor-default"
              >
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-bold ${
                    isCurrent
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : isComplete
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-500'
                  }`}
                >
                  {isUnavailable ? (
                    <LockClosedIcon className="h-4 w-4" />
                  ) : isComplete ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : (
                    step.number
                  )}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-gray-900">
                    {step.label}
                  </span>
                  <span className="block text-xs text-gray-500">{state}</span>
                </span>
              </button>
              {index < steps.length - 1 && (
                <span className="mx-2 h-px flex-1 bg-gray-200" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
