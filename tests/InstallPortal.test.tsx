import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InstallPortal } from '../src/InstallPortal';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mobile(ios = false) { vi.stubGlobal('navigator', { userAgent: ios ? 'iPhone Safari' : 'Android Chrome', platform: ios ? 'iPhone' : 'Linux', maxTouchPoints: 5 }); }
it('shows Safari installation instructions without pretending it supports a prompt', () => {
  mobile(true); render(<InstallPortal />);
  fireEvent.click(screen.getByRole('button', { name: 'Install portal' }));
  expect(screen.getByRole('status').textContent).toContain('Safari. Tap Share, then Add to Home Screen');
});
it('offers Android browser-menu guidance when a native install event is unavailable', () => {
  mobile(); render(<InstallPortal />);
  fireEvent.click(screen.getByRole('button', { name: 'Install portal' }));
  expect(screen.getByRole('status').textContent).toContain('Chrome');
});
it('calls the native installer only on a user click and hides after acceptance', async () => {
  mobile(); render(<InstallPortal />);
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  fireEvent(window, event);
  expect(event.defaultPrevented).toBe(true);
  expect(prompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Install portal' }));
  await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
});
it('hides install promotion when already launched as an iOS web app', () => {
  mobile(true); Object.assign(navigator, { standalone: true }); render(<InstallPortal />);
  expect(screen.queryByRole('button')).toBeNull();
});
