import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Search, Sparkles, LineChart } from 'lucide-react';
import { usePortfolios } from '../hooks/usePortfolios';
import { usePosiciones } from '../hooks/usePosiciones';
import { useWatchlist } from '../hooks/useWatchlist';
import { useBonosReferencia } from '../hooks/useBonosReferencia';
import { Card, CardHeader, Button, Field, inputCls } from '../components/ui';

// Landing de Análisis: buscá cualquier empresa (US/SEC) y andá a su DCF completo.
export function AnalisisHomePage() {
  const navigate = useNavigate();
  const { active } = usePortfolios();
  const { data: posiciones = [] } = usePosiciones(active?.id);
  const { data: watch = [] } = useWatchlist();
  const { data: bonosRef = [] } = useBonosReferencia();
  const [ticker, setTicker] = useState('');

  const ir = (t: string) => { const T = t.toUpperCase().trim(); if (T) navigate(`/analisis/${T}`); };

  const tenidos = [...new Set(
    posiciones.filter(p => p.tipo === 'cedear' || p.tipo === 'accion' || p.tipo === 'etf').map(p => p.ticker),
  )];
  const seguidos = watch.map(w => w.ticker).filter(t => !tenidos.includes(t));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ink-900 font-display">Análisis · DCF</h1>

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

      {bonosRef.length > 0 && (
        <Card>
          <CardHeader title="Renta fija" sub="TIR, duración y cronograma en vez de DCF — ver Radar para la tabla comparativa completa." />
          <div className="p-4 flex flex-wrap gap-2">
            {bonosRef.map(b => (
              <Link key={b.ticker} to={`/analisis/bono/${b.ticker}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-semibold text-ink-800 hover:border-celeste-300 hover:text-celeste-700 transition-colors">
                <LineChart className="w-3.5 h-3.5 text-celeste-500" /> {b.ticker}
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
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
