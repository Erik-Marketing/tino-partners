// Shared between the Vercel functions (api/content.js) and the VPS server
// (server.js) so the two never drift apart. Same values as the ones
// hardcoded in index.html today — used whenever no saved content exists
// yet, so the site renders identically until someone actually edits
// something in the admin panel.
const DEFAULT_CONTENT = {
  hero: {
    eyebrow: '<span style="font-size: 20px;">Partner de negocio — Buenos Aires</span>',
    headlinePre: '<span style="font-size: 100px;">Somos Tino, </span>',
    headlineEm: '<span style="font-size: 100px;">tu partner</span>',
    headlinePost: '<span style="font-size: 100px;"> de negocio.</span>',
    lede: 'Unimos estrategia, contenido audiovisual y tecnología en un mismo equipo, para pensar tu marca de punta a punta y acompañarte en cada decisión con la misma mirada.',
    ctaText: 'Contactanos',
    image: { url: '/media/uploads/1788546198252-man-portrait-editorial-collage-2k-202609021132.jpeg', posX: 53, posY: 44, fadeBottom: true },
    mobileImage: null,
  },
  proyectos: {
    eyebrow: 'Nuestros proyectos',
    headingLine1: 'Marcas con las que',
    headingLine2: 'hemos trabajado.',
    nota: 'Venimos haciendo esto hace años y ya pasaron muchas marcas por nuestras manos — lo que está en construcción es la web, no la experiencia. Arrancamos a subir ese trabajo acá, empezando por NOBRAND, y esta sección se va a ir llenando con cada proyecto que sumamos.',
    tiles: [
      {
        title: 'NOBRAND', status: 'Cliente', category: 'Producción',
        video: { url: '/media/nobrand/trailer-vertical.mp4', posX: 50, posY: 50 },
        logo: { url: '', posX: 50, posY: 50 },
        adminLabel: 'Proyecto 1',
      },
      {
        title: 'Wholegreen', status: 'Próximamente', category: 'Estrategia',
        video: { url: '/media/proyectos/proyecto2-capsula-3-wg.mp4', posX: 50, posY: 50 },
        logo: { url: '', posX: 50, posY: 50 },
        adminLabel: 'Proyecto 2',
      },
      {
        title: 'Desarrollo en curso', status: 'Próximamente', category: 'Tecnología',
        video: { url: '/media/proyectos/proyecto3-opera-3.mp4', posX: 50, posY: 50 },
        logo: { url: '', posX: 50, posY: 50 },
        adminLabel: 'Proyecto 3',
      },
    ],
  },
  ticker: {
    enabled: false,
    speed: 28,
    row1: 'Branding, Manual de marca, Filmaker, Tiendas Online, Ecommerce, Foto producto, Redes Sociales, Estrategia creativa, Google Ads, Engagement, Identidad visual, Linkedin Ads',
    row2: 'Contenido orgánico, Landing Page, Branding, Páginas Web, Diseño Gráfico, Catálogos, Ecommerce, Estrategia creativa, Manual de marca, Google Ads, Meta Ads, TikTok Ads',
  },
  // Rueda del ecosistema — reemplaza a la vieja sección "Lo que nos hace
  // diferentes" (copy + tarjeta de barras). El bloque de calificación por
  // rango de inversión y su botón se conservan acá, en el recuadro de cierre.
  //
  // `items` se dibuja arrancando a las 12 en punto y girando en sentido
  // horario, así que el orden del array ES el orden en la rueda. Todos los
  // segmentos son disciplinas propias — ya no hay una mitad "con socios" —
  // así que el color solo alterna por ritmo visual entre los dos degradados
  // de marca según la posición (ver ecoGrad en index.html), no según ningún
  // campo del dato. `texto` ya no se muestra en el círculo (solo el
  // título) — sigue viajando porque lo usa la lista equivalente en
  // pantallas chicas, donde la rueda no entra.
  ecosistema: {
    enabled: true,
    eyebrow: 'El marketing es un ecosistema.',
    heading: 'Nosotros cubrimos lo que realmente mueve tu negocio.',
    focusLabel: 'Nuestro foco',
    centerTitle: 'Tino Partners',
    centerTagline: 'Contenido + Data + Tecnología = Crecimiento',
    legendLabel: 'Somos especialistas en',
    legendNota: 'Las 10 disciplinas que mueven tu negocio',
    resultadoTitulo: 'Lo importante es el resultado.',
    resultadoTexto: 'Nos enfocamos en lo que sabemos hacer muy bien y tenemos un impacto directo en tus ventas, tu crecimiento y la eficiencia de tu negocio.',
    ctaTitulo: 'Un equipo. Un mismo objetivo.',
    ctaTexto: 'Nuestro foco está en marcas o empresas con capacidad de invertir entre USD 3.000 y 20.000 en medios. ¿Tu empresa está en esta etapa?',
    ctaBoton: 'Hablemos',
    items: [
      { icon: 'camara', title: 'Producción audiovisual', texto: 'Video, foto, contenido para redes, podcasts, dirección de arte.' },
      { icon: 'grafico', title: 'Pauta en Meta y Google', texto: 'Estrategia, gestión, optimización y escalamiento.' },
      { icon: 'datos', title: 'Datos y analytics', texto: 'Medición, reportes y toma de decisiones en base a datos.' },
      { icon: 'engranaje', title: 'Automatizaciones e IA', texto: 'Procesos, CRM, flujos de comunicación, integraciones y apps.' },
      { icon: 'monitor', title: 'Desarrollo web y landings', texto: 'Sitios, landings, UX/UI orientado a conversión.' },
      { icon: 'tienda', title: 'Ventas directas y atención al cliente', texto: 'Gestión comercial, equipos de venta, atención al cliente.' },
      { icon: 'megafono', title: 'PR y medios', texto: 'Relaciones públicas, prensa, influencers.' },
      { icon: 'personas', title: 'Gestión de redes sociales', texto: 'Community management y atención al cliente.' },
      { icon: 'lampara', title: 'Branding', texto: 'Identidad de marca, diseño de logo, manual de marca.' },
      { icon: 'estrategia', title: 'Estrategia de negocio', texto: 'Consultoría empresarial, finanzas, pricing, modelo de negocio.' },
    ],
  },
  stats: {
    items: [
      { num: '3+', label: 'Socios especialistas' },
      { num: '3', label: 'Disciplinas bajo un mismo equipo' },
      { num: '1+', label: 'Marcas trabajando con nosotros' },
      { num: '100%', label: 'Foco en resultados reales' },
    ],
    flag: 'Cifras de referencia — se actualizan a medida que crecemos',
  },
  quehacemos: {
    enabled: true,
    eyebrow: '¿Agencia o partner?',
    heading: 'No somos una agencia de Marketing. Somos tu <span style="color:#171221">Partner de Negocio.</span>',
    texto1: 'No esperamos que nos digas qué hacer: somos proactivos y te decimos cuál creemos que es el mejor camino. No solo ejecutamos — evaluamos y determinamos si una acción es o no la más conveniente para tu negocio, incluso cuando esa respuesta no sea la que esperabas. Esa transparencia es parte de nuestro profesionalismo.',
    texto2: 'Trabajamos con empresas que ya tienen trayectoria, un negocio funcionando, un equipo detrás y presupuesto real para invertir en crecimiento.',
    ctaText: 'Contactanos',
  },
  marcas: { enabled: true, items: 'Aura, Solden, Nimbus, Marca Ejemplo, Próximo cliente' },
  // Logo carousel shown above "Nuestros proyectos" — separate from `marcas`
  // (which is just a static row of text names). Starts off/empty until
  // Erik uploads real client logos from the panel.
  logosBand: { enabled: false, speed: 30, bgColor: '', logos: [] },
  testimonios: {
    enabled: false,
    items: [
      {
        quote: 'Tener producción, medios y tecnología en un mismo equipo nos ahorró meses de coordinación. Se nota que entienden el negocio, no solo la campaña.',
        nombre: 'María Fernández',
        rol: 'Marketing Manager, Marca Ejemplo',
        flag: 'Ejemplo',
      },
    ],
  },
  blog: {
    heading: 'Lo que estamos pensando.',
    texto: 'Estamos armando el blog de Tino Partners. Cuando esté listo, vas a encontrar acá notas sobre estrategia, producción y tecnología aplicada a marcas — por ahora, seguinos en Instagram para lo último.',
    // How many posts the Home page's "Contenido interesante" teaser shows
    // at once — the grid there is designed for a fixed row count, so this
    // caps it instead of growing forever as articles pile up. The full
    // /blog listing page is unaffected; it always shows every article.
    homeLimit: 8,
    articles: [
      {
        slug: 'como-armar-un-plan-de-medios-que-no-dependa-de-un-solo-canal',
        template: 'estandar',
        tag: 'Estrategia',
        title: 'Cómo armar un plan de medios que no dependa de un solo canal',
        excerpt: 'Ideas para repartir presupuesto entre canales sin perder foco en lo que realmente mueve el negocio.',
        cover: { url: '/media/uploads/1788546201083-format-image-into-square-2k-202609021420.jpeg', posX: 50, posY: 50 },
        body: '<p>Repartir el presupuesto de medios entre varios canales suena a sentido común, pero en la práctica muchas marcas terminan concentrando todo en el canal que mejor conocen — no necesariamente el que mejor rinde.</p><p>Antes de sumar un canal nuevo conviene tener claro qué rol cumple cada uno: hay canales de descubrimiento, canales de conversión y canales de retención, y no todos se miden con la misma vara. Mezclar esos objetivos en un solo reporte es la forma más rápida de tomar una mala decisión con buenos datos.</p><p>La regla que nos funciona: ningún canal debería quedarse con más del 60% del presupuesto hasta tener al menos dos ciclos completos de datos que confirmen que ahí es donde está el negocio.</p>',
        gallery: [],
      },
      {
        slug: 'contenido-que-se-adapta-a-cada-plataforma',
        template: 'video',
        tag: 'Producción',
        title: 'Contenido que se adapta a cada plataforma (no al revés)',
        excerpt: 'Por qué el mismo video no debería verse igual en Instagram, YouTube y TikTok.',
        cover: { url: '/media/nobrand/trailer-vertical.mp4', posX: 50, posY: 50 },
        body: '<p>El error más común que vemos: grabar un solo video "para redes" y despachar el mismo corte a todas las plataformas. Cada una tiene su propio comportamiento de consumo — no es solo el formato (vertical vs. horizontal), es el ritmo, el tiempo que tenés antes de perder al espectador, y hasta si el sonido arranca activado o no.</p><p>Producir pensando en esto no significa grabar tres veces lo mismo. Significa planificar el rodaje con suficiente material crudo (b-roll, planos alternativos, tomas más largas) para poder editar versiones realmente distintas después, en vez de recortar una sola pieza a la fuerza.</p>',
        gallery: [],
      },
      {
        slug: 'automatizar-reportes-sin-perder-el-criterio-humano',
        template: 'galeria',
        tag: 'Tecnología',
        title: 'Automatizar reportes sin perder el criterio humano',
        excerpt: 'Dónde conviene meter IA en la medición de una campaña, y dónde todavía no.',
        cover: { url: '/media/uploads/1788546201083-format-image-into-square-2k-202609021420.jpeg', posX: 50, posY: 50 },
        body: '<p>La automatización de reportes ahorra horas de trabajo repetitivo: juntar datos de varias plataformas, armar el mismo gráfico todas las semanas, redactar el resumen ejecutivo. Ahí la IA suma, y suma mucho.</p><p>Donde todavía no reemplaza a una persona es en la lectura del contexto: por qué bajó una métrica, si fue la campaña o el mercado, qué vale la pena escalar. Automatizamos la parte mecánica del reporte para que el tiempo humano se vaya a esa segunda parte, no a copiar números de una planilla a otra.</p>',
        gallery: [
          { url: '/media/uploads/1788546201083-format-image-into-square-2k-202609021420.jpeg', posX: 50, posY: 50 },
        ],
      },
    ],
  },
  form: {
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true, placeholder: 'Tu nombre' },
      { key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'tu@empresa.com' },
      { key: 'rubro', label: 'Rubro del negocio', type: 'text', required: true, placeholder: 'Ej: indumentaria, gastronomía, salud' },
      { key: 'tamano', label: 'Tamaño de la empresa', type: 'select', required: true, options: '1 a 5 personas, 6 a 20 personas, 21 a 50 personas, 51 a 200 personas, Más de 200 personas' },
      { key: 'ganancias', label: 'Presupuesto para Marketing', type: 'select', required: true, options: '0 a 1.000 USD, 1.001 a 5.000 USD, 5.001 a 20.000 USD, 20.001 a 50.000 USD, Más de 50.000 USD' },
      { key: 'facturacion', label: '¿Cuánto factura tu empresa por mes?', type: 'select', required: true, options: 'Menos de USD 10.000, USD 10.000 – 30.000, USD 30.000 – 100.000, USD 100.000 – 300.000, Más de USD 300.000, Prefiero conversarlo' },
      { key: 'necesitan_mejorar', label: '¿Qué necesitan mejorar?', type: 'checkbox-group', required: false, options: 'Contenido y producción, Meta / Google Ads, Ventas, Medición y datos, Automatizaciones, Web / tecnología, Necesitamos ordenar todo' },
      { key: 'mensaje', label: 'Contanos tu principal desafío hoy', type: 'textarea', required: true, placeholder: 'Contanos sobre tu marca y qué necesitás' },
    ],
  },
  // Logotipo del header. Vacío = se usa el lockup original (el ícono SVG
  // + "TINO/PARTNERS" que está escrito en el HTML de cada página). Si se
  // sube una imagen, reemplaza ese lockup completo en todas las páginas.
  logo: { url: '', height: 34 },
  menu: {
    items: [
      { label: 'Home', url: 'index.html' },
      { label: 'Nosotros', url: 'nosotros.html' },
      { label: 'Qué hacemos', url: 'index.html#servicios' },
      { label: 'Clientes', url: 'index.html#trabajos' },
      { label: 'Portfolio', url: 'portfolio.html' },
      { label: 'Blog', url: 'blog.html' },
    ],
    ctaLabel: 'Contactanos',
    ctaUrl: 'index.html#contacto',
  },
  footer: {
    email: 'hola@tinopartners.com',
    instagram: '@tinopartners',
    ubicacion: 'Buenos Aires, Argentina',
  },
  nosotros: {
    hero: {
      eyebrow: 'Nosotros',
      headline: '<span style="color:#9B5DF6">No</span> somos una agencia. <span style="color:#9B5DF6">Somos</span> tu partner de negocio.',
      lede: 'Una agencia entrega lo que le pedís. Nosotros nos metemos en cómo funciona tu negocio de verdad, y desde ese lugar te decimos lo que pensamos — incluso cuando no es lo que esperabas escuchar. Ese es el trabajo de un partner: acompañar con criterio propio, no solo ejecutar.',
    },
    equipo: {
      eyebrow: 'Directivos',
      headingLine1: 'Un mismo partner.',
      headingLine2: 'Distintas especialidades.',
      members: [
        { key: 'juan', name: 'Juan', role: 'Producción &amp; Contenido', bio: 'Dirige la producción audiovisual y la presencia en redes de cada cliente, de principio a fin.', photo: { url: '', posX: 50, posY: 50 } },
        { key: 'fran', name: 'Fran', role: 'Estrategia &amp; Medios', bio: 'Lidera la estrategia de medios y las decisiones de marca de cada cuenta, con foco en resultados de negocio.', photo: { url: '', posX: 50, posY: 50 } },
        { key: 'erik', name: 'Erik', role: 'Tecnología &amp; IA', bio: 'Diseña y construye la infraestructura técnica y de automatización detrás de cada campaña, incluida esta misma web.', photo: { url: '', posX: 50, posY: 50 } },
      ],
    },
    concept: {
      eyebrow: 'El nombre',
      heading: '¿Por qué Tino?',
      parrafo1: '"Tener tino" es tener buen ojo, medida justa, saber hasta dónde llegar. Elegimos ese nombre porque es justo lo que buscamos en cada decisión de marca.',
      parrafo2: 'Ni de más, ni de menos — la medida exacta entre creatividad, estrategia y tecnología. Ese es el filtro que aplicamos antes de proponerte cualquier cosa.',
    },
    cta: {
      eyebrow: '¿Hablamos?',
      heading: 'Contános en qué estás pensando.',
      texto: 'Una primera charla no tiene costo ni compromiso. Si hay fit de los dos lados, seguimos adelante juntos.',
      ctaText: 'Contactanos',
    },
  },
  portfolio: {
    hero: {
      eyebrow: 'Portfolio',
      headline: 'Tres tipos de negocio. Un mismo equipo.',
      lede: 'Producción audiovisual, estrategia y tecnología aplicadas a cada tipo de negocio — así trabajamos en Ecommerce, Marcas &amp; Servicios y Eventos &amp; Experiencias.',
    },
    // The 3 highlight reels are fixed business-type showcases (not specific
    // clients) — each one is a different reel Erik uploads per category,
    // matching the same 3 tipos used to group real casos further down.
    tiles: [
      { key: 'tile1', title: 'Ecommerce', video: { url: '', posX: 50, posY: 50 }, logo: { url: '', posX: 50, posY: 50 } },
      { key: 'tile2', title: 'Marcas &amp; Servicios', video: { url: '', posX: 50, posY: 50 }, logo: { url: '', posX: 50, posY: 50 } },
      { key: 'tile3', title: 'Eventos &amp; Experiencias', video: { url: '', posX: 50, posY: 50 }, logo: { url: '', posX: 50, posY: 50 } },
    ],
    respaldo: {
      eyebrow: 'Tres especialidades. Un mismo equipo.',
      heading: 'Producción audiovisual + Performance/Data + Automatización/IA.',
      flagLabel: 'Experiencia que nos respalda',
      logos: [],
    },
    // Each caso is tagged with `tipo` so the portfolio page can group them
    // into the 3 fixed business-type blocks (ecommerce / marcas-servicios /
    // eventos-experiencias) instead of one flat "otros casos" grid — stays
    // empty (and hidden) until Erik adds real cases from the panel.
    casos: [],
    cta: {
      eyebrow: '¿Hablamos?',
      heading: 'Sé parte del primer caso real acá.',
      texto: 'Una primera charla no tiene costo ni compromiso. Si hay fit de los dos lados, tu proyecto puede ser el primero en reemplazar estos ejemplos.',
    },
  },
  slugs: {
    home: '',
    nosotros: 'nosotros',
    portfolio: 'portfolio',
    nobrand: 'nobrand',
    blog: 'blog',
    terminos: 'terminos',
    privacidad: 'privacidad',
    admin: 'equipo-tino',
  },
  meta: {
    home: { title: 'Tino Partners', description: '' },
    nosotros: { title: 'Nosotros — Tino Partners', description: '' },
    portfolio: { title: 'Portfolio — Tino Partners', description: '' },
    nobrand: { title: 'NOBRAND — Portfolio — Tino Partners', description: '' },
    blog: { title: 'Blog — Tino Partners', description: '' },
    terminos: { title: 'Términos y condiciones — Tino Partners', description: '' },
    privacidad: { title: 'Política de privacidad — Tino Partners', description: '' },
  },
  kanban: {
    // a column's `id` is generated once and never changes even if its
    // `label` is renamed later — consultas reference columns by id, so a
    // rename must never silently move every card.
    columns: [
      { id: 'recibida', label: 'Consulta recibida' },
      { id: 'contactado', label: 'Contactado' },
      { id: 'negociacion', label: 'Negociación' },
      { id: 'cerrado', label: 'Cerrado' },
      { id: 'perdido', label: 'Perdido' },
    ],
  },
};

