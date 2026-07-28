import type { WriteOffDisposition, WriteOffReason } from './types';

// One source of Russian labels for both the list and the form; the backend
// stores the codes and never the wording.
export const REASON_LABELS: Record<WriteOffReason, string> = {
  spoiled: 'Порча',
  damaged: 'Бой / повреждение',
  defective: 'Заводской брак',
  expired: 'Просрочка',
  lost: 'Утеряно',
  shortage: 'Недостача',
  internal_use: 'Внутреннее использование',
};

export const DISPOSITION_LABELS: Record<WriteOffDisposition, string> = {
  disposed: 'Утилизировано',
  returned_to_supplier: 'Возврат поставщику',
};

export const REASON_ORDER = Object.keys(REASON_LABELS) as WriteOffReason[];

export const reasonLabel = (code: string) =>
  REASON_LABELS[code as WriteOffReason] ?? code;

export const dispositionLabel = (code: string) =>
  DISPOSITION_LABELS[code as WriteOffDisposition] ?? code;
