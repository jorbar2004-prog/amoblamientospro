// functions/api/interpretar.js
// Cloudflare Pages Function — corre en el servidor, no en el navegador.
// Recibe { desc } desde el frontend, arma el prompt, llama a la API de
// OpenRouter con la key guardada como variable de entorno (nunca visible
// para el usuario) y devuelve { text } con la respuesta cruda del modelo.
//
// Configuración necesaria en Cloudflare:
//   Dashboard → Workers & Pages → (tu proyecto) → Settings → Environment variables
//   Agregar: OPENROUTER_API_KEY = sk-or-...
//   Después de agregar/editar la variable hace falta un deploy NUEVO.

const SYSTEM_PROMPT = `Sos experto en carpintería y diseño de muebles a medida.
A partir de la descripción en lenguaje natural que te da el cliente, extraé
las medidas y módulos del mueble.

Respondé SOLO con un objeto JSON válido, sin texto adicional, sin markdown,
sin backticks. El formato exacto es:

{"a":cm,"al":cm,"p":cm,"e":cm,"mat":"melamina"|"mdf"|"enchapado"|"madera","estantes":n,"divisiones":n,"alinearDivPuertas":true|false,"nPuertas":n,"tipoPuerta":"abatible"|"corrediza"|"vaiven","altoPuertaPct":n,"overlayPuerta":cm,"nCajones":n,"altoCajon":cm,"colCajones":n,"tipoCajon":"overlay"|"embutido","tipoPata":"ninguno"|"zocalo"|"patas-madera"|"patas-metalicas","altoPata":cm,"nPatas":n,"tipoEnsamble":"flanquean"|"apoyan","observaciones":"texto"}

Donde "a" es ancho, "al" es alto, "p" es profundidad, "e" es espesor del
tablero. Valores por defecto si no se especifican: e=1.8, mat=melamina,
tipoPuerta=abatible, altoPuertaPct=100, overlayPuerta=1.5, tipoCajon=overlay,
altoCajon=15, colCajones=1, tipoPata=ninguno, altoPata=10, nPatas=4,
alinearDivPuertas=false, tipoEnsamble=flanquean.

IMPORTANTE sobre "al": es la altura TOTAL del mueble, patas/zócalo incluidos
(el motor de cálculo resta altoPata para sacar la altura del cuerpo). Si el
cliente da la altura del cuerpo por separado de la altura de las patas o el
zócalo (ej: "80 cm de altura más 10 cm de patas"), SUMÁ ambos valores para
"al" (en ese ejemplo al=90, altoPata=10) — nunca pongas solo la altura del
cuerpo en "al".

"alinearDivPuertas": poné true cuando el cliente pida que una o más
divisiones verticales coincidan con el borde de una puerta (en vez del
reparto parejo por defecto). Solo funciona si hay al menos "divisiones"
bordes de puerta disponibles (nPuertas-1 bordes en total) — si el pedido no
es viable con esa condición, igual poné alinearDivPuertas=true (el motor
avisa solo si no alcanza) en vez de forzar más puertas de las pedidas.

"tipoEnsamble": "apoyan" cuando el cliente pida explícitamente que los
laterales se apoyen/paren sobre la base (la base va de punta a punta y los
laterales quedan más cortos, arriba de ella). "flanquean" (default) es el
caso normal: la base encajada entre los laterales, que van de piso a techo
del cuerpo.

LIMITACIONES DEL FORMATO: fuera de los dos casos de arriba (alineación de
divisiones y tipo de ensamble, que SÍ tienen campo propio), este JSON no
puede representar otros detalles de posicionamiento o ensamblaje custom
(ej: tipo de unión específica, refuerzos puntuales no estándar, etc). Cuando
el pedido del cliente incluya algo así que ningún campo pueda capturar, NO
lo ignores: completá los campos numéricos lo mejor posible con el resto del
pedido, y agregá esa parte tal cual (o resumida) en "observaciones" como
nota manual para el fabricante, aclarando que el dibujo/lista de corte no la
refleja automáticamente.

"observaciones" debe tener 1-3 frases cortas: primero cualquier nota manual
de las mencionadas arriba si aplica, después alguna recomendación técnica
relevante (ej: pandeo de estantes, refuerzos, tipo de guía para cajones).`;

// "openrouter/free" es el auto-router gratuito de OpenRouter: elige solo
// un modelo gratuito disponible en ese momento, así no dependemos de
// nombres de modelo puntuales que OpenRouter rota/discontinúa seguido.
// Como respaldo dejamos un par de IDs fijos conocidos por si el auto-router
// fallara por algún motivo puntual.
const MODELOS = [
  'openrouter/free',
  'meta-llama/llama-4-scout:free',
  'meta-llama/llama-3.3-70b-instruct:free',
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

  const raw = await resp.text();
  if (!resp.ok) {
    const err = new Error(`${modelo}: HTTP ${resp.status}`);
    err.status = resp.status;
    err.detail = raw;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const err = new Error(`${modelo}: respuesta no-JSON`);
    err.detail = raw.slice(0, 300);
    throw err;
  }

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
  const intentos = [];

  for (const modelo of MODELOS) {
    try {
      const text = await llamarOpenRouter(apiKey, modelo, desc, origin);
      if (text) {
        return withCORS(new Response(JSON.stringify({ text, modelo }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      intentos.push({ modelo, error: 'respuesta vacía' });
    } catch (err) {
      intentos.push({ modelo, status: err.status || null, detail: err.detail || err.message });
    }
  }

  // Ninguno funcionó: devolvemos el detalle de CADA intento para poder
  // diagnosticar exactamente qué pasó con cada modelo.
  return withCORS(new Response(JSON.stringify({
    error: 'No se pudo obtener respuesta de ningún modelo de OpenRouter.',
    intentos,
  }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  }));
}
