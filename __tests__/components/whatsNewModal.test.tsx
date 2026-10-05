import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { I18nProvider } from '../../lib/I18nContext';
import { WhatsNewModal } from '../../components/WhatsNewModal';
import { WHATS_NEW } from '../../lib/whatsNew';

jest.mock('expo-constants', () => ({ expoConfig: { version: '2.0.0' } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import * as SecureStore from 'expo-secure-store';
const store = SecureStore as unknown as Record<string, jest.Mock>;

const mount = () =>
  render(
    <ThemeProvider>
      <I18nProvider>
        <WhatsNewModal />
      </I18nProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  store.getItemAsync.mockReset().mockResolvedValue(null);
  store.setItemAsync.mockClear();
});

describe('WhatsNewModal', () => {
  it('shows once for an unseen version, steps through, and records on finish', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('whats-new-title')).toBeTruthy());
    expect(screen.getByText("What's new in 2.0.0")).toBeTruthy();
    expect(store.setItemAsync).not.toHaveBeenCalled();

    const n = WHATS_NEW['2.0.0'].length;
    for (let i = 0; i < n - 1; i++) fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Got it'));

    await waitFor(() => expect(screen.queryByTestId('whats-new-title')).toBeNull());
    expect(store.setItemAsync).toHaveBeenCalledWith('bs.whatsNew.seenVersion', '2.0.0');
  });

  it('Skip dismisses and records the version', async () => {
    mount();
    await waitFor(() => screen.getByText('Skip'));
    fireEvent.press(screen.getByText('Skip'));
    await waitFor(() => expect(screen.queryByTestId('whats-new-title')).toBeNull());
    expect(store.setItemAsync).toHaveBeenCalledWith('bs.whatsNew.seenVersion', '2.0.0');
  });

  it('does not show when this version was already seen', async () => {
    store.getItemAsync.mockResolvedValue('2.0.0');
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('whats-new-title')).toBeNull();
  });

  it('does not show (and does not throw) when storage fails', async () => {
    store.getItemAsync.mockImplementation(async (key: string) => {
      if (key === 'bs.whatsNew.seenVersion') throw new Error('no storage');
      return null;
    });
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('whats-new-title')).toBeNull();
  });
});
