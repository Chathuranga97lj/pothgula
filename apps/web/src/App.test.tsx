import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App shell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the library date reported by the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'ok',
          version: 'test',
          time: '2026-11-06T19:00:00.000Z',
          libraryDate: '2026-11-07',
        }),
      ),
    );
    render(<App />);
    expect(await screen.findByText(/Library date: 2026-11-07/)).toBeInTheDocument();
  });

  it('says so when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    render(<App />);
    expect(await screen.findByText('The server cannot be reached.')).toBeInTheDocument();
  });
});
