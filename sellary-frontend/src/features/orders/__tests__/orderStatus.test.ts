import { describe, it, expect } from 'vitest';
import {
  STATUS_LABELS,
  nextStatusActions,
  canConfirm,
  canCancel,
} from '@/features/orders/orderStatus';

describe('order status helpers', () => {
  it('labels every status in Russian', () => {
    expect(STATUS_LABELS.pending).toBe('Новый');
    expect(STATUS_LABELS.confirmed).toBe('Подтверждён');
    expect(STATUS_LABELS.cancelled).toBe('Отменён');
  });

  it('only pending can be confirmed', () => {
    expect(canConfirm('pending')).toBe(true);
    expect(canConfirm('confirmed')).toBe(false);
    expect(canConfirm('completed')).toBe(false);
  });

  it('cannot cancel completed or already-cancelled orders', () => {
    expect(canCancel('pending')).toBe(true);
    expect(canCancel('confirmed')).toBe(true);
    expect(canCancel('delivering')).toBe(true);
    expect(canCancel('completed')).toBe(false);
    expect(canCancel('cancelled')).toBe(false);
  });

  it('offers preparing after confirmed', () => {
    expect(nextStatusActions('confirmed', 'delivery').map((a) => a.target)).toEqual(['preparing']);
  });

  it('offers ready after preparing', () => {
    expect(nextStatusActions('preparing', 'pickup').map((a) => a.target)).toEqual(['ready']);
  });

  it('delivery order at ready can go to delivering', () => {
    expect(nextStatusActions('ready', 'delivery').map((a) => a.target)).toEqual(['delivering']);
  });

  it('pickup order at ready skips delivering and completes', () => {
    expect(nextStatusActions('ready', 'pickup').map((a) => a.target)).toEqual(['completed']);
  });

  it('delivering completes', () => {
    expect(nextStatusActions('delivering', 'delivery').map((a) => a.target)).toEqual(['completed']);
  });

  it('terminal and pre-confirm states offer no /status actions', () => {
    expect(nextStatusActions('pending', 'delivery')).toEqual([]);
    expect(nextStatusActions('completed', 'delivery')).toEqual([]);
    expect(nextStatusActions('cancelled', 'pickup')).toEqual([]);
  });
});
