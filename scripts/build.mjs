/* =========================================================================
   Build de un sitio GraphicaWeb (kit instalado por la consola)
   -------------------------------------------------------------------------
   Corre SÓLO en Vercel (VERCEL=1). Arma public/, que es lo que se publica:

   1) Copia el sitio a public/, sin api/, scripts/, contenido/ ni archivos
      de configuración.
   2) Si el sitio está preparado para el panel, rellena cada página con su
      contenido: contenido/inicio.json → index.html, contenido/X.json →
      X.html (ver scripts/contenido.mjs).
   3) Si hay panel (admin/config.yml), le deja lo que necesita: los datos
      del sitio (admin/sitio.js), las plantillas para la vista previa y el
      motor que las rellena.
   4) Agrega a cada CSS, JS e imagen una huella de su contenido (?v=…) para
      que vercel.json los guarde en caché un año sin servir versiones viejas.

   Un sitio de HTML normal (sin contenido/ ni admin/) se publica tal cual,
   sólo con el paso 4.

   Plantilla de bloques (si hay una carpeta bloques/): cada página es una
   lista de bloques que el cliente agrega, quita y ordena. Cada bloque vive
   en bloques/<tipo>/ con tres partes:
     bloque.html   su HTML, con claves relativas (".titulo")
     campos.json   sus campos en el panel (un "type" de la lista de Decap)
     estilos.css   sus estilos
   El build junta los estilos en css/bloques.css, pone los campos en
   admin/config.yml (donde dice types: "@bloques") y rellena el
   data-cms-bloques de cada página. contenido/sitio.json (menú, pie, marca)
   es común a todas las páginas: se lee como "sitio.*".

   Páginas nuevas: cada contenido/paginas/<nombre>.json (las crea el cliente
   desde el panel) se publica en /<nombre>/ con el molde de index.html.
   Los enlaces del menú y del pie que apuntan a una página borrada se quitan
   solos (ver enlazar() en scripts/contenido.mjs).
   ========================================================================= */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { aplicarContenido, enlazar, anclasOcultas } from './contenido.mjs';

const ROOT = process.cwd();
const SALIDA = join(ROOT, 'public');

if (process.env.VERCEL !== '1') {
  console.log('[build] Fuera de Vercel (sin VERCEL=1): no se modifica nada. Para probarlo: VERCEL=1 node scripts/build.mjs');
  process.exit(0);
}

// 1) Copia. Lo que no se copia no se publica.
const FUERA = new Set(['api', 'scripts', 'contenido', 'bloques', 'public', 'vercel.json', 'package.json', 'package-lock.json', 'node_modules', 'README.md']);
rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA);
for (const entrada of readdirSync(ROOT)) {
  if (FUERA.has(entrada) || entrada.startsWith('.')) continue;
  cpSync(join(ROOT, entrada), join(SALIDA, entrada), { recursive: true });
}

// 2) Contenido editable.
// Bloques: HTML por tipo, estilos juntos y campos para el panel.
const bloques = {};
const tipos = [];
const dirBloques = join(ROOT, 'bloques');
if (existsSync(dirBloques)) {
  const hay = readdirSync(dirBloques).filter(t => existsSync(join(dirBloques, t, 'bloque.html')));
  // Orden del menú "Agregar bloque": bloques/orden.json, o alfabético.
  const orden = existsSync(join(dirBloques, 'orden.json')) ? JSON.parse(readFileSync(join(dirBloques, 'orden.json'), 'utf8')) : [];
  hay.sort((a, b) => ((orden.indexOf(a) + 1) || 999) - ((orden.indexOf(b) + 1) || 999) || a.localeCompare(b));
  let css = '/* Generado por scripts/build.mjs desde bloques/<tipo>/estilos.css. No se edita aquí. */\n';
  for (const tipo of hay) {
    bloques[tipo] = readFileSync(join(dirBloques, tipo, 'bloque.html'), 'utf8');
    if (existsSync(join(dirBloques, tipo, 'estilos.css'))) css += `\n/* ===== ${tipo} ===== */\n` + readFileSync(join(dirBloques, tipo, 'estilos.css'), 'utf8');
    if (existsSync(join(dirBloques, tipo, 'campos.json'))) {
      const campos = JSON.parse(readFileSync(join(dirBloques, tipo, 'campos.json'), 'utf8'));
      if (campos.name !== tipo) throw new Error(`bloques/${tipo}/campos.json: "name" debe ser "${tipo}"`);
      // Todo bloque se puede apagar sin borrarlo: la casilla va primero y su
      // estado se lee en la lista de bloques ("Precios — … (oculto)").
      if (!(campos.fields || []).some(f => f.name === 'oculto')) {
        campos.fields = [{ label: 'Oculto (no se publica)', name: 'oculto', widget: 'boolean', default: false, required: false,
          hint: 'Apaga el bloque sin borrarlo: no se publica ni se ve en la vista previa, pero su contenido se guarda.' }, ...(campos.fields || [])];
        campos.summary = `${campos.summary || campos.label}{{fields.oculto | ternary(' (oculto)', '')}}`;
      }
      tipos.push(campos);
    }
  }
  mkdirSync(join(SALIDA, 'css'), { recursive: true });
  writeFileSync(join(SALIDA, 'css', 'bloques.css'), css);
  console.log(`[build] bloques: ${hay.join(', ')}`);
}