// pages whose URL segment can be customized from the admin panel; keys
// here are also used as the reserved-word/collision list for validation.
// "home" is special: '' means "no extra path, just use /" (the root
// always works regardless), so it's the only key allowed to be empty.
// "admin" is special too: unlike the others, its literal admin.html path
// is never redirected anywhere (server.js just 404s it) — redirecting
// would leak the real secret path in the Location header, defeating the
// point of hiding it.
const SLUG_PAGE_FILES = {
  home: 'index.html',
  nosotros: 'nosotros.html',
  portfolio: 'portfolio.html',
  nobrand: 'nobrand.html',
  blog: 'blog.html',
  terminos: 'terminos.html',
  privacidad: 'privacidad.html',
  admin: 'admin.html',
};
const RESERVED_SLUGS = ['admin', 'api', 'media', 'blog-post', 'caso', 'index'];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// returns an array of error messages (empty = valid). Never throws —
// callers decide what to do with a non-empty result.
function validateSlugs(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object') return errors;
  const keys = Object.keys(SLUG_PAGE_FILES);
  const seen = new Map();
  keys.forEach((key) => {
    const value = candidate[key];
    if (value == null) return; // not being changed
    const v = String(value);
    if (v === '') {
      if (key === 'home') return; // home may be blank — falls back to just "/"
      errors.push(`"${key}" no puede quedar vacío.`);
      return;
    }
    if (!SLUG_RE.test(v)) {
      errors.push(`"${v}" (${key}) solo puede tener minúsculas, números y guiones.`);
      return;
    }
    if (RESERVED_SLUGS.includes(v) || (keys.includes(v) && v !== key)) {
      errors.push(`"${v}" (${key}) es una palabra reservada o el nombre de otra página.`);
      return;
    }
    if (seen.has(v)) {
      errors.push(`"${v}" se repite en ${seen.get(v)} y ${key}.`);
      return;
    }
    seen.set(v, key);
  });
  return errors;
}

