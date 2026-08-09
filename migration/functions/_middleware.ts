// Middleware global: reescribe Access-Control-Allow-Origin en TODA respuesta de /api/*.
//
// Antes, _shared.ts exportaba un CORS estático con "Access-Control-Allow-Origin: *" — cualquier
// sitio podía llamar a estos endpoints desde el navegador de un usuario logueado (ej. con un token
// robado en un XSS de otra página, o simplemente para abusar cuota paga sin límite de origen). No
// es un hueco de CSRF (no hay cookies, la auth va en un header Authorization explícito que un sitio
// de terceros no puede adjuntar automáticamente), pero sí relajaba el origen más de lo necesario.
//
// En vez de tocar los ~25 archivos de Functions que ya arman su respuesta con `json()`/`preflight()`
// (ambos spread-ean el CORS estático de _shared.ts), este middleware corre DESPUÉS de la respuesta
// real y reescribe el header según el Origin del request — reflejándolo solo si matchea el dominio
// de Cloudflare Pages de esta app (producción + previews de rama/PR, que Cloudflare sirve en
// subdominios de *.portfolio-inversiones.pages.dev) o localhost (dev local con `wrangler pages dev`,
// que sirve todo en el mismo origen — este caso no debería ni disparar CORS, pero no cuesta nada
// permitirlo por las dudas de un setup distinto).
const ALLOWED_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?portfolio-inversiones\.pages\.dev$|^https?:\/\/localhost(:\d+)?$/;

export const onRequest: PagesFunction = async (context) => {
  const origin = context.request.headers.get('Origin');
  const response = await context.next();
  const headers = new Headers(response.headers);
  if (origin && ALLOWED_ORIGIN_RE.test(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  } else {
    // Sin match: sacamos el header en vez de dejar el "*" que haya puesto el handler — sin
    // Access-Control-Allow-Origin, el navegador del llamador bloquea la lectura de la respuesta.
    headers.delete('Access-Control-Allow-Origin');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
