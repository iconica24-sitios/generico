import { leerSesion, llaveDeGithub, GITHUB_API, origenDe } from './_cms.js';

// =====================================================================
// Intermediario entre el panel /admin y GitHub
// =====================================================================
// Decap cree que habla con la API de GitHub (config.yml → api_root). En
// realidad habla con esta función, que:
//   - exige una sesión válida del panel (ver _cms.js);
//   - sólo deja pasar llamadas al repo de CMS_REPO: la sesión no sirve
//     para nada más en GitHub;
//   - reenvía con la llave temporal de la GitHub App, que nunca llega
//     al navegador.
// Además contesta por GitHub las dos preguntas que Decap hace al entrar:
// quién es el usuario (/user) y si puede escribir en el repo.
//
// vercel.json manda /api/github/<ruta> aquí como ?ruta=<ruta>.
// =====================================================================
export const config = { api: { bodyParser: false } };

async function cuerpoCrudo(req) {
  const partes = [];
  for await (const p of req) partes.push(typeof p === 'string' ? Buffer.from(p) : p);
  return Buffer.concat(partes);
}

// ¿La ruta es del repo de este sitio y no se sale de él?
// ".." (también codificado) haría que la URL se normalice fuera del repo.
// Una "/" codificada sólo se acepta donde Decap la usa: para listar una
// carpeta (git/trees/main:contenido%2Fpaginas); ahí se revisa ya
// decodificada. (Lo prueba pruebas/unitarias/intermediario.test.mjs.)
export function rutaPermitida(ruta, repo) {
  const propia = `repos/${String(repo || '').toLowerCase()}`;
  const rl = ruta.toLowerCase();
  const arbol = /^repos\/[^/]+\/[^/]+\/git\/trees\/[^/:]+:/i.test(ruta);
  const revisar = arbol ? ruta.replace(/%2f/gi, '/') : ruta;
  const escapa = /(^|[/:])\.\.?(\/|$)|%2e|%5c|\\/i.test(revisar) || /%2f/i.test(revisar);
  return !!repo && !escapa && (rl === propia || rl.startsWith(`${propia}/`));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  let usuario;
  try {
    usuario = leerSesion(req);
  } catch (err) {
    console.error('[github]', err.message);
    return res.status(500).json({ message: 'Panel sin configurar' });
  }
  if (!usuario) return res.status(401).json({ message: 'Sesión vencida. Vuelve a iniciar sesión.' });

  const repo = (process.env.CMS_REPO || '').toLowerCase();
  const url = new URL(req.url, 'http://x');
  const ruta = String(url.searchParams.get('ruta') || '').replace(/^\/+/, '');
  url.searchParams.delete('ruta');

  // Quién es el usuario: el del panel, no una cuenta de GitHub.
  if (ruta === 'user') {
    return res.status(200).json({ login: usuario, name: usuario, avatar_url: '' });
  }

  if (!rutaPermitida(ruta, repo)) return res.status(403).json({ message: 'Ruta no permitida' });
  const propia = `repos/${repo}`;
  const rl = ruta.toLowerCase();

  let llave;
  try {
    llave = await llaveDeGithub();
  } catch (err) {
    console.error('[github]', err.message);
    return res.status(502).json({ message: 'No se pudo conectar con GitHub' });
  }

  const conCuerpo = !['GET', 'HEAD'].includes(req.method);
  const qs = url.searchParams.toString();
  const resp = await fetch(`${GITHUB_API}/${ruta}${qs ? `?${qs}` : ''}`, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${llave}`,
      Accept: req.headers.accept || 'application/vnd.github+json',
      'Content-Type': req.headers['content-type'] || 'application/json',
      'User-Agent': 'iconica24-cms',
    },
    body: conCuerpo ? await cuerpoCrudo(req) : undefined,
  });

  // Las llaves de GitHub App no traen "permissions" al consultar el repo, y
  // Decap lo usa para decidir si deja editar. La App ya limita qué puede
  // hacer; aquí sólo se lo decimos a Decap.
  if (rl === propia && resp.ok) {
    const datos = await resp.json();
    datos.permissions = { admin: false, maintain: false, push: true, triage: false, pull: true };
    return res.status(200).json(datos);
  }

  // La paginación de GitHub apunta a api.github.com: se reescribe para que
  // la siguiente página también pase por aquí.
  const enlace = resp.headers.get('link');
  if (enlace) res.setHeader('Link', enlace.split(`${GITHUB_API}/`).join(`${origenDe(req)}/api/github/`));
  const tipo = resp.headers.get('content-type');
  if (tipo) res.setHeader('Content-Type', tipo);
  res.status(resp.status).send(Buffer.from(await resp.arrayBuffer()));
}
