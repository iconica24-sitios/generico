/* =========================================================================
   Vista previa del panel (botón del ojo en /admin)
   -------------------------------------------------------------------------
   Muestra la página real mientras se edita: toma la plantilla (index.html
   con sus marcadores data-cms) y la rellena con lo que hay en el formulario,
   con el mismo motor que usa el build. Lo que se ve aquí es lo que se
   publica.

   Además liga formulario y vista previa en los dos sentidos:
     - el campo que se está editando se resalta en la página;
     - un clic en un elemento de la página abre y enfoca su campo.
   El motor marca cada elemento con data-ruta="hero.titulo"; del lado del
   formulario la ruta se lee de los id que pone Decap (hero-field-6 →
   titulo-field-7) y de la posición de cada elemento en las listas.

   El build (scripts/build.mjs) copia las plantillas y el motor a /admin/.

   Plantilla de bloques: además carga el HTML de cada bloque
   (admin/bloques.json) y los datos publicados (admin/datos/*.json). Una
   página se ve con el menú y pie guardados; "Sitio" (menú, marca, pie) se
   ve sobre la página de inicio guardada, y sus rutas llevan "sitio.".
   Un bloque apagado ("Oculto") no se ve, igual que en el sitio; en el
   formulario sigue completo.
   ========================================================================= */
const { aplicarContenido, enlazar = x => x } = await import('/admin/contenido.js');

