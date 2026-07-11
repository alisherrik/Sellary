import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HourlyChart } from '../HourlyChart';

function hours(): number[] {
  const a = Array.from({ length: 24 }, () => 0);
  a[9] = 500;   // inside window
  a[14] = 1000; // inside window
  a[3] = 999;   // OUTSIDE window, must be ignored
  return a;
}

describe('HourlyChart', () => {
  it('renders 15 hour labels 8..22 and hides the outside-window value', () => {
    render(<HourlyChart hourly={hours()} />);
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument(); // hour 3 not rendered
  });
  it('renders nothing when all buckets in-window are zero', () => {
    const { container } = render(<HourlyChart hourly={Array.from({ length: 24 }, () => 0)} />);
    expect(container.firstChild).toBeNull();
  });
});
