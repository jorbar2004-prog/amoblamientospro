// functions/api/interpretar.js
// Cloudflare Pages Function — corre en el servidor, no en el navegador.
// Recibe { desc } desde el frontend, arma el prompt, llama a la API de
// OpenRouter con la key guardada como variable de entorno (nunca visible
// para el usuario) y devuelve { text } con la respuesta cruda del modelo.
//
// Configuración necesaria en Cloudflare:
//   Dashboard → Workers & Pages → (tu proyecto) → Settings → Environment variables
//   Agregar: OPENROUTER_API_KEY = sk-or-...
//   Después de agregar la variable hace falta un deploy NUEVO (un commit,
//   o "Create deployment" manual — "Retry deployment" no siempre la toma).

const SYSTEM_PROMPT = `Sos experto en carpintería y diseño de muebles a medida.
A partir de la descripción en lenguaje natural que te da el cliente, extraé
las medidas y módulos del mueble.

Respondé SOLO con un objeto JSON válido, sin texto adicional, sin markdown,
sin backticks. El formato exacto es:

{"a":cm,"al":cm,"p":cm,"e":cm,"mat":"melamina"|"mdf"|"enchapado"|"madera","estantes":n,"divisiones":n,"nPuertas":n,"tipoPuerta":"abatible"|"corrediza"|"vaiven","altoPuertaPct":n,"overlayPuerta":cm,"nCajones":n,"altoCajon":cm,"colCajones":n,"tipoCajon":"overlay"|"embutido","tipoPata":"ninguno"|"zocalo"|"patas-madera"|"patas-metalicas","altoPata":cm,"nPatas":n,"observaciones":"texto"}

Donde "a" es ancho, "al" es alto, "p" es profundidad, "e" es espesor del
tablero. Valores por defecto si no se especifican: e=1.8, mat=melamina,
tipoPuerta=abatible, altoPuertaPct=100, overlayPuerta=1.5, tipoCajon=overlay,
altoCajon=15, colCajones=1, tipoPata=ninguno, altoPata=10, nPatas=4.
"observaciones" debe tener 1-2 frases cortas con alguna recomendación técnica
relevante para lo que pidió el cliente (ej: pandeo de estantes, refuerzos,
tipo de guía para cajones, etc).`;

// Waterfall: si el primer modelo falla (rate limit, modelo caído, etc.)
// probamos el siguiente. Todos gratuitos en OpenRouter.
const MODELOS = [
  'moonshotai/kimi-k2:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
];

function withCORS(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}

export async function onRequestOptions() {
  return withCORS(new Response(null, { status: 204 }));
}

async function llamarOpenRouter(apiKey, modelo, desc, origin) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': origin || 'https://amoblamientospro.pages.dev',
      'X-Title': 'Diseñador de Muebles PRO',
    },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `El cliente describió: "${desc}"` },
      ],
      max_tokens: 1000,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    const err = new Error(`OpenRouter ${modelo}: ${resp.status}`);
    err.status = resp.status;
    err.detail = detail;
    throw err;
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return withCORS(new Response(JSON.stringify({ error: 'Body inválido, se esperaba JSON.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  const desc = (body && body.desc ? String(body.desc) : '').trim();
  if (!desc) {
    return withCORS(new Response(JSON.stringify({ error: 'Falta "desc" (descripción del mueble).' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return withCORS(new Response(JSON.stringify({
      error: 'OPENROUTER_API_KEY no está configurada en las variables de entorno de Cloudflare Pages.',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  const origin = request.headers.get('Origin');
  let ultimoError = null;

  for (const modelo of MODELOS) {
    try {
      const text = await llamarOpenRouter(apiKey, modelo, desc, origin);
      if (text) {
        return withCORS(new Response(JSON.stringify({ text, modelo }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
    } catch (err) {
      ultimoError = err;
      // sigue con el próximo modelo del waterfall
    }
  }

  return withCORS(new Response(JSON.stringify({
    error: 'No se pudo obtener respuesta de ningún modelo de OpenRouter.',
    detail: ultimoError ? (ultimoError.detail || ultimoError.message) : null,
  }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  }));
}