function slugify(text) {
  const plain = String(text || '').replace(/<[^>]+>/g, '');
  return (
    plain
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Mark}/gu, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'articulo'
  );
}

// fills in fields added after some articles were already saved (slug,
// template, cover, body, gallery), so old data keeps working on the new
// blog pages without needing a manual re-save first.
function normalizeArticles(articles) {
  if (!Array.isArray(articles)) return [];
  const usedSlugs = new Set();
  return articles.map((article) => {
    const next = Object.assign({ template: 'estandar', cover: null, body: '', gallery: [] }, article);
    if (!next.slug) {
      let base = slugify(next.title);
      let slug = base;
      let n = 2;
      while (usedSlugs.has(slug)) { slug = `${base}-${n}`; n += 1; }
      next.slug = slug;
    }
    usedSlugs.add(next.slug);
    return next;
  });
}

// same self-healing purpose as normalizeArticles, for portfolio.casos.
function normalizeCasos(casos) {
  if (!Array.isArray(casos)) return [];
  const usedSlugs = new Set();
  return casos.map((caso) => {
    const next = Object.assign({ template: 'estandar', cover: null, cuerpo: '', gallery: [] }, caso);
    if (!next.slug) {
      let base = slugify(next.cliente);
      let slug = base;
      let n = 2;
      while (usedSlugs.has(slug)) { slug = `${base}-${n}`; n += 1; }
      next.slug = slug;
    }
    usedSlugs.add(next.slug);
    return next;
  });
}

