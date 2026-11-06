import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
import { createQueryClient, Providers } from '../providers';

/** The whole app at a given address, with a fresh cache. */
export function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers client={createQueryClient()}>
        <App />
      </Providers>
    </MemoryRouter>,
  );
}
