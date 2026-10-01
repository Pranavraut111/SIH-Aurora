/* Operator login: hidden when the server does not protect writes, verifies the token
   before keeping it, and never persists it. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, getToken, setWriteProtected } from '../services/adminToken';
import * as api from '../services/api';
import OperatorLogin from './OperatorLogin';

const TOKEN = 'operator-token';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  clearToken();
  setWriteProtected(null);
});

/** Stub /admin/session: protection on, and only TOKEN is accepted. */
function mockSession({ writeProtected = true } = {}) {
  return vi.spyOn(api, 'apiGet').mockImplementation(async (path, opts) => {
    if (path !== '/admin/session') throw new Error(`unexpected GET ${path}`);
    const sent = opts?.headers?.['X-Admin-Token'];
    return { writeProtected, authenticated: !writeProtected || sent === TOKEN };
  });
}

describe('when the server does not protect writes', () => {
  it('renders nothing, so local development is unchanged', async () => {
    mockSession({ writeProtected: false });
    render(<OperatorLogin />);
    await waitFor(() => expect(screen.queryByTestId('operator-login')).not.toBeInTheDocument());
    expect(screen.queryByTestId('operator-logout')).not.toBeInTheDocument();
  });
});

describe('when writes are protected', () => {
  it('shows a READ-ONLY pill until the operator signs in', async () => {
    mockSession();
    render(<OperatorLogin />);
    const pill = await screen.findByTestId('operator-login');
    expect(pill).toHaveTextContent('READ-ONLY');
  });

  it('accepts the right token, switches to OPERATOR and keeps it in memory only', async () => {
    mockSession();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<OperatorLogin />);

    fireEvent.click(await screen.findByTestId('operator-login'));
    fireEvent.change(screen.getByTestId('operator-token-input'), { target: { value: TOKEN } });
    await act(async () => { fireEvent.click(screen.getByTestId('operator-submit')); });

    expect(await screen.findByTestId('operator-logout')).toHaveTextContent('OPERATOR');
    expect(getToken()).toBe(TOKEN);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('rejects a wrong token with a message and stays logged out', async () => {
    mockSession();
    render(<OperatorLogin />);

    fireEvent.click(await screen.findByTestId('operator-login'));
    fireEvent.change(screen.getByTestId('operator-token-input'), { target: { value: 'nope' } });
    await act(async () => { fireEvent.click(screen.getByTestId('operator-submit')); });

    expect(await screen.findByRole('alert')).toHaveTextContent('Token rejected');
    expect(getToken()).toBeNull();
    expect(screen.queryByTestId('operator-logout')).not.toBeInTheDocument();
  });

  it('reports a clear message when the backend cannot be reached', async () => {
    vi.spyOn(api, 'apiGet').mockRejectedValue(new api.ApiError('boom', { kind: 'network' }));
    setWriteProtected(true);   // already known from an earlier probe
    render(<OperatorLogin />);

    fireEvent.click(await screen.findByTestId('operator-login'));
    fireEvent.change(screen.getByTestId('operator-token-input'), { target: { value: TOKEN } });
    await act(async () => { fireEvent.click(screen.getByTestId('operator-submit')); });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the backend');
    expect(getToken()).toBeNull();
  });

  it('signs out again on click', async () => {
    mockSession();
    render(<OperatorLogin />);
    fireEvent.click(await screen.findByTestId('operator-login'));
    fireEvent.change(screen.getByTestId('operator-token-input'), { target: { value: TOKEN } });
    await act(async () => { fireEvent.click(screen.getByTestId('operator-submit')); });

    await act(async () => { fireEvent.click(await screen.findByTestId('operator-logout')); });
    expect(getToken()).toBeNull();
    expect(await screen.findByTestId('operator-login')).toBeInTheDocument();
  });

  it('does not submit an empty token', async () => {
    mockSession();
    render(<OperatorLogin />);
    fireEvent.click(await screen.findByTestId('operator-login'));
    expect(screen.getByTestId('operator-submit')).toBeDisabled();
  });
});