// Una plantilla por página editable (inicio → index.html, etc.). El build
// las copia a /admin/plantilla-<nombre>.html y lista los nombres en sitio.js.
const plantillas = {};
function html(nombre) {
  plantillas[nombre] ??= fetch(`/admin/plantilla-${nombre}.html`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
  return plantillas[nombre];
}
function plantilla(nombre) {
  return html(nombre).then(texto => {
    const cuerpo = texto.slice(texto.indexOf('>', texto.indexOf('<body')) + 1, texto.lastIndexOf('</body>'));
    // Los scripts no corren en la vista previa; se quitan para no ensuciarla.
    return cuerpo.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  });
}
// Idioma del sitio (<html lang="…"> de la plantilla). La vista previa es otro
// documento, sin idioma: sin él, hyphens: auto no parte ninguna palabra y el
// texto se ve con otros cortes y otro número de líneas que en el sitio.
function idioma(nombre) {
  return html(nombre).then(texto => (texto.match(/<html\b[^>]*\slang=["']?([\w-]+)/i) || [])[1] || 'es', () => 'es');
}

// La vista previa vive dentro de /admin/: las rutas relativas del sitio
// (imagenes/foto.jpg) se vuelven absolutas (/imagenes/foto.jpg).
const RELATIVA = /(\s(?:src|href|poster)=")(?![a-z][\w+.-]*:|\/|#|")([^"]*")/gi;
const absoluta = texto => texto.replace(RELATIVA, '$1/$2');

const SITIO = window.SITIO || {};
const bloques = SITIO.bloques ? await fetch('/admin/bloques.json').then(r => r.json()).catch(() => ({})) : {};
const guardados = {};
const guardado = nombre => (guardados[nombre] ??= fetch(`/admin/datos/${nombre}.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({})));

const CMS = window.CMS;
// Los estilos de la vista previa son los de la página misma: sus <link
// rel="stylesheet"> y sus <style>. Un sitio puede agregar ajustes sólo para
// la vista previa en admin/vista-previa.css (p. ej. una cabecera fija que
// en el panel estorba).
const primera = (SITIO.paginas || [])[0];
if (primera) {
  const cabeza = await html(primera).then(t => t.slice(0, t.search(/<body[\s>]/i)), () => '');
  for (const [etiqueta] of cabeza.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel=["']?stylesheet/i.test(etiqueta)) continue;
    const href = (etiqueta.match(/\bhref=["']([^"']+)/i) || [])[1];
    if (href) CMS.registerPreviewStyle(new URL(href, location.origin + '/').href);
  }
  for (const [, css] of cabeza.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    CMS.registerPreviewStyle(css, { raw: true });
  }
}
if (SITIO.estilosVista) CMS.registerPreviewStyle('/admin/vista-previa.css');
// El resaltado no se pinta sobre el elemento (un contorno en un texto de
// varias líneas sale escalonado, y un contenedor con overflow lo recorta):
// es un recuadro aparte, del tamaño total del elemento, encima de todo.
// Sólo borde y halo: un fondo taparía el de botones y bloques oscuros.
CMS.registerPreviewStyle(`
  html, body { overflow-x: clip; }
  [data-ruta] { cursor: pointer; }
  .cms-vista-sitio [data-ruta]:not([data-ruta^="sitio."]), .cms-vista-pagina [data-ruta^="sitio."] { cursor: auto; }
  /* En una página, los enlaces del menú y del pie no se editan pero navegan: manita. */
  .cms-vista-pagina a[href][data-ruta^="sitio."] { cursor: pointer; }
  .cms-marco { position: absolute; z-index: 2147483647; pointer-events: none; box-sizing: border-box;
               border-radius: 6px; transition: top .12s, left .12s, width .12s, height .12s; }
  .cms-marco--activo { border: 2px solid #2f6fed; box-shadow: 0 0 0 4px rgba(47, 111, 237, .2); }
  .cms-marco--encima { border: 2px dashed rgba(47, 111, 237, .6); }
`, { raw: true });

/* ---------- Formulario: de campo a ruta y de ruta a campo ---------- */

const ID_CAMPO = /^(.+)-field-\d+$/;
const esItem = el => /ListItem/.test(el.className || '');
const esNodo = el => ID_CAMPO.test(el.id || '') || esItem(el);
const formulario = () => document.querySelector('[class*="ControlPaneContainer"]');

// Nodo de campo o de lista más cercano por encima de `el` (sin incluirlo).
function nodoPadre(el, tope) {
  for (let p = el.parentElement; p && p !== tope; p = p.parentElement) if (esNodo(p)) return p;
  return null;
}

function rutaDeCampo(el) {
  const raiz = formulario();
  const partes = [];
  for (let n = el; n && n !== raiz; n = n.parentElement) {
    if (ID_CAMPO.test(n.id || '')) partes.unshift(n.id.match(ID_CAMPO)[1]);
    else if (esItem(n)) partes.unshift(String([...n.parentElement.children].filter(esItem).indexOf(n)));
  }
  return partes;
}

// Ruta en el JSON: en listas de textos sueltos (Qué incluye) Decap nombra al
// campo interno ("punto"), pero en el JSON el elemento es el texto mismo.
function normalizar(partes, datos) {
  let v = datos;
  for (let i = 0; i < partes.length; i++) {
    if (v == null || typeof v !== 'object') return partes.slice(0, i).join('.');
    v = v[partes[i]];
  }
  return v === undefined ? partes.slice(0, -1).join('.') : partes.join('.');
}

// Hijos directos (en términos de campos) de un nodo del formulario.
function hijos(nodo, raiz) {
  return [...nodo.querySelectorAll('[id*="-field-"], [class*="ListItem"]')]
    .filter(el => esNodo(el) && (nodoPadre(el, raiz) || raiz) === nodo);
}

function abrir(nodo, raiz) {
  const boton = [...nodo.querySelectorAll('button[data-testid="expand-button"]')]
    .find(b => nodoPadre(b, raiz) === nodo);
  if (boton && boton.getAttribute('aria-label') === 'Expand') boton.click();
}

// Rutas de la vista previa → rutas del formulario abierto. En "Sitio" el
// formulario es sitio.json (las rutas de la página llevan "sitio."); en una
// página, lo de "sitio." no está en este formulario.
// El prefijo es el de la vista previa abierta (cada una lo deja en su
// documento): Decap puede volver a pintar la de otra entrada un momento.
const prefijoActual = () => (docVista && docVista.__prefijo) || '';
// ¿Se edita en el formulario abierto? (En una página, el menú y el pie no;
// en "Sitio", los bloques de la página no.)
const editableAqui = ruta => {
  const prefijo = prefijoActual();
  return prefijo ? ruta.startsWith(prefijo) : !(SITIO.sitio && ruta.startsWith('sitio.'));
};
// Elemento editable (en este formulario) más cercano.
const editableDe = el => {
  // Un campo de formulario sin ruta propia (sin texto de ayuda editable) va a
  // la de su etiqueta, no a la del bloque.
  const campo = el && el.closest && el.closest('input, textarea, select');
  if (campo && !campo.hasAttribute('data-ruta')) {
    const etiqueta = campo.closest('label');
    const deEtiqueta = etiqueta && etiqueta.querySelector('[data-ruta]');
    if (deEtiqueta) el = deEtiqueta;
  }
  const e = el && el.closest('[data-ruta]');
  return e && editableAqui(e.getAttribute('data-ruta')) ? e : null;
};
const cuadro = () => new Promise(r => requestAnimationFrame(r));
// Espera (cuadro a cuadro, hasta ~`max` cuadros) a que `fn` devuelva algo:
// Decap pinta los campos de un elemento que se despliega un poco después.
async function esperarA(fn, max = 30) {
  for (let i = 0; i < max; i++) {
    const v = fn();
    if (v) return v;
    await cuadro();
  }
  return null;
}

// Contenedor que se desplaza (el formulario de Decap).
function cajaDe(el) {
  for (let c = el.parentElement; c; c = c.parentElement) {
    if (c.scrollHeight > c.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(c).overflowY)) return c;
  }
  return null;
}

function aLaVista(el) {
  const caja = cajaDe(el);
  const r = el.getBoundingClientRect();
  const c = caja ? caja.getBoundingClientRect() : { top: 0, bottom: innerHeight };
  return r.top >= c.top && r.bottom <= c.bottom;
}

// Cada clic en la vista previa es un viaje; uno nuevo deja sin efecto al
// anterior (si se hace clic rápido en varios elementos, gana el último).
let viaje = 0;

async function irACampo(ruta) {
  const raiz = formulario();
  if (!raiz) return;
  const prefijo = prefijoActual();
  if (prefijo) {
    if (!ruta.startsWith(prefijo)) return;
    ruta = ruta.slice(prefijo.length);
  } else if (ruta.startsWith('sitio.') && SITIO.sitio) return;
  const este = ++viaje;
  const vigente = () => este === viaje;
  let nodo = raiz;
  for (const parte of ruta.split('.')) {
    abrir(nodo, raiz);
    const actual = nodo;
    const siguiente = await esperarA(() => {
      const candidatos = hijos(actual, raiz);
      return /^\d+$/.test(parte)
        ? candidatos.filter(esItem)[Number(parte)]
        : candidatos.find(el => (el.id.match(ID_CAMPO) || [])[1] === parte);
    }, 20);
    if (!vigente()) return;
    if (!siguiente) break;
    nodo = siguiente;
  }
  abrir(nodo, raiz);
  const destino = nodo;
  const control = (destino.matches('input, textarea') ? destino : await esperarA(
    () => destino.querySelector('input, textarea, [contenteditable="true"]'), 10)) || null;
  if (!vigente()) return;
  const el = control || destino;
  // Al desplegarse, los campos (sobre todo los de texto con formato) cambian
  // de alto unos cuadros más: se espera a que el campo deje de moverse antes
  // de desplazar el formulario, o el desplazamiento apunta a donde estaba.
  let antes = null, quieto = 0;
  for (let i = 0; i < 30 && quieto < 3; i++) {
    const caja = cajaDe(el);
    const y = el.getBoundingClientRect().top + (caja ? caja.scrollTop : scrollY);
    quieto = y === antes ? quieto + 1 : 0;
    antes = y;
    await cuadro();
    if (!vigente()) return;
  }
  if (control) control.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // Si algo se movió durante el desplazamiento (o lo interrumpió), se corrige.
  for (const comportamiento of ['smooth', 'auto']) {
    await new Promise(r => setTimeout(r, 700));
    if (!vigente() || !el.isConnected) return;
    if (!aLaVista(el)) el.scrollIntoView({ block: 'center', behavior: comportamiento });
  }
}

/* ---------- Vista previa: resaltar el campo activo ---------- */

let rutaActiva = null;
let docVista = null;
let bajoMouse = null;
// Menú móvil: la vista previa no corre el JS del sitio, así que la
// hamburguesa lo abre y lo cierra desde aquí. Se recuerda abierto aunque
// la vista se vuelva a dibujar al editar.
let menuMovilAbierto = false;
// Menú compacto: misma medición que js/sitio.js de las plantillas (si las
// opciones no caben en el renglón de la cabecera, hamburguesa también en
// pantalla ancha). Las reglas viven en css/base.css de cada plantilla.
const medirMenu = doc => {
  const cabecera = doc.querySelector('.cabecera');
  const fila = cabecera && cabecera.querySelector('.cabecera__fila');
  if (!fila) return;
  const ver = doc.defaultView;
  cabecera.classList.remove('menu-compacto');
  if (ver.matchMedia('(max-width: 767px)').matches) return;
  cabecera.classList.add('menu-midiendo');
  const css = ver.getComputedStyle(fila);
  const hijos = [...fila.children].filter(h => ver.getComputedStyle(h).display !== 'none');
  const usado = hijos.reduce((t, h) => {
    const m = ver.getComputedStyle(h);
    return t + h.getBoundingClientRect().width + parseFloat(m.marginLeft) + parseFloat(m.marginRight);
  }, 0) + (parseFloat(css.columnGap) || 0) * (hijos.length - 1);
  const disponible = fila.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  cabecera.classList.remove('menu-midiendo');
  cabecera.classList.toggle('menu-compacto', usado + 24 > disponible);
};
const aplicarMenuMovil = doc => {
  const cabecera = doc.querySelector('.cabecera');
  if (!cabecera) return;
  cabecera.classList.toggle('is-abierta', menuMovilAbierto);
  cabecera.querySelector('.hamburguesa')?.setAttribute('aria-expanded', String(menuMovilAbierto));
};
const MARGEN = 6;

// Coloca (o esconde) un recuadro sobre el área completa de `el`.
function enmarcar(tipo, el) {
  if (!docVista) return;
  let marco = docVista.querySelector(`.cms-marco--${tipo}`);
  if (!marco) {
    marco = docVista.createElement('div');
    marco.className = `cms-marco cms-marco--${tipo}`;
    marco.setAttribute('aria-hidden', 'true');
    docVista.body.appendChild(marco);
  }
  const r = el && el.isConnected ? el.getBoundingClientRect() : null;
  if (!r || !r.width || !r.height) { marco.hidden = true; return; }
  const win = docVista.defaultView;
  // Sin salirse por los lados: un elemento a todo lo ancho (un título, un
  // bloque) daría un recuadro más ancho que la página, y la vista previa
  // se podría recorrer hacia los lados al arrastrar.
  const ancho = docVista.documentElement.clientWidth;
  const izq = Math.max(r.left - MARGEN, 2), der = Math.min(r.right + MARGEN, ancho - 2);
  marco.style.top = `${r.top + win.scrollY - MARGEN}px`;
  marco.style.left = `${izq + win.scrollX}px`;
  marco.style.width = `${Math.max(der - izq, 0)}px`;
  marco.style.height = `${r.height + MARGEN * 2}px`;
  marco.hidden = false;
}

function reenmarcar() {
  const activo = docVista && docVista.querySelector('.cms-activo');
  enmarcar('activo', activo);
  enmarcar('encima', bajoMouse && bajoMouse !== activo ? bajoMouse : null);
}

function resaltar(desplazar) {
  if (!docVista) return;
  docVista.querySelectorAll('.cms-activo').forEach(el => el.classList.remove('cms-activo'));
  docVista.querySelectorAll('.cms-camino').forEach(el => el.classList.remove('cms-camino'));
  if (!rutaActiva) return reenmarcar();
  // El elemento exacto; si no hay, el más cercano que lo contenga
  // (p. ej. al enfocar una pregunta completa de la lista).
  let objetivo = null;
  for (let r = rutaActiva; r && !objetivo; r = r.includes('.') ? r.slice(0, r.lastIndexOf('.')) : '') {
    objetivo = docVista.querySelector(`[data-ruta="${CSS.escape(r)}"]`);
  }
  if (!objetivo) return reenmarcar();
  // Si el menú móvil está abierto y lo que se edita no está en él, se cierra
  // (como en el sitio al tocar fuera): si no, el resaltado quedaría encima.
  if (menuMovilAbierto && !docVista.querySelector(`.menu-movil [data-ruta="${CSS.escape(objetivo.getAttribute('data-ruta'))}"]`)) {
    menuMovilAbierto = false;
    aplicarMenuMovil(docVista);
  }
  objetivo.classList.add('cms-activo');
  // Los contenedores del elemento llevan .cms-camino: así una plantilla puede
  // dejar abierto (en su admin/vista-previa.css) el submenú o desplegable que
  // lo contiene mientras se edita, aunque el cursor ya no esté encima.
  for (let p = objetivo.parentElement; p && p !== docVista.body; p = p.parentElement) p.classList.add('cms-camino');
  reenmarcar();
  // Si algo se abrió con una transición, el recuadro se recoloca al terminar.
  setTimeout(reenmarcar, 350);
  if (desplazar) objetivo.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

let datosActuales = {};
document.addEventListener('focusin', e => {
  const raiz = formulario();
  if (!raiz || !raiz.contains(e.target)) return;
  const ruta = prefijoActual() + normalizar(rutaDeCampo(e.target), datosActuales);
  if (ruta === rutaActiva) return;
  rutaActiva = ruta;
  resaltar(true);
});

// Como en el formulario: un clic fuera de los campos quita el resaltado.
// (Al pasar de un campo a otro, relatedTarget es el campo nuevo y focusin
// ya se encarga.)
document.addEventListener('focusout', e => {
  const raiz = formulario();
  if (!raiz || !raiz.contains(e.target)) return;
  if (e.relatedTarget && raiz.contains(e.relatedTarget)) return;
  quitarResaltado();
});

function quitarResaltado() {
  if (rutaActiva === null) return;
  rutaActiva = null;
  resaltar(false);
}

/* ---------- Vista previa: el menú navega ----------
   En la vista previa de una página, el menú, el botón de la cabecera y el pie
   no se editan (se editan en «Sitio»): ahí sus enlaces funcionan como en el
   sitio. Un #ancla de la misma página desplaza la vista previa hasta esa
   sección; un enlace a otra página (/nombre o la de inicio) abre esa página en
   el editor y, si lleva #ancla, baja hasta ella al cargarse. Los enlaces
   externos no navegan (no sacan al cliente del editor). */

let anclaPendiente = null;

// Entrada del editor de una dirección del sitio ("/" o "/nombre/").
function entradaDe(ruta) {
  const limpia = ruta.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/';
  if (limpia === '/') return (SITIO.paginas || []).includes('inicio') ? '#/collections/inicio/entries/inicio' : null;
  const nombre = limpia.slice(1);
  return /^[a-z0-9-]+$/.test(nombre) ? `#/collections/paginas/entries/${nombre}` : null;
}

function irAAncla(doc, ancla) {
  if (!ancla || ancla === 'top') { doc.defaultView.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
  const destino = doc.getElementById(ancla);
  if (!destino) return false;
  destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

// Opción activa del menú, como js/sitio.js en el sitio (que aquí no corre):
// la de la página en la que se está y la de la sección visible (#ancla).
const enlacesDelMenu = doc => [...doc.querySelectorAll('.menu a, .menu-movil__lista a')];
function marcarPagina(doc) {
  const ruta = p => p.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/';
  for (const a of enlacesDelMenu(doc)) {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('/') && !href.includes('#') && ruta(href) === ruta(doc.__pagina || '/')) a.setAttribute('aria-current', 'page');
  }
}
function marcarSeccion(doc, activo) {
  for (const a of enlacesDelMenu(doc)) {
    const href = a.getAttribute('href') || '';
    if (a.getAttribute('aria-current') === 'page' || !/^#[\w-]+$/.test(href)) continue;
    if (href === '#' + activo) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
}
function espiar(doc) {
  if (Date.now() < (doc.__bloqueoEspia || 0)) return;
  const ver = doc.defaultView;
  const ids = [...new Set(enlacesDelMenu(doc).map(a => a.getAttribute('href') || '').filter(h => /^#[\w-]+$/.test(h)).map(h => h.slice(1)))].filter(id => doc.getElementById(id));
  let activo = null;
  for (const id of ids) if (doc.getElementById(id).getBoundingClientRect().top <= 140) activo = id;
  const alto = doc.documentElement.scrollHeight;
  if (ids.length && ver.scrollY > 0 && alto > ver.innerHeight + 200 && ver.innerHeight + ver.scrollY >= alto - 4) activo = ids[ids.length - 1];
  marcarSeccion(doc, activo);
}

// Abre otra entrada del editor. Si se está editando una, primero se sale con
// la flecha de regreso de la barra de Decap (vuelve a la lista de la
// colección) y después se abre la otra: cambiando sólo la dirección de una
// entrada a otra, Decap muestra el formulario nuevo pero se queda con la
// vista previa anterior. La flecha es un enlace del propio Decap, así que si
// hay cambios sin guardar pregunta, y si el cliente decide quedarse no se sigue.
async function irA(destino) {
  if (location.hash === destino) return;
  const regreso = document.querySelector('[class*="ToolbarSectionBackLink"]');
  if (regreso && /\/(entries\/[^/]+|new)$/.test(location.hash)) {
    regreso.click();
    const cerrado = await esperarA(() => !document.querySelector('[class*="ToolbarSectionMain"]'), 90);
    if (!cerrado) return;
  }
  location.hash = destino;
}

// true si el clic en el enlace `a` se resolvió navegando.
function navegar(a, doc) {
  const href = a.getAttribute('href') || '';
  if (!href || /^(mailto|tel|javascript):/i.test(href)) return false;
  let u;
  try { u = new URL(href, location.origin + (doc.__pagina || '/')); } catch (e) { return false; }
  if (u.origin !== location.origin) return false;
  const ancla = decodeURIComponent(u.hash.slice(1));
  const misma = (u.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/') === ((doc.__pagina || '/').replace(/\/+$/, '') || '/');
  if (misma) {
    // Se marca de inmediato, sin esperar el desplazamiento (como en el sitio).
    if (ancla) { doc.__bloqueoEspia = Date.now() + 900; marcarSeccion(doc, ancla); setTimeout(() => espiar(doc), 950); }
    return irAAncla(doc, ancla) || true;
  }
  const entrada = entradaDe(u.pathname);
  if (!entrada) return false;
  anclaPendiente = ancla || null;
  irA(entrada);
  return true;
}

/* ---------- Pestañas en la barra del editor ----------
   Junto al botón de publicar: «Contenido» (la página de inicio y, si las hay,
   las páginas nuevas), «Menú y sitio» y «+ Nueva página». Si hay cambios sin
   guardar, Decap pregunta antes de salir, como con su flecha de regreso. */

function pestanas() {
  const conInicio = (SITIO.paginas || []).includes('inicio');
  const lista = [];
  if (conInicio) lista.push({ texto: 'Contenido', destino: '#/collections/inicio/entries/inicio', activa: h => h.startsWith('#/collections/inicio') || /^#\/collections\/paginas\/entries\//.test(h) });
  if (SITIO.sitio) lista.push({ texto: 'Menú y sitio', destino: '#/collections/sitio/entries/sitio', activa: h => h.startsWith('#/collections/sitio') });
  if (SITIO.bloques && conInicio) lista.push({ texto: '+ Nueva página', destino: '#/collections/paginas/new', activa: h => h.startsWith('#/collections/paginas/new') });
  return lista;
}

let paginasNuevas = [];
if (SITIO.bloques) fetch('/admin/datos/paginas.json').then(r => r.json()).then(l => { paginasNuevas = Array.isArray(l) ? l : []; }).catch(() => {});
const tituloDe = nombre => nombre.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

document.head.insertAdjacentHTML('beforeend', `<style>
  .cms-pestanas { display: flex; align-items: center; gap: 4px; margin: 0 12px; flex-wrap: nowrap; white-space: nowrap; }
  .cms-pestanas a, .cms-pestanas summary { display: inline-block; padding: 7px 12px; border-radius: 5px; font-size: 14px; font-weight: 600; color: #313d3e; text-decoration: none; cursor: pointer; list-style: none; }
  .cms-pestanas summary::-webkit-details-marker { display: none; }
  .cms-pestanas a:hover, .cms-pestanas summary:hover { background: #eff0f4; }
  .cms-pestanas .cms-activa, .cms-pestanas .cms-activa > summary { background: #e8f5fe; color: #3a69c7; }
  .cms-pestanas details { position: relative; }
  .cms-pestanas details > div { position: absolute; top: calc(100% + 4px); left: 0; z-index: 400; min-width: 200px; padding: 6px; background: #fff; border-radius: 5px; box-shadow: 0 4px 12px rgba(68, 74, 87, .15), 0 1px 3px rgba(68, 74, 87, .25); }
  .cms-pestanas details > div a { display: block; color: #313d3e; background: none; }
  .cms-pestanas details > div a:hover { background: #eff0f4; }
  @media (max-width: 1100px) { .cms-pestanas a, .cms-pestanas summary { padding: 6px 8px; font-size: 13px; } }
</style>`);

function pintarPestanas() {
  const main = document.querySelector('[class*="ToolbarSectionMain"]');
  const lista = pestanas();
  if (!main || !lista.length) return;
  let nav = main.querySelector('.cms-pestanas');
  const h = location.hash;
  const firma = h + '|' + paginasNuevas.join(',');
  if (nav && nav.dataset.firma === firma) return;
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'cms-pestanas';
    nav.setAttribute('aria-label', 'Secciones del editor');
    const primera = main.querySelector('[class*="ToolbarSubSectionFirst"]');
    primera ? primera.after(nav) : main.prepend(nav);
  }
  nav.dataset.firma = firma;
  nav.innerHTML = '';
  for (const p of lista) {
    if (p.texto === 'Contenido' && paginasNuevas.length) {
      // Con páginas nuevas, «Contenido» despliega la lista de páginas.
      const d = document.createElement('details');
      if (p.activa(h)) d.className = 'cms-activa';
      d.innerHTML = '<summary>Contenido ▾</summary><div></div>';
      const caja = d.querySelector('div');
      const opciones = [['Inicio', p.destino], ...paginasNuevas.map(n => [tituloDe(n), `#/collections/paginas/entries/${n}`]), ['Todas las páginas', '#/collections/paginas']];
      for (const [texto, destino] of opciones) {
        const a = document.createElement('a');
        a.href = destino; a.textContent = texto;
        a.addEventListener('click', () => { d.open = false; });
        caja.append(a);
      }
      nav.append(d);
      continue;
    }
    const a = document.createElement('a');
    a.href = p.destino; a.textContent = p.texto;
    if (p.activa(h)) a.className = 'cms-activa';
    nav.append(a);
  }
}
new MutationObserver(pintarPestanas).observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', e => {
  const a = e.target.closest('.cms-pestanas a[href^="#/"]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  irA(a.getAttribute('href'));
});
addEventListener('hashchange', pintarPestanas);
document.addEventListener('click', e => {
  const abierto = document.querySelector('.cms-pestanas details[open]');
  if (abierto && !abierto.contains(e.target)) abierto.open = false;
});

/* ---------- Plantilla de vista previa ---------- */

// `pagina`: la plantilla que se muestra. Para "Sitio" es la de inicio, con
// sus bloques guardados y el sitio del formulario.
const vista = (nombre, pagina = nombre) => window.createClass({
  getInitialState() { return { plantilla: null, error: null }; },
  componentDidMount() {
    Promise.all([plantilla(pagina), SITIO.sitio ? guardado(nombre === 'sitio' ? pagina : 'sitio') : {}])
      .then(([p, otros]) => this.setState({ plantilla: p, otros }))
      .catch(() => this.setState({ error: 'No se pudo cargar la vista previa.' }));
  },
  componentDidUpdate() {
    if (!this.raiz) return;
    const doc = this.raiz.ownerDocument;
    doc.__prefijo = this.prefijo;
    // Dirección de la página en el sitio, para resolver los enlaces del menú.
    doc.__pagina = nombre === 'paginas' ? `/${this.props.entry.get('slug') || ''}/` : '/';
    if (anclaPendiente) {
      const ancla = anclaPendiente;
      anclaPendiente = null;
      setTimeout(() => irAAncla(doc, ancla), 300);
    }
    if (!doc.documentElement.lang) idioma(pagina).then(l => { doc.documentElement.lang = l; });
    if (SITIO.sitio) {
      doc.body.classList.toggle('cms-vista-sitio', !!this.prefijo);
      doc.body.classList.toggle('cms-vista-pagina', !this.prefijo);
    }
    if (doc !== docVista) {
      docVista = doc;
      doc.addEventListener('click', e => {
        if (e.target.closest('.hamburguesa')) {
          menuMovilAbierto = !menuMovilAbierto;
          aplicarMenuMovil(doc);
          return;
        }
        // Un clic fuera del menú móvil abierto lo cierra, como en el sitio (y
        // el clic sigue: abre el campo de lo que se tocó).
        if (menuMovilAbierto && !e.target.closest('.menu-movil')) {
          menuMovilAbierto = false;
          aplicarMenuMovil(doc);
        }
        // En la vista previa los enlaces no navegan: un clic edita. Tampoco las
        // etiquetas de un formulario activan su campo: el navegador dispararía
        // un segundo clic sobre el campo, que ganaría y llevaría a otro lado.
        if (e.target.closest('a, label')) e.preventDefault();
        const el = editableDe(e.target);
        // Excepción: un enlace que aquí no se edita (el menú en una página)
        // navega como en el sitio.
        const enlace = e.target.closest('a[href]');
        if (enlace && !el && navegar(enlace, doc)) { quitarResaltado(); return; }
        if (el) {
          // Se resalta de inmediato (los campos de imagen no reciben foco).
          rutaActiva = el.getAttribute('data-ruta');
          resaltar(false);
          irACampo(rutaActiva);
        } else {
          // Clic en una parte no editable: se quita el resaltado y se suelta
          // el campo del formulario, como al hacer clic fuera en el editor.
          quitarResaltado();
          const activo = document.activeElement;
          if (activo && formulario()?.contains(activo)) activo.blur();
        }
      });
      doc.addEventListener('mouseover', e => { bajoMouse = editableDe(e.target); reenmarcar(); });
      doc.addEventListener('mouseleave', () => { bajoMouse = null; reenmarcar(); });
      // Si cambia el tamaño (ventana, fuentes, imágenes que terminan de
      // cargar, un acordeón que se abre), los recuadros se recolocan.
      doc.defaultView.addEventListener('resize', reenmarcar);
      doc.defaultView.addEventListener('resize', () => medirMenu(doc));
      let espiaPendiente = false;
      doc.defaultView.addEventListener('scroll', () => {
        if (espiaPendiente) return;
        espiaPendiente = true;
        doc.defaultView.requestAnimationFrame(() => { espiaPendiente = false; espiar(doc); });
      }, { passive: true });
      if (doc.fonts) doc.fonts.ready.then(() => medirMenu(doc));
      doc.addEventListener('toggle', () => setTimeout(reenmarcar, 400), true);
      new doc.defaultView.ResizeObserver(reenmarcar).observe(doc.body);
    }
    medirMenu(doc);
    aplicarMenuMovil(doc);
    // Al redibujarse (cada edición) se pierden las marcas: se vuelven a poner.
    marcarPagina(doc);
    espiar(doc);
    bajoMouse = null;
    resaltar(false);
  },
  render() {
    const h = window.h;
    if (this.state.error) return h('p', { style: { padding: '2rem' } }, this.state.error);
    if (!this.state.plantilla) return h('p', { style: { padding: '2rem' } }, 'Cargando vista previa…');
    datosActuales = this.props.entry.get('data').toJS();
    const esSitio = nombre === 'sitio';
    this.prefijo = esSitio ? 'sitio.' : '';
    // Los enlaces del menú y del pie se resuelven igual que en el build
    // (una opción que apunta a una página lleva a /pagina).
    const datos = esSitio
      ? { ...this.state.otros, sitio: enlazar(datosActuales) }
      : SITIO.sitio ? { ...datosActuales, sitio: enlazar(this.state.otros) } : datosActuales;
    const { html } = aplicarContenido(this.state.plantilla, datos, { marcar: true, bloques });
    return h('div', { ref: el => { this.raiz = el; }, dangerouslySetInnerHTML: { __html: absoluta(html) } });
  },
});

for (const nombre of SITIO.paginas || []) {
  CMS.registerPreviewTemplate(nombre, vista(nombre));
}
// Páginas nuevas (colección "paginas" del panel): mismo molde que inicio.
if (SITIO.bloques && (SITIO.paginas || []).includes('inicio')) {
  CMS.registerPreviewTemplate('paginas', vista('paginas', 'inicio'));
}
if (SITIO.sitio && (SITIO.paginas || []).length) {
  CMS.registerPreviewTemplate('sitio', vista('sitio', SITIO.paginas.includes('inicio') ? 'inicio' : SITIO.paginas[0]));
}
