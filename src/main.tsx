import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { initDB } from './db';
import { ToastProvider, ConfirmProvider } from './components/ui';

void initDB().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </StrictMode>,
  );
});
