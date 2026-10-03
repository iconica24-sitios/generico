/* =========================================================================
   Comportamiento de la plantilla de bloques (sin dependencias)
   - Menú móvil: se abre con la hamburguesa y se cierra al elegir, al tocar
     fuera o al pasar a pantalla ancha.
   - Menú activo: resalta la página en la que se está y, en ella, la
     sección visible (enlaces #ancla).
   - Precios: selector Mensual / Anual.
   - Contacto: abre la aplicación de correo con el mensaje listo.
   ========================================================================= */
(() => {
  const cabecera = document.querySelector('.cabecera');

  /* ---------- Menú móvil ---------- */
  if (cabecera) {
    const boton = cabecera.querySelector('.hamburguesa');
    const panel = cabecera.querySelector('.menu-movil');
    const abrir = si => {
      cabecera.classList.toggle('is-abierta', si);
      boton.setAttribute('aria-expanded', String(si));
    };
    boton.addEventListener('click', () => abrir(!cabecera.classList.contains('is-abierta')));
    panel.querySelectorAll('a').forEach(a => a.addEventListener('click', () => abrir(false)));
    cabecera.querySelector('.marca').addEventListener('click', () => abrir(false));
    document.addEventListener('pointerdown', e => {
      if (cabecera.classList.contains('is-abierta') && !panel.contains(e.target) && !boton.contains(e.target)) abrir(false);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') abrir(false); });
    matchMedia('(min-width: 768px)').addEventListener('change', e => { if (e.matches) abrir(false); });
  }

  /* ---------- Menú: la página en la que se está ---------- */
  const ruta = p => p.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
  document.querySelectorAll('.menu a, .menu-movil__lista a').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('/') && !href.includes('#') && ruta(href) === ruta(location.pathname)) a.setAttribute('aria-current', 'page');
  });

  /* ---------- Menú activo según la sección visible ---------- */
  const enlaces = [...document.querySelectorAll('.menu a, .menu-movil__lista a')]
    .filter(a => /^#[\w-]+$/.test(a.getAttribute('href') || ''));
  const ids = [...new Set(enlaces.map(a => a.getAttribute('href').slice(1)))].filter(id => document.getElementById(id));
  let bloqueo = 0;
  const marcar = activo => enlaces.forEach(a => {
    if (a.getAttribute('aria-current') === 'page') return;
    if (a.getAttribute('href') === '#' + activo) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  const espiar = () => {
    if (Date.now() < bloqueo) return;
    let activo = null;
    for (const id of ids) if (document.getElementById(id).getBoundingClientRect().top <= 140) activo = id;
    const alto = document.documentElement.scrollHeight;
    if (ids.length && scrollY > 0 && alto > innerHeight + 200 && innerHeight + scrollY >= alto - 4) activo = ids[ids.length - 1];
    marcar(activo);
  };
  // Al elegir en el menú se marca de inmediato, sin esperar el desplazamiento.
  enlaces.forEach(a => a.addEventListener('click', () => { bloqueo = Date.now() + 900; marcar(a.getAttribute('href').slice(1)); setTimeout(espiar, 950); }));
  let pendiente = false;
  addEventListener('scroll', () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { espiar(); pendiente = false; });
  }, { passive: true });
  addEventListener('resize', espiar);
  addEventListener('load', espiar);
  espiar();

  /* ---------- Precios: Mensual / Anual ---------- */
  document.querySelectorAll('.precios').forEach(seccion => {
    const botones = seccion.querySelectorAll('.precios__periodo');
    botones.forEach(b => b.addEventListener('click', () => {
      const anual = b.dataset.periodo === 'anual';
      seccion.classList.toggle('precios--anual', anual);
      botones.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    }));
  });

  /* ---------- Contacto ---------- */
  document.querySelectorAll('.contacto').forEach(seccion => {
    const form = seccion.querySelector('.contacto__form');
    const destino = (seccion.querySelector('.contacto__destino')?.getAttribute('href') || '').replace(/^mailto:/, '');
    if (!form) return;
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!destino) { alert('Este formulario todavía no tiene un correo de destino.'); return; }
      const datos = new FormData(form);
      const asunto = `Mensaje de ${datos.get('nombre')} desde ${location.hostname}`;
      const cuerpo = `${datos.get('mensaje') || ''}\n\n— ${datos.get('nombre')} <${datos.get('correo')}>`;
      location.href = `mailto:${destino}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
      form.hidden = true;
      form.style.display = 'none';
      seccion.querySelector('.contacto__enviado').hidden = false;
    });
  });
})();
