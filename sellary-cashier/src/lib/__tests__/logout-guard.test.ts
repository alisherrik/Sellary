import { describe, it, expect } from 'vitest';
import { evaluateLogout } from '../logout-guard';

describe('evaluateLogout', () => {
  it('hard-blocks while unsynced sales exist', () => {
    const d = evaluateLogout(3, 0);
    expect(d.action).toBe('blocked');
    if (d.action === 'blocked') expect(d.message).toContain('3');
  });

  it('blocks even when needs-attention is also present', () => {
    expect(evaluateLogout(1, 2).action).toBe('blocked');
  });

  it('asks for confirmation when only permanent failures remain', () => {
    const d = evaluateLogout(0, 2);
    expect(d.action).toBe('confirm');
    if (d.action === 'confirm') expect(d.message).toContain('2');
  });

  it('proceeds when nothing is outstanding', () => {
    expect(evaluateLogout(0, 0).action).toBe('proceed');
  });
});
