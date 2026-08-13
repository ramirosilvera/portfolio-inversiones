import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Search, Sparkles, LineChart } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones } from '../hooks/usePosiciones';
import { useWatchlist } from '../hooks/useWatchlist';
import { useBonosReferencia } from '../hooks/useBonosReferencia';
import { Card, CardHeader, Button, Field, Empty, ViewToggle, inputCls } from '../components/ui';

type Vista = 'variable' | 'fija';
const VISTA_KEY = 'analisis_vista';
function vistaInicial(): Vista {
  try { return localStorage.getItem(VISTA_KEY) === 'fija' ? 'fija' : 'variable'; } catch { return 'variable'; }
}

// Landing de Análisis: DCF (Owner Earnings) para acciones/CEDEARs, o TIR/duración/cronograma para
// renta fija — son dos análisis completamente distintos (uno de valuación, otro de flujos de
// deuda), separados con el mismo toggle que Radar en vez de mezclarlos en una sola pantalla.
export function AnalisisHomePage() {
  const [vista, setVista] = useState<Vista>(vistaInicial);
  const cambiarVista = (v: Vista) => {
    setVista(v);
    try { localStorage.setItem(VISTA_KEY, v); } catch { /* localStorage puede fallar en privado/cuota — no es crítico */ }
  };
  const { data: bonosRef = [] } = useBonosReferencia();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-ink-900 font-display">Análisis</h1>
        <ViewToggle value={vista} onChange={cambiarVista}
          options={[{ value: 'variable', label: 'Renta variable' }, { value: 'fija', label: 'Renta fija' }]} />
      </div>
      {vista === 'variable' ? <AnalisisVariable /> : <AnalisisFija bonosRef={bonosRef} />}
    </div>
  );
}

function AnalisisVariable() {
  const navigate = useNavigate();
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const { data: watch = [] } = useWatchlist();
  const [ticker, setTicker] = useState('');

  const ir = (t: string) => { const T = t.toUpperCase().trim(); if (T) navigate(`/analisis/${T}`); };

  const tenidos = [...new Set(
    posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker),
  )];
  const seguidos = watch.map(w => w.ticker).filter(t => !tenidos.includes(t));

  return (
    <>
      <Card>
        <CardHeader title="Analizá una empresa" sub="Valuación por Owner Earnings + ratios + chequeos Munger. Funciona con empresas que reportan a la SEC (EE.UU.)." />
        <form className="p-4 flex flex-wrap gap-2 items-end" onSubmit={e => { e.preventDefault(); ir(ticker); }}>
          <Field label="Ticker" className="flex-1 min-w-[160px]">
            <input autoFocus placeholder="ej. GOOGL, MSFT, KO" value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())} className={inputCls} />
          </Field>
          <div className="flex items-end">
            <Button type="submit"><Search className="w-4 h-4" /> Analizar</Button>
          </div>
        </form>
        <p className="px-4 pb-4 text-[11px] text-ink-600">
          Si la empresa no se reconoce por defecto, cargá su par <b className="text-ink-800">ticker → CIK</b> en Configuración.
        </p>
      </Card>

      {tenidos.length > 0 && (
        <Card>
          <CardHeader title="En tu portfolio" sub={`Accesos rápidos · ${active?.nombre ?? ''}`} />
          <div className="p-4 flex flex-wrap gap-2">
            {tenidos.map(t => <QuickLink key={t} ticker={t} onClick={() => ir(t)} />)}
          </div>
        </Card>
      )}

      {seguidos.length > 0 && (
        <Card>
          <CardHeader title="En tu radar" />
          <div className="p-4 flex flex-wrap gap-2">
            {seguidos.map(t => <QuickLink key={t} ticker={t} onClick={() => ir(t)} />)}
          </div>
        </Card>
      )}
    </>
  );
}

function AnalisisFija({ bonosRef }: { bonosRef: { ticker: string; emisor: string | null; nombre: string | null }[] }) {
  const [busqueda, setBusqueda] = useState('');
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    if (!q) return bonosRef;
    return bonosRef.filter(b => b.ticker.includes(q) || (b.emisor?.toUpperCase().includes(q)) || (b.nombre?.toUpperCase().includes(q)));
  }, [bonosRef, busqueda]);

  return (
    <>
      <Card>
        <CardHeader title="Buscar un bono u ON" sub="TIR, duración y cronograma de flujos — no hay DCF acá (Owner Earnings no aplica a renta fija). Para comparar varios a la vez, ver Radar." />
        <div className="p-4">
          <Field label="Ticker o emisor">
            <div className="relative">
              <Search className="w-4 h-4 text-ink-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input autoFocus placeholder="ej. AL30D, YPF" value={busqueda} onChange={e => setBusqueda(e.target.value)} className={`${inputCls} pl-9`} />
            </div>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Catálogo de referencia"
          sub={`${filtrados.length} de ${bonosRef.length} instrumentos`}
          right={<Link to="/radar" className="text-xs font-semibold text-celeste-600 hover:underline whitespace-nowrap">Ver curva y comparativa →</Link>} />
        {filtrados.length > 0 ? (
          <div className="p-4 flex flex-wrap gap-2 max-h-96 overflow-y-auto">
            {filtrados.map(b => (
              <Link key={b.ticker} to={`/analisis/bono/${b.ticker}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-semibold text-ink-800 hover:border-celeste-300 hover:text-celeste-700 transition-colors">
                <LineChart className="w-3.5 h-3.5 text-celeste-500 shrink-0" />
                {b.ticker}{b.emisor && <span className="font-normal text-ink-600"> · {b.emisor}</span>}
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-4"><Empty icon={Search} title="Sin resultados">Probá con otro ticker o emisor.</Empty></div>
        )}
      </Card>
    </>
  );
}

function QuickLink({ ticker, onClick }: { ticker: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-semibold text-ink-800 hover:border-celeste-300 hover:text-celeste-700 transition-colors">
      <Sparkles className="w-3.5 h-3.5 text-celeste-500" /> {ticker}
    </button>
  );
}
