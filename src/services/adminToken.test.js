/* The operator token store: memory only, and never a storage API. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canWrite,
  clearToken,
  getToken,
  getWriteProtection,
  isLoggedIn,
  isWriteProtected,
  setToken,
  setWriteProtected,
  subscribe,
} from './adminToken';

afterEach(() => {
  clearToken();
  setWriteProtected(null);
});

describe('token storage', () => {
  it('starts empty and holds a token in memory', () => {
    expect(getToken()).toBeNull();
    expect(isLoggedIn()).toBe(false);
    setToken('abc');
    expect(getToken()).toBe('abc');
    expect(isLoggedIn()).toBe(true);
  });

  it('never touches localStorage or sessionStorage', () => {
    // Both share Storage.prototype in jsdom, and the methods live there, not on the
    // instance — so this one spy covers either API.
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    setToken('must-not-be-persisted');
    expect(getToken()).toBe('must-not-be-persisted');
    clearToken();
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('treats an empty value as logged out', () => {
    setToken('abc');
    setToken('');
    expect(getToken()).toBeNull();
  });
});

describe('subscribers', () => {
  it('fires on login, logout and protection changes, but not on no-ops', () => {
    const fn = vi.fn();
    const unsubscribe = subscribe(fn);

    setToken('abc');
    expect(fn).toHaveBeenCalledTimes(1);
    setToken('abc');                    // unchanged
    expect(fn).toHaveBeenCalledTimes(1);
    setWriteProtected(true);
    expect(fn).toHaveBeenCalledTimes(2);
    setWriteProtected(true);            // unchanged
    expect(fn).toHaveBeenCalledTimes(2);
    clearToken();
    expect(fn).toHaveBeenCalledTimes(3);
    clearToken();                       // already logged out
    expect(fn).toHaveBeenCalledTimes(3);

    unsubscribe();
    setToken('def');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('one throwing subscriber does not stop the others', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    const stop1 = subscribe(() => { throw new Error('boom'); });
    const stop2 = subscribe(good);
    setToken('abc');
    expect(good).toHaveBeenCalled();
    stop1(); stop2();
  });
});

describe('canWrite', () => {
  it('allows writes while protection is unknown, so a failed probe locks nobody out', () => {
    expect(getWriteProtection()).toBeNull();
    expect(canWrite()).toBe(true);
  });

  it('allows writes when the server does not protect them', () => {
    setWriteProtected(false);
    expect(isWriteProtected()).toBe(false);
    expect(canWrite()).toBe(true);
  });

  it('blocks writes when protection is on and no token is held', () => {
    setWriteProtected(true);
    expect(canWrite()).toBe(false);
    setToken('abc');
    expect(canWrite()).toBe(true);
    clearToken();
    expect(canWrite()).toBe(false);
  });
});
