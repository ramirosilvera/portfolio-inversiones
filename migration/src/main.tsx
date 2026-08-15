import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import './index.css';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: WEEK, // conservar en memoria una semana para poder persistir entre días
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Persistencia en localStorage: al volver a abrir la app, los últimos datos (precios,
// fundamentos, macro, posiciones, watchlist) aparecen al instante y se revalidan en segundo
// plano. Así no hay que esperar a que recarguen entre sesiones.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'portafolio-rq-cache',
});

// buster = commit del build actual: si cambió desde el último deploy, react-query descarta TODA
// la caché persistida en vez de reutilizarla. Sin esto, un cambio de backend que altera qué trae
// una query (p. ej. el histórico de precio pasando de 5 a 10 años) queda invisible para cualquiera
// que ya tuviera esa query persistida — seguiría viendo el dato viejo hasta que venciera su
// staleTime (hasta 24h para precios/fundamentals), sin que el fix recién deployado se notara.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: WEEK, buster: __GIT_COMMIT__ }}
    >
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
