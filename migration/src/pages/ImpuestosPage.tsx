import { Scale, Info, CalendarClock, CheckCircle2 } from 'lucide-react';
import { useImpuestos } from '../hooks/useImpuestos';
import { Card, CardHeader, Stat, Badge, AlertasBanner, Empty, fmtUsd, fmtPct, fmtArsCompact } from '../components/ui';
import { BP_UMBRAL_INFO, BP_UMBRAL_WARN, type NivelBP } from '../engine/impuestos';

const NIVEL_TXT: Record<NivelBP, { label: string; tone: 'pos' | 'gray' | 'warn' | 'neg'; barra: string }> = {
  ok: { label: 'Sin riesgo', tone: 'pos', barra: 'bg-pos' },
  info: { label: 'A mitad de camino', tone: 'gray', barra: 'bg-celeste-500' },
  warn: { label: 'Cerca del mínimo', tone: 'warn', barra: 'bg-warn' },
  neg: { label: 'Supera el mínimo', tone: 'neg', barra: 'bg-neg' },
};

const fecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

export function ImpuestosPage() {
  const t = useImpuestos();
  const { bp, params, patrimonio, ddjj, ganancias } = t;
  const nivel = bp ? NIVEL_TXT[bp.nivel] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Scale className="w-5 h-5 text-accent" />
        <h1 className="text-2xl font-bold text-ink-900 font-display">Impuestos</h1>
        <Badge tone="accent">referencia</Badge>
        <Badge>todos tus portfolios juntos</Badge>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-surface border border-line px-3 py-2 text-[11px] text-ink-600">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          Avisa <b className="text-ink-800">cuándo mirar</b>, no cuánto pagás: la app solo ve el patrimonio y los cobros de tus portfolios, no el resto de tus bienes ni tus ingresos.
          Los números son una referencia para llevarle a tu contador; las normas y los mínimos los fija ARCA cada año.
        </p>
      </div>

      {t.alertas.length > 0
        ? <AlertasBanner alertas={t.alertas} />
        : !t.cargando && bp && (
          <div className="flex items-start gap-2 rounded-xl bg-pos/10 ring-1 ring-inset ring-pos/25 px-3 py-2.5 text-[11px] text-ink-700">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-pos" />
            <p>Sin alertas de impuestos hoy: tu patrimonio en los portfolios está lejos del mínimo no imponible de Bienes Personales y no hay una declaración próxima con dividendos del exterior.</p>
          </div>
        )}

      {t.sinPrecio.length > 0 && (
        <p className="text-[11px] text-warn">Sin cotización para {t.sinPrecio.join(', ')}: se valuaron a costo, el patrimonio puede estar algo desfasado.</p>
      )}

      {/* ── Bienes Personales ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Bienes Personales"
          sub={params ? `Mínimo no imponible del período ${params.anioParams}${params.estimado ? ` (el de ${t.anioActual} se publica en ${t.anioActual + 1}: se actualiza por IPC, así que el real será más alto)` : ''}.` : undefined}
          right={nivel ? <Badge tone={nivel.tone}>{nivel.label}</Badge> : undefined}
        />
        {!bp ? (
          <p className="p-4 text-sm text-ink-600">{t.cargando ? 'Cargando…' : !t.mep ? 'No hay cotización del dólar para convertir a pesos.' : 'No hay mínimo publicado para este año.'}</p>
        ) : (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Patrimonio" value={fmtUsd(patrimonio.total, 0)} hint={`≈ ${fmtArsCompact(bp.patrimonioArs)} al MEP de hoy`} />
              <Stat label="En pesos (MEP)" value={fmtArsCompact(bp.patrimonioArs)} />
              <Stat label="Mínimo no imponible" value={fmtArsCompact(bp.minimoArs)} />
              <Stat label={bp.margenUsd >= 0 ? 'Margen' : 'Excedente'} value={fmtUsd(Math.abs(bp.margenUsd), 0)} hint="En dólares, hasta llegar al mínimo (o lo que lo supera)" />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-ink-600 mb-1">
                <span>{fmtPct(bp.ratio, 1)} del mínimo</span>
                <span>alerta al {Math.round(BP_UMBRAL_WARN * 100)} %</span>
              </div>
              <div className="relative h-2.5 rounded-full bg-canvas overflow-hidden">
                <div className={`h-full rounded-full ${nivel!.barra}`} style={{ width: `${Math.min(100, bp.ratio * 100)}%` }} />
                <span className="absolute inset-y-0 w-px bg-ink-400" style={{ left: `${BP_UMBRAL_INFO * 100}%` }} />
                <span className="absolute inset-y-0 w-px bg-warn" style={{ left: `${BP_UMBRAL_WARN * 100}%` }} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[360px]">
                <thead className="text-[11px] text-ink-600 border-b border-line">
                  <tr><th className="text-left py-2">Portfolio</th><th className="text-right px-3">Valor</th><th className="text-right">% del total</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {t.portfolios.map(p => {
                    const v = t.porPortfolio.get(p.id) ?? 0;
                    return (
                      <tr key={p.id}>
                        <td className="py-2 font-semibold text-ink-900">{p.nombre}</td>
                        <td className="text-right px-3 tnum">{fmtUsd(v, 0)}</td>
                        <td className="text-right tnum">{fmtPct(patrimonio.total > 0 ? v / patrimonio.total : 0, 0)}</td>
                      </tr>
                    );
                  })}
                  <tr className="font-bold"><td className="py-2">Total</td><td className="text-right px-3 tnum">{fmtUsd(patrimonio.total, 0)}</td><td /></tr>
                </tbody>
              </table>
            </div>

            <ul className="text-[11px] text-ink-600 space-y-1 list-disc pl-4">
              <li>Las alertas usan el <b className="text-ink-800">total</b> (incluye liquidez y bonos), así que no dependen de ninguna exención.</li>
              {patrimonio.bonos > 0 && (
                <li>
                  Bonos y ONs: {fmtUsd(patrimonio.bonos, 0)}. En general están exentos de Bienes Personales; sin ellos el patrimonio gravable probable sería {fmtUsd(patrimonio.probable, 0)} ({fmtPct(t.bpProbable?.ratio ?? 0, 1)} del mínimo). Hipótesis a confirmar con tu contador.
                </li>
              )}
              {patrimonio.accionesLocales > 0 && <li>Acciones argentinas: {fmtUsd(patrimonio.accionesLocales, 0)}. Tributan a través de la sociedad (responsable sustituto), no en tu declaración.</li>}
              <li>El impuesto se mide al <b className="text-ink-800">31/12</b>: ARCA valúa con la cotización de ese día y el dólar BNA, no con el MEP de hoy. Es una aproximación.</li>
              <li>Cuenta TODO tu patrimonio (casa, auto, cuentas fuera de la app). Acá solo ves lo que cargaste.</li>
            </ul>
          </div>
        )}
      </Card>

      {/* ── Ganancias ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Ganancias — dividendos del exterior" sub="Lo que cobraste de CEDEARs/ETFs, por año. Es renta de fuente extranjera y se declara." />
        {ganancias.length === 0 ? (
          <Empty icon={Scale} title="Sin cobros registrados">Cuando confirmes dividendos en Cobros, aparecen acá por año.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="text-[11px] text-ink-600 border-b border-line">
                <tr>
                  <th className="text-left px-4 py-2">Año</th><th className="text-right px-3">Dividendos brutos</th>
                  <th className="text-right px-3">Retención EE.UU.</th><th className="text-right px-3">Acreditado</th>
                  <th className="text-right px-3">Cobros</th><th className="text-right px-4">Cupones ON</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ganancias.map(g => (
                  <tr key={g.anio}>
                    <td className="px-4 py-2 font-semibold text-ink-900">{g.anio}</td>
                    <td className="text-right px-3 tnum" title={g.sinDetalle > 0 ? `${g.sinDetalle} cobro(s) sin bruto cargado: se muestra el monto declarado` : undefined}>
                      {fmtUsd(g.dividendosBruto)}{g.sinDetalle > 0 && <span className="text-warn"> *</span>}
                    </td>
                    <td className="text-right px-3 tnum">{g.retencionExterior > 0 ? fmtUsd(g.retencionExterior) : '—'}</td>
                    <td className="text-right px-3 tnum">{fmtUsd(g.dividendosNeto)}</td>
                    <td className="text-right px-3 tnum">{g.cobros}</td>
                    <td className="text-right px-4 tnum text-ink-600">{g.intereses > 0 ? fmtUsd(g.intereses) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ul className="px-4 pb-4 pt-2 text-[11px] text-ink-600 space-y-1 list-disc pl-8">
          <li><b className="text-ink-800">Compraventa de CEDEARs</b>: según la mayoría de las fuentes está exenta para personas humanas, por eso la app no descuenta impuesto por vender. Pendiente de confirmar con tu contador.</li>
          <li><b className="text-ink-800">Dividendos</b>: se declaran como renta del exterior. La alícuota (escala progresiva vs. 15 %) y cómo se computa como crédito la retención del 30 % de EE.UU. figuran con criterios distintos: a definir con tu contador.</li>
          <li><b className="text-ink-800">Cupones de ON y bonos locales</b>: suelen estar exentos para personas humanas; se muestran solo como dato.</li>
          <li>Ganancias es personal: si tenés otros ingresos (sueldo, alquileres), la obligación y el monto dependen del total, que la app no conoce.</li>
          {ganancias.some(g => g.sinDetalle > 0) && <li><span className="text-warn">*</span> Hay cobros sin bruto/retención cargados (anteriores al detalle de costos): ahí el bruto es el monto declarado.</li>}
        </ul>
      </Card>

      {/* ── Calendario ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Próxima declaración jurada" />
        <div className="p-4 flex items-start gap-3">
          <CalendarClock className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <div className="text-sm text-ink-700 space-y-1">
            <p>
              <b className="text-ink-900">Período {ddjj.anioFiscal}</b>: Ganancias y Bienes Personales {ddjj.estimado ? 'hacia ' : 'vencen el '}
              <b className="text-ink-900">{fecha(ddjj.fecha)}</b> <span className="text-ink-600">(en {ddjj.dias} días)</span>.
            </p>
            <p className="text-[11px] text-ink-600">
              {ddjj.estimado
                ? 'Fecha estimada con el calendario habitual (fines de junio); ARCA la confirma durante el año y suele prorrogarla.'
                : `Fecha publicada por ARCA: ${ddjj.fuente}.`}
            </p>
          </div>
        </div>
      </Card>

      <details className="rounded-2xl border border-line bg-surface p-4 text-[12px] text-ink-700">
        <summary className="cursor-pointer font-semibold text-ink-900">Qué conviene confirmar con tu contador y de dónde salen los datos</summary>
        <ol className="list-decimal pl-5 mt-3 space-y-1">
          <li>Exención de la compraventa de CEDEARs en tu caso (una fuente la ve gravada al 15 %).</li>
          <li>Alícuota de los dividendos del exterior y mecánica del crédito por el 30 % retenido en EE.UU. (no hay convenio con Argentina).</li>
          <li>Si los CEDEARs integran el patrimonio de Bienes Personales (la mayoría dice que sí; un dictamen de ARCA de 2024 parece decir lo contrario).</li>
          <li>Tratamiento de bonos y ONs en Bienes Personales.</li>
        </ol>
        <p className="mt-3 text-ink-600">Mínimo no imponible 2025 y vencimiento: {params?.fuente ?? 'ARCA'}; RG 5851/2026. Fuentes consultadas:</p>
        <ul className="mt-1 space-y-0.5">
          {[
            ['ARCA — prórroga de vencimientos 2025', 'https://servicioscf.afip.gob.ar/publico/sitio/contenido/novedad/ver.aspx?id=5738'],
            ['Infobae — impuestos al invertir', 'https://www.infobae.com/economia/2025/10/14/impuestos-a-la-hora-de-invertir-que-hay-que-pagarle-a-arca-por-tener-acciones-bonos-depositos-y-otras-colocaciones/'],
            ['iProUP — Ganancias y Bienes Personales por CEDEAR', 'https://www.iproup.com/finanzas/50125-cedear-que-impuestos-tengo-que-pagar'],
            ['RePro — cómo tributan CEDEARs y ADRs', 'https://reprodigital.com.ar/nota/953/ganancias_y_bienes_personales_como_tributan_los_cedears_y_los_adrs'],
            ['Tributum — tablas DDJJ 2025', 'https://tributum.news/wp-content/uploads/2026/04/TRIBUTUM_Tablas_Frecuentes_DDJJ2025_20_ABRIL_2026.pdf'],
          ].map(([txt, href]) => (
            <li key={href}><a href={href} target="_blank" rel="noreferrer" className="text-celeste-600 hover:underline">{txt}</a></li>
          ))}
        </ul>
      </details>
    </div>
  );
}