const paginas = [];
const publicadas = [];   // HTML publicados (para la huella del paso 4)
const dirContenido = join(ROOT, 'contenido');
// Páginas nuevas del cliente. Su nombre es su dirección: no puede chocar con
// carpetas del sitio ni con el panel.
const RESERVADOS = new Set(['admin', 'api', 'css', 'js', 'imagenes', 'images', 'img', 'assets', 'fonts', 'tipografias', 'bloques', 'contenido', 'scripts', 'public', 'index', 'inicio', 'sitio']);
const dirPaginas = join(dirContenido, 'paginas');
const nuevas = existsSync(dirPaginas)
  ? readdirSync(dirPaginas).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(n => {
      const ok = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n) && !RESERVADOS.has(n);
      if (!ok) console.warn(`[build] contenido/paginas/${n}.json: "${n}" no puede ser una dirección, se omite`);
      return ok;
    })
  : [];
// Datos comunes a todas las páginas (menú, pie, marca): "sitio.*", con los
// enlaces ya resueltos contra las páginas que existen.
const datosSitio = existsSync(join(dirContenido, 'sitio.json')) ? JSON.parse(readFileSync(join(dirContenido, 'sitio.json'), 'utf8')) : null;
// Un enlace a una sección de inicio que está apagada se quita mientras lo esté.
const datosInicio = existsSync(join(dirContenido, 'inicio.json')) ? JSON.parse(readFileSync(join(dirContenido, 'inicio.json'), 'utf8')) : null;
const sitioEnlazado = enlazar(datosSitio, nuevas, anclasOcultas(datosInicio));
if (existsSync(dirContenido)) {
  for (const f of readdirSync(dirContenido).filter(f => f.endsWith('.json'))) {
    const nombre = f.slice(0, -5);
    if (nombre === 'sitio') continue;
    const pagina = nombre === 'inicio' ? 'index.html' : `${nombre}.html`;
    if (!existsSync(join(SALIDA, pagina))) { console.warn(`[build] contenido/${f}: no existe ${pagina}, se omite`); continue; }
    // Si el JSON está mal formado el build falla: publicar textos viejos sin avisar sería peor.
    const datos = JSON.parse(readFileSync(join(dirContenido, f), 'utf8'));
    if (datosSitio) datos.sitio = sitioEnlazado;
    const { html, avisos } = aplicarContenido(readFileSync(join(ROOT, pagina), 'utf8'), datos, { bloques });
    writeFileSync(join(SALIDA, pagina), html);
    for (const a of avisos) console.warn(`[build] ${pagina}: ${a}, se deja el texto del HTML`);
    paginas.push({ nombre, pagina });
    console.log(`[build] ${pagina}: contenido aplicado desde contenido/${f}`);
  }
}

