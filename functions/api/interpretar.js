// functions/api/interpretar.js
// Cloudflare Pages Function — corre en el servidor, no en el navegador.
// Recibe { desc } desde el frontend, arma el prompt, llama a la API de
// Anthropic con la key guardada como variable de entorno (nunca visible
// para el usuario) y devuelve { text } con la respuesta cruda del modelo.
//
// Configuración necesaria en Cloudflare:
//   Dashboard → Workers & Pages → (tu proyecto) → Settings → Environment variables
//   Agregar: ANTHROPIC_API_KEY = sk-ant-...   (en Production, y también en
//   Preview si querés probarlo en los deploys de PRs/ramas).
//   Después de agregar la variable hay que volver a desplegar (un commit
//   nuevo, o "Retry deployment" no siempre toma env vars nuevas).

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

function withCORS(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}

export async function onRequestOptions() {
  return withCORS(new Response(null, { status: 204 }));
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

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return withCORS(new Response(JSON.stringify({
      error: 'ANTHROPIC_API_KEY no está configurada en las variables de entorno de Cloudflare Pages.',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  try {
    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `El cliente describió: "${desc}"` }],
      }),
    });

    if (!anthropicResp.ok) {
      const detail = await anthropicResp.text();
      return withCORS(new Response(JSON.stringify({ error: 'Error consultando la IA.', detail }), {
        status: anthropicResp.status,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    const data = await anthropicResp.json();
    const text = data.content?.[0]?.text || '';

    return withCORS(new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch (err) {
    return withCORS(new Response(JSON.stringify({ error: 'Error de servidor.', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
}
