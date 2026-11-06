import '@fontsource-variable/noto-sans';
import '@fontsource-variable/noto-sans-sinhala';
import '@fontsource-variable/noto-sans-tamil';
import './index.css';
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