// Páginas nuevas: /<nombre>/index.html con el molde de index.html.
if (nuevas.length && existsSync(join(ROOT, 'index.html'))) {
  const molde = readFileSync(join(ROOT, 'index.html'), 'utf8');
  // El menú y el pie son de todo el sitio: sus #ancla son de la página de
  // inicio aunque esta página tenga un bloque con la misma ancla.
  const aInicio = e => (e && /^#[\w-]+$/.test(e.url || '') ? { ...e, url: `/${e.url}` } : e);
  const sitioInterior = sitioEnlazado && {
    ...sitioEnlazado,
    menu: Array.isArray(sitioEnlazado.menu) ? sitioEnlazado.menu.map(aInicio) : sitioEnlazado.menu,
    boton: aInicio(sitioEnlazado.boton),
    pie: sitioEnlazado.pie && { ...sitioEnlazado.pie, enlaces: Array.isArray(sitioEnlazado.pie.enlaces) ? sitioEnlazado.pie.enlaces.map(aInicio) : sitioEnlazado.pie.enlaces },
  };
  for (const nombre of nuevas) {
    const datos = JSON.parse(readFileSync(join(dirPaginas, `${nombre}.json`), 'utf8'));
    if (datosSitio) datos.sitio = sitioInterior;
    // Sin título propio para la pestaña: "Título de la página · Negocio".
    if (!datos.seo || !datos.seo.titulo) {
      datos.seo = { ...(datos.seo || {}), titulo: [datos.titulo, datosSitio && datosSitio.nombre].filter(Boolean).join(' · ') };
    }
    if (datos.seo.descripcion == null) datos.seo.descripcion = '';
    let { html, avisos } = aplicarContenido(molde, datos, { bloques });
    // Está una carpeta más abajo: las rutas relativas (css/…, imagenes/…)
    // pasan a absolutas, y un #ancla que no está en esta página es de la
    // de inicio (/#precios).
    html = html.replace(/(\s(?:src|href|poster)=")(?![a-z][\w+.-]*:|\/|#|")([^"]*")/gi, '$1/$2');
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    html = html.replace(/(\shref=")#([\w-]+)"/g, (todo, antes, id) => (ids.has(id) ? todo : `${antes}/#${id}"`));
    mkdirSync(join(SALIDA, nombre), { recursive: true });
    writeFileSync(join(SALIDA, nombre, 'index.html'), html);
    publicadas.push(`${nombre}/index.html`);
    for (const a of avisos) console.warn(`[build] /${nombre}/: ${a}`);
  }
  console.log(`[build] páginas nuevas: ${nuevas.map(n => '/' + n + '/').join(', ')}`);
}

// Mapa del sitio para Google (Vercel da el dominio de producción). Si el
// sitio trae su propio sitemap.xml, se respeta.
const dominio = process.env.VERCEL_PROJECT_PRODUCTION_URL;
if (existsSync(join(ROOT, 'sitemap.xml'))) {
  if (nuevas.length) console.warn('[build] el sitio trae su propio sitemap.xml: las páginas nuevas no se agregan solas');
} else if (dominio && (paginas.length || nuevas.length)) {
  const urls = ['/', ...nuevas.map(n => `/${n}/`)].map(u => `  <url><loc>https://${dominio}${u}</loc></url>`).join('\n');
  writeFileSync(join(SALIDA, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}

// 3) Panel.
if (existsSync(join(SALIDA, 'admin', 'config.yml'))) {
  for (const { nombre, pagina } of paginas) {
    cpSync(join(ROOT, pagina), join(SALIDA, 'admin', `plantilla-${nombre}.html`));
  }
  cpSync(join(ROOT, 'scripts', 'contenido.mjs'), join(SALIDA, 'admin', 'contenido.js'));
  // La vista previa de una página necesita los datos del sitio (menú, pie) y
  // la de "Sitio" los de las páginas: copia de lo publicado.
  mkdirSync(join(SALIDA, 'admin', 'datos'), { recursive: true });
  if (existsSync(dirContenido)) for (const f of readdirSync(dirContenido).filter(f => f.endsWith(".json"))) cpSync(join(dirContenido, f), join(SALIDA, "admin", "datos", f));
  writeFileSync(join(SALIDA, 'admin', 'datos', 'paginas.json'), JSON.stringify(nuevas));
  if (Object.keys(bloques).length) {
    writeFileSync(join(SALIDA, 'admin', 'bloques.json'), JSON.stringify(bloques));
    const config = join(SALIDA, 'admin', 'config.yml');
    const yml = readFileSync(config, 'utf8');
    const conTipos = yml.replace(/^(\s*)types:\s*["']@bloques["']\s*$/gm, (_, sangria) => `${sangria}types: ${JSON.stringify(tipos)}`);
    if (conTipos === yml) console.warn('[build] admin/config.yml no tiene types: "@bloques": el panel no ofrecerá bloques');
    writeFileSync(config, conTipos);
  }
  const sitio = { repo: process.env.CMS_REPO || '', paginas: paginas.map(p => p.nombre), bloques: Object.keys(bloques).length > 0, sitio: !!datosSitio, estilosVista: existsSync(join(SALIDA, 'admin', 'vista-previa.css')) };
  writeFileSync(join(SALIDA, 'admin', 'sitio.js'), `window.SITIO = ${JSON.stringify(sitio)};\n`);
  console.log(`[build] admin/: panel listo para ${sitio.repo || '(sin CMS_REPO)'} con ${paginas.length} página(s)`);
} else {
  // Sin configuración el panel no tiene nada que editar: no se publica.
  rmSync(join(SALIDA, 'admin'), { recursive: true, force: true });
}

// 4) Huella de contenido en CSS, JS e imágenes locales.
const REF = /\b(href|src)="(\/?)((?:css|js|images|img|imagenes|assets|fonts)\/[^"?#]+|favicon\.(?:svg|ico|png)|apple-touch-icon\.png)"/g;
const huellas = new Map();
function huella(ruta) {
  if (!huellas.has(ruta)) {
    const abs = join(SALIDA, ruta);
    huellas.set(ruta, existsSync(abs) ? createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 10) : null);
  }
  return huellas.get(ruta);
}
for (const pagina of [...readdirSync(SALIDA).filter(f => f.endsWith('.html')), ...publicadas]) {
  const html = readFileSync(join(SALIDA, pagina), 'utf8');
  let n = 0;
  const nuevo = html.replace(REF, (todo, attr, barra, ruta) => {
    const h = huella(ruta);
    if (!h) return todo;
    n++;
    return `${attr}="${barra}${ruta}?v=${h}"`;
  });
  if (n) writeFileSync(join(SALIDA, pagina), nuevo);
}
console.log('[build] listo');
