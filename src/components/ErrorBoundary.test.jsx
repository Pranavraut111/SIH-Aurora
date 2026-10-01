/* ErrorBoundary — one panel crashing must not take the app down. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

function Boom({ message = 'generator panel exploded' }) {
  throw new Error(message);
}

const Fine = () => <p>panel content</p>;

beforeEach(() => {
  // React logs the caught error itself; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(<ErrorBoundary name="Generator"><Fine /></ErrorBoundary>);
    expect(screen.getByText('panel content')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument();
  });

  it('renders the fallback card, named, with the error message', () => {
    render(<ErrorBoundary name="Generator"><Boom /></ErrorBoundary>);
    const card = screen.getByTestId('error-boundary');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('heading', { name: /Generator hit an error/i })).toBeInTheDocument();
    expect(screen.getByText('generator panel exploded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('falls back to a generic name when none is given', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('heading', { name: /This panel hit an error/i })).toBeInTheDocument();
  });

  it('logs the crash instead of swallowing it', () => {
    render(<ErrorBoundary name="Generator"><Boom /></ErrorBoundary>);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[ErrorBoundary] Generator crashed:'),
      expect.any(Error),
      expect.anything(),
    );
  });

  it('re-mounts the child on Retry, showing content once it stops throwing', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('transient');
      return <p>recovered</p>;
    };
    render(<ErrorBoundary name="Generator"><Flaky /></ErrorBoundary>);
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();

    shouldThrow = false;
    act(() => { fireEvent.click(screen.getByRole('button', { name: /retry/i })); });
    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument();
  });

  it('clears the error when resetKey changes (navigating to another panel/station)', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('transient');
      return <p>other panel</p>;
    };
    const { rerender } = render(
      <ErrorBoundary name="Generator" resetKey="maitri"><Flaky /></ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();

    shouldThrow = false;
    rerender(<ErrorBoundary name="Generator" resetKey="bharati"><Flaky /></ErrorBoundary>);
    expect(screen.getByText('other panel')).toBeInTheDocument();
  });
});