// Migrates the pre-carousel single-testimonial shape ({quote,nombre,rol,flag})
// into the current {enabled, items:[]} shape — without this, a site that
// already had a saved `testimonios` value keeps that exact old shape forever
// (loadMergedContent's top-level merge is shallow), silently losing whatever
// real quote/name was there instead of promoting it into items[0].
function normalizeTestimonios(saved) {
  if (saved && Array.isArray(saved.items)) return Object.assign({}, DEFAULT_CONTENT.testimonios, saved);
  if (saved && (saved.quote || saved.nombre || saved.rol || saved.flag)) {
    return {
      enabled: false,
      items: [{ quote: saved.quote || '', nombre: saved.nombre || '', rol: saved.rol || '', flag: saved.flag || '' }],
    };
  }
  return DEFAULT_CONTENT.testimonios;
}

// New default questions added after some sites already had a saved
// `form.fields` array — appends any default field whose `key` is missing,
// leaving Erik's own fields/order/edits untouched. Also relabels the old
// "Mensaje" field to the new copy, but only when it's still exactly the
// untouched default label, never overwriting a custom relabel.
function normalizeFormFields(savedFields) {
  const fields = Array.isArray(savedFields) && savedFields.length
    ? savedFields.slice()
    : DEFAULT_CONTENT.form.fields.map((f) => Object.assign({}, f));
  const existingKeys = new Set(fields.map((f) => f.key));
  DEFAULT_CONTENT.form.fields.forEach((defaultField) => {
    if (!existingKeys.has(defaultField.key)) fields.push(Object.assign({}, defaultField));
  });
  const oldMensajeLabel = 'Mensaje';
  const newMensajeLabel = DEFAULT_CONTENT.form.fields.find((f) => f.key === 'mensaje').label;
  return fields.map((f) => (f.key === 'mensaje' && f.label === oldMensajeLabel)
    ? Object.assign({}, f, { label: newMensajeLabel })
    : f);
}

