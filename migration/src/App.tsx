import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useEstadoCuenta } from './hooks/useAdmin';
import { PortfoliosProvider } from './hooks/usePortfolios';
import { LoginPage } from './pages/LoginPage';
import { PendingApprovalPage } from './pages/PendingApprovalPage';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { PosicionesPage } from './pages/PosicionesPage';
import { AnalisisPage } from './pages/AnalisisPage';
import { BonosPage } from './pages/BonosPage';
import { CedearsPage } from './pages/CedearsPage';
import { AportesPage } from './pages/AportesPage';
import { ConfigPage } from './pages/ConfigPage';
import { ConsolidadoPage } from './pages/ConsolidadoPage';
import { ProyeccionesPage } from './pages/ProyeccionesPage';
import { TasasPage } from './pages/TasasPage';
import { CuponesPage } from './pages/CuponesPage';
import { RadarPage } from './pages/RadarPage';
import { AnalisisHomePage } from './pages/AnalisisHomePage';
import { FinanzasPage } from './pages/FinanzasPage';
import { BrokersPage } from './pages/BrokersPage';
import { MacroPage } from './pages/MacroPage';
import { AdminPage } from './pages/AdminPage';
import { TransferenciasPage } from './pages/TransferenciasPage';

export function App() {
  const { session, loading } = useAuth();
  // Se resuelve server-side (whoami) y es la fuente de la verdad SOLO para decidir qué pantalla
  // mostrar acá — no reemplaza el chequeo real (policy portfolios_insert exige is_approved() en
  // la base), así que aunque este gate se saltee de algún modo, no se puede crear un portfolio.
  const { isAdmin, isApproved, isLoading: chequeandoCuenta, isError: errorCuenta, reintentar } = useEstadoCuenta();

  if (loading) {
    return <div className="h-full grid place-items-center text-ink-600">Cargando…</div>;
  }
  if (!session) return <LoginPage />;
  if (chequeandoCuenta) {
    return <div className="h-full grid place-items-center text-ink-600">Cargando…</div>;
  }
  // Distinto de "no aprobado": un fallo de red/Function acá NO significa que la cuenta esté
  // pendiente — antes caía en el mismo `!isAdmin && !isApproved` de abajo, y un usuario YA aprobado
  // con la red floja (o el primer login en un dispositivo nuevo) veía la pantalla de "esperando
  // aprobación" en vez de un simple "reintentar".
  if (errorCuenta) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <div>
          <p className="text-ink-700 mb-3">No pudimos verificar tu cuenta. Puede ser un problema de red temporal.</p>
          <button onClick={reintentar} className="text-celeste-600 font-semibold hover:underline">Reintentar</button>
        </div>
      </div>
    );
  }
  if (!isAdmin && !isApproved) return <PendingApprovalPage />;

  return (
    <PortfoliosProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="posiciones" element={<PosicionesPage />} />
          <Route path="analisis" element={<AnalisisHomePage />} />
          <Route path="analisis/:ticker" element={<AnalisisPage />} />
          <Route path="bonos" element={<BonosPage />} />
          <Route path="cedears" element={<CedearsPage />} />
          <Route path="tasas" element={<TasasPage />} />
          <Route path="cupones" element={<CuponesPage />} />
          <Route path="radar" element={<RadarPage />} />
          <Route path="finanzas" element={<FinanzasPage />} />
          <Route path="aportes" element={<AportesPage />} />
          <Route path="proyeccion" element={<ProyeccionesPage />} />
          <Route path="brokers" element={<BrokersPage />} />
          <Route path="transferencias" element={<TransferenciasPage />} />
          <Route path="macro" element={<MacroPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="consolidado" element={<ConsolidadoPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </PortfoliosProvider>
  );
}
