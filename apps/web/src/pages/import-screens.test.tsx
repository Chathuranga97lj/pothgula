import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, type Route, user } from '../test/fake-api';
import { renderApp } from '../test/render';

const TOKEN_KEY = 'pothgula.session';
const librarian = user({ id: 2, fullName: 'කමල්', userType: 'admin', branchId: 1 });
const branches = [{ id: 1, code: 'KS', name: 'Kesbewa', logoImageId: null }];

const group = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  title: key,
  writer: null,
  publisher: null,
  isbn: null,
  edition: null,
  categoryCode: 'B1',
  lines: [2],
  oldNumbers: [],
  candidates: [],
  similarKeys: [],
  ...over,
});
const preview = (over: Record<string, unknown> = {}) => ({
  branchId: 1,
  fileName: 'old.csv',
  rows: 4,
  ignoredColumns: ['Shelf'],
  fileErrors: [],
  missingColumns: [],
  errors: [],
  groups: [
    group('isbn:9789550000001', {
      title: 'Gamperaliya',
      lines: [2, 3],
      isbn: '9789550000001',
      candidates: [
        {
          titleId: 40,
          title: 'Gamperaliya',
          writer: 'Martin Wickramasinghe',
          isbn: '9789550000001',
          categoryCode: 'B1',
          copies: 2,
          reason: 'same_isbn',
        },
      ],
    }),
    group('t:kaliyugaya||', { title: 'Kaliyugaya', lines: [4], similarKeys: ['t:kaliyugayaa||'] }),
    group('t:kaliyugayaa||', { title: 'Kaliyugayaa', lines: [5], similarKeys: ['t:kaliyugaya||'] }),
  ],
  ...over,
});

function signedIn(extra: Record<string, Route>) {
  localStorage.setItem(TOKEN_KEY, 'tok');
  return fakeApi({
    'GET /auth/me': { body: { user: librarian, warnings: [] } },
    'GET /library': { body: { name: 'Library', logoImageId: null } },
    'GET /branches': { body: branches },
    ...extra,
  });
}

async function chooseFile() {
  const file = new File(['title,category\nx,B1\n'], 'old.csv', { type: 'text/csv' });
  await userEvent.upload(await screen.findByLabelText('The file'), file);
  await userEvent.click(screen.getByRole('button', { name: 'Check the file' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importing the old catalogue (FR-CAT-13)', () => {
  it('lists the rows to correct and imports nothing', async () => {
    const api = signedIn({
      'POST /imports/preview': {
        body: preview({
          groups: [],
          errors: [
            { line: 3, code: 'unknown_category', value: 'Z9' },
            { line: 7, code: 'bad_price', value: 'cheap' },
          ],
        }),
      },
    });
    renderApp('/catalogue/import');
    await chooseFile();

    expect(await screen.findByText('2 rows need correcting')).toBeInTheDocument();
    expect(screen.getByText('There is no category Z9.')).toBeInTheDocument();
    expect(screen.getByText('cheap is not an amount in rupees.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import/ })).toBeDisabled();
    const sent = api.calls.find((c) => c.route === 'POST /imports/preview')!.body as FormData;
    expect(sent.get('branchId')).toBe('1');
    expect((sent.get('file') as File).name).toBe('old.csv');
  });

  it('explains a file that cannot be read', async () => {
    signedIn({
      'POST /imports/preview': {
        body: preview({ fileErrors: ['missing_column'], missingColumns: ['category'], groups: [] }),
      },
    });
    renderApp('/catalogue/import');
    await chooseFile();
    expect(
      await screen.findByText('The heading row has no column for: category.'),
    ).toBeInTheDocument();
  });

  it('asks for every probable duplicate to be decided, then imports with the decisions', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const api = signedIn({
      'POST /imports/preview': { body: preview() },
      'POST /imports': {
        status: 201,
        body: {
          titlesCreated: 1,
          titlesAddedTo: 1,
          copies: [
            {
              line: 2,
              oldNumber: 'OLD-1',
              accessionNo: 'KS-B1-00002',
              titleId: 40,
              title: 'Gamperaliya',
            },
            {
              line: 3,
              oldNumber: 'OLD-2',
              accessionNo: 'KS-B1-00003',
              titleId: 40,
              title: 'Gamperaliya',
            },
            {
              line: 4,
              oldNumber: 'OLD-3',
              accessionNo: 'KS-B1-00004',
              titleId: 41,
              title: 'Kaliyugaya',
            },
            {
              line: 5,
              oldNumber: 'OLD-4',
              accessionNo: 'KS-B1-00005',
              titleId: 41,
              title: 'Kaliyugaya',
            },
          ],
        },
      },
      'POST /labels': { body: {} },
    });
    renderApp('/catalogue/import');
    await chooseFile();

    expect(await screen.findByText('4 rows, making 3 titles')).toBeInTheDocument();
    expect(screen.getByText('These columns are not used: Shelf.')).toBeInTheDocument();
    const importButton = screen.getByRole('button', { name: 'Import 4 copies' });
    expect(importButton).toBeDisabled();
    expect(screen.getByTestId('decided')).toHaveTextContent('0 of 3 decided');

    const gamp = screen.getByRole('group', { name: /Gamperaliya/ });
    await userEvent.click(within(gamp).getByRole('radio', { name: /More copies of Gamperaliya/ }));
    const typo = screen.getByRole('group', { name: /Kaliyugayaa/ });
    await userEvent.click(within(typo).getByRole('radio', { name: /The same book as Kaliyugaya/ }));
    expect(screen.getByTestId('decided')).toHaveTextContent('2 of 3 decided');
    await userEvent.click(
      screen.getByRole('button', { name: 'The 1 undecided one is a different book' }),
    );
    expect(importButton).toBeEnabled();
    await userEvent.click(importButton);

    expect(await screen.findByText('4 copies imported')).toBeInTheDocument();
    const sent = api.calls.find((c) => c.route === 'POST /imports')!.body as FormData;
    expect(JSON.parse(sent.get('decisions') as string)).toEqual(
      expect.arrayContaining([
        { key: 'isbn:9789550000001', action: 'existing', titleId: 40 },
        { key: 't:kaliyugayaa||', action: 'merge', intoKey: 't:kaliyugaya||' },
        { key: 't:kaliyugaya||', action: 'new' },
      ]),
    );
    expect(screen.getByRole('cell', { name: 'OLD-3' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Print the spine labels' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(api.calls.find((c) => c.route === 'POST /labels')?.body).toEqual({
      accessionNumbers: ['KS-B1-00002', 'KS-B1-00003', 'KS-B1-00004', 'KS-B1-00005'],
    });
  });
});
