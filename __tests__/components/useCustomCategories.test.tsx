import React from 'react';
import { Text } from 'react-native';
import { render, waitFor, screen, act } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('../../lib/database', () => ({
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
}));

jest.mock('../../lib/customCategories', () => ({
  getCustomCategories: jest.fn(async () => []),
}));

import { useCustomCategories } from '../../lib/useCustomCategories';
import { getCurrentHouseholdId } from '../../lib/database';
import { getCustomCategories } from '../../lib/customCategories';

const mockGetHid = getCurrentHouseholdId as jest.Mock;
const mockGetCustoms = getCustomCategories as jest.Mock;

function Probe() {
  const customs = useCustomCategories();
  return <Text testID="names">{customs.map((c) => c.name).join(',') || 'none'}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetHid.mockReturnValue('hh1');
  mockGetCustoms.mockResolvedValue([]);
});

describe('useCustomCategories', () => {
  it('loads the active household list on focus', async () => {
    mockGetCustoms.mockResolvedValue([{ name: 'Pets', color: '#111' }]);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('names').props.children).toBe('Pets'));
    expect(mockGetCustoms).toHaveBeenCalledWith('hh1');
  });

  it('stays empty when there is no household or the database is not ready', async () => {
    mockGetHid.mockImplementation(() => {
      throw new Error('database not ready');
    });
    render(<Probe />);
    expect(screen.getByTestId('names').props.children).toBe('none');
    expect(mockGetCustoms).not.toHaveBeenCalled();

    mockGetHid.mockReturnValue(null);
    render(<Probe />);
    expect(mockGetCustoms).not.toHaveBeenCalled();
  });

  it('does not apply a late read after the screen loses focus', async () => {
    let resolveList: (value: { name: string; color: string }[]) => void = () => {};
    mockGetCustoms.mockReturnValue(
      new Promise<{ name: string; color: string }[]>((resolve) => {
        resolveList = resolve;
      }),
    );
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId('names').props.children).toBe('none');
    unmount();
    await act(async () => {
      resolveList([{ name: 'Pets', color: '#111' }]);
    });
  });
});