// ---------- users/roles ----------
// Permission keys mirror the admin.html sidebar's own data-view/
// data-blogview/data-portfolioview/SECTIONS[].key strings exactly, on
// purpose — one vocabulary shared between the server (enforcement)
// and the client (nav filtering + the role editor's checkbox tree),
// never translated between the two.
const PERMISSION_KEYS = [
  'consultas',
  'home-cms.hero', 'home-cms.logosBand', 'home-cms.proyectos', 'home-cms.ticker', 'home-cms.ecosistema',
  'home-cms.stats', 'home-cms.quehacemos', 'home-cms.marcas', 'home-cms.testimonios',
  'home-cms.blog', 'home-cms.footer',
  'blog-cms.new', 'blog-cms.list',
  'logo-cms',
  'menu-cms',
  'form-cms',
  'nosotros-cms',
  'portfolio-cms.general', 'portfolio-cms.new', 'portfolio-cms.list',
  'seo-cms',
  'usuarios.users', 'usuarios.roles',
];

// permission key -> dotted content.json path(s) it controls, plus the
// expected type of the value at that path (checked before merging a
// restricted-role save — see POST /api/content) so a role that can
// only touch, say, `footer` can never smuggle a wrong-shaped value
// into `blog.articles` and break normalizeArticles() for every
// visitor. Paths are real DEFAULT_CONTENT top-level keys (NOT nested
// under "home" — only the permission-key namespace uses that prefix,
// to match the sidebar's own grouping).
const CONTENT_PATHS = {
  'home-cms.hero': [{ path: 'hero', type: 'object' }],
  'home-cms.proyectos': [{ path: 'proyectos', type: 'object' }],
  'home-cms.ticker': [{ path: 'ticker', type: 'object' }],
  'home-cms.ecosistema': [{ path: 'ecosistema', type: 'object' }],
  'home-cms.stats': [{ path: 'stats', type: 'object' }],
  'home-cms.quehacemos': [{ path: 'quehacemos', type: 'object' }],
  'home-cms.marcas': [{ path: 'marcas', type: 'object' }],
  'home-cms.logosBand': [{ path: 'logosBand', type: 'object' }],
  'home-cms.testimonios': [{ path: 'testimonios', type: 'object' }],
  'home-cms.blog': [
    { path: 'blog.heading', type: 'string' },
    { path: 'blog.texto', type: 'string' },
    { path: 'blog.homeLimit', type: 'number' },
  ],
  'home-cms.footer': [{ path: 'footer', type: 'object' }],
  'blog-cms.new': [{ path: 'blog.articles', type: 'array' }],
  'blog-cms.list': [{ path: 'blog.articles', type: 'array' }],
  'logo-cms': [{ path: 'logo', type: 'object' }],
  'menu-cms': [{ path: 'menu', type: 'object' }],
  'form-cms': [{ path: 'form', type: 'object' }],
  'nosotros-cms': [{ path: 'nosotros', type: 'object' }],
  'portfolio-cms.general': [
    { path: 'portfolio.hero', type: 'object' },
    { path: 'portfolio.tiles', type: 'array' },
    { path: 'portfolio.respaldo', type: 'object' },
    { path: 'portfolio.cta', type: 'object' },
  ],
  'portfolio-cms.new': [{ path: 'portfolio.casos', type: 'array' }],
  'portfolio-cms.list': [{ path: 'portfolio.casos', type: 'array' }],
  'seo-cms': [
    { path: 'slugs', type: 'object' },
    { path: 'meta', type: 'object' },
  ],
  'consultas': [{ path: 'kanban', type: 'object' }],
};

// The one seeded, non-deletable role — allAccess is never toggled
// through the UI, only its label can be renamed. Everything that
// checks "can this user see/save everything" must test `allAccess`,
// never `id === 'owner'` (the label is user-editable).
const DEFAULT_ROLES = [
  { id: 'owner', label: 'Dueño', allAccess: true },
];

module.exports = {
  DEFAULT_CONTENT,
  PERMISSION_KEYS,
  CONTENT_PATHS,
  DEFAULT_ROLES,
  slugify,
  normalizeArticles,
  normalizeCasos,
  normalizeTestimonios,
  normalizeFormFields,
  validateSlugs,
  SLUG_PAGE_FILES,
};
