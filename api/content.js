const { put, get } = require('@vercel/blob');

const COOKIE_NAME = 'tp_admin';
const CONTENT_PATH = 'content/home.json';

// Same values as the ones hardcoded in index.html today — used whenever no
// saved content exists yet, so the site renders identically until someone
// actually edits something in the admin panel.
const DEFAULT_CONTENT = {
  hero: {
    eyebrow: 'Partner de negocio — Buenos Aires',
    headlinePre: 'Somos Tino, ',
    headlineEm: 'tu partner',
    headlinePost: ' de negocio.',
    lede: 'Tino Partners une producción de contenido, planificación de medios y tecnología aplicada en un mismo equipo, para que cada decisión de marca esté tan bien apuntada como se ve.',
    ctaText: 'Contactanos',
    image: { url: 'https://8re8o884kengswvt.public.blob.vercel-storage.com/uploads/1788359629540-man-portrait-editorial-collage-2k-202609021132.jpeg', posX: 53, posY: 44, fadeBottom: true },
    mobileImage: null,
  },
  proyectos: {
    eyebrow: 'Nuestros proyectos',
    headingLine1: 'Marcas con las que',
    headingLine2: 'hemos trabajado.',
    nota: 'Venimos haciendo esto hace años y ya pasaron muchas marcas por nuestras manos — lo que está en construcción es la web, no la experiencia. Arrancamos a subir ese trabajo acá, empezando por NOBRAND, y esta sección se va a ir llenando con cada proyecto que sumamos.',
    tiles: [
      {
        title: 'NOBRAND', status: 'Cliente', category: 'Producción', link: 'nobrand.html',
        video: { url: 'https://8re8o884kengswvt.public.blob.vercel-storage.com/marcas/nobrand/trailer-vertical.mp4', posX: 50, posY: 50 },
      },
      { title: 'Campaña en curso', status: 'Próximamente', category: 'Estrategia', video: null },
      { title: 'Desarrollo en curso', status: 'Próximamente', category: 'Tecnología', video: null },
    ],
  },
  ticker: {
    enabled: true,
    speed: 28,
    row1: 'Branding, Manual de marca, Filmaker, Tiendas Online, Ecommerce, Foto producto, Redes Sociales, Estrategia creativa, Google Ads, Engagement, Identidad visual',
    row2: 'Contenido orgánico, Landing Page, Branding, Páginas Web, Diseño Gráfico, Catálogos, Ecommerce, Estrategia creativa, Manual de marca, Google Ads',
  },
  diferenciales: {
    eyebrow: 'Lo que nos hace diferentes',
    heading: 'Un mismo equipo, de punta a punta.',
    texto: 'No coordinamos entre tres proveedores distintos: producimos el contenido, armamos la estrategia de medios y construimos la tecnología de medición bajo un mismo techo. Eso significa menos idas y vueltas, y decisiones que consideran el negocio completo, no solo la pieza que le toca a cada uno.',
    video: { url: 'https://8re8o884kengswvt.public.blob.vercel-storage.com/marcas/nobrand/margen-camp-002.mp4', posX: 50, posY: 50 },
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
    items: [
      {
        title: 'Producción & contenido',
        texto: 'Fotografía y video con mirada de marca, dirección de arte y gestión integral de redes sociales — contenido pensado para cada plataforma, no adaptado después.',
        tags: 'Fotografía, Video, Redes sociales, Dirección de arte',
      },
      {
        title: 'Estrategia & medios',
        texto: 'Planes de medios, campañas publicitarias y acciones comerciales diseñadas para mover un número de negocio concreto, no solo métricas de vanidad.',
        tags: 'Planificación de medios, Campañas, Estrategia de marca, Acciones comerciales',
      },
      {
        title: 'Tecnología & automatización',
        texto: 'Automatización de procesos, inteligencia artificial aplicada a imagen, contenido y reportes, medición con Google Tag Manager y Analytics, y desarrollo web y de apps a medida.',
        tags: 'Automatización, IA aplicada, GTM & Analytics, Desarrollo web & apps',
      },
    ],
  },
  marcas: { items: 'Aura, Solden, Nimbus, Marca Ejemplo, Próximo cliente' },
  testimonios: {
    quote: 'Tener producción, medios y tecnología en un mismo equipo nos ahorró meses de coordinación. Se nota que entienden el negocio, no solo la campaña.',
    nombre: 'María Fernández',
    rol: 'Marketing Manager, Marca Ejemplo',
    flag: 'Ejemplo',
  },
  blog: {
    heading: 'Lo que estamos pensando.',
    texto: 'Estamos armando el blog de Tino Partners. Cuando esté listo, vas a encontrar acá notas sobre estrategia, producción y tecnología aplicada a marcas — por ahora, seguinos en Instagram para lo último.',
    articles: [
      {
        slug: 'como-armar-un-plan-de-medios-que-no-dependa-de-un-solo-canal',
        template: 'estandar',
        tag: 'Estrategia',
        title: 'Cómo armar un plan de medios que no dependa de un solo canal',
        excerpt: 'Ideas para repartir presupuesto entre canales sin perder foco en lo que realmente mueve el negocio.',
        cover: { url: 'https://8re8o884kengswvt.public.blob.vercel-storage.com/marcas/nobrand/collage-02.jpg', posX: 50, posY: 50 },
        body: '<p>Repartir el presupuesto de medios entre varios canales suena a sentido común, pero en la práctica muchas marcas terminan concentrando todo en el canal que mejor conocen — no necesariamente el que mejor rinde.</p><p>Antes de sumar un canal nuevo conviene tener claro qué rol cumple cada uno: hay canales de descubrimiento, canales de conversión y canales de retención, y no todos se miden con la misma vara. Mezclar esos objetivos en un solo reporte es la forma más rápida de tomar una mala decisión con buenos datos.</p><p>La regla que nos funciona: ningún canal debería quedarse con más del 60% del presupuesto hasta tener al menos dos ciclos completos de datos que confirmen que ahí es donde está el negocio.</p>',
        gallery: [],
      },
      {
        slug: 'contenido-que-se-adapta-a-cada-plataforma',
        template: 'video',
        tag: 'Producción',
        title: 'Contenido que se adapta a cada plataforma (no al revés)',
        excerpt: 'Por qué el mismo video no debería verse igual en Instagram, YouTube y TikTok.',
        cover: { url: 'https://8re8o884kengswvt.public.blob.vercel-storage.com/marcas/nobrand/trailer-vertical.mp4', posX: 50, posY: 50 },
        body: '<p>El error más común que vemos: grabar un solo video "para redes" y despachar el mismo corte a todas las plataformas. Cada una tiene su propio comportamiento de consumo — no es solo el formato (vertical vs. horizontal), es el ritmo, el tiempo que tenés antes de perder al espectador, y hasta si el sonido arranca activado o no.</p><p>Producir pensando en esto no significa grabar tres veces lo mismo. Significa planificar el rodaje con suficiente material crudo (b-roll, planos alternativos, tomas más largas) para poder editar versiones realmente distintas después, en vez de recortar una sola pieza a la fuerza.</p>',
        gallery: [],
      },
      {
        slug: 'automatizar-reportes-sin-perder-el-criterio-humano',
        template: 'galeria',
        tag: 'Tecnología',
        title: 'Automatizar reportes sin perder el criterio humano',
        excerpt: 'Dónde conviene meter IA en la medición de una campaña, y dónde todavía no.',
        cover: { url: 'https://8re8o884kengswvt.public.blob.vercel-storage.com/marcas/nobrand/collage-02.jpg', posX: 50, posY: 50 },
        body: '<p>La automatización de reportes ahorra horas de trabajo repetitivo: juntar datos de varias plataformas, armar el mismo gráfico todas las semanas, redactar el resumen ejecutivo. Ahí la IA suma, y suma mucho.</p><p>Donde todavía no reemplaza a una persona es en la lectura del contexto: por qué bajó una métrica, si fue la campaña o el mercado, qué vale la pena escalar. Automatizamos la parte mecánica del reporte para que el tiempo humano se vaya a esa segunda parte, no a copiar números de una planilla a otra.</p>',
        gallery: [
          { url: 'https://8re8o884kengswvt.public.blob.vercel-storage.com/marcas/nobrand/collage-02.jpg', posX: 50, posY: 50 },
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
      { key: 'mensaje', label: 'Mensaje', type: 'textarea', required: true, placeholder: 'Contanos sobre tu marca y qué necesitás' },
    ],
  },
  menu: {
    items: [
      { label: 'Home', url: 'index.html#home' },
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
      headline: 'No somos una agencia. Somos tu partner de negocio.',
      lede: 'Una agencia entrega lo que le pedís. Nosotros nos metemos en cómo funciona tu negocio de verdad, y desde ese lugar te decimos lo que pensamos — incluso cuando no es lo que esperabas escuchar. Ese es el trabajo de un partner: acompañar con criterio propio, no solo ejecutar.',
    },
    equipo: {
      eyebrow: 'Directivos',
      headingLine1: 'Un mismo partner.',
      headingLine2: 'Distintas especialidades.',
      members: [
        { key: 'juan', name: 'Juan', role: 'Producción &amp; Contenido', bio: 'Dirige la producción audiovisual y la presencia en redes de cada cliente, de principio a fin.' },
        { key: 'fran', name: 'Fran', role: 'Estrategia &amp; Medios', bio: 'Lidera la estrategia de medios y las decisiones de marca de cada cuenta, con foco en resultados de negocio.' },
        { key: 'erik', name: 'Erik', role: 'Tecnología &amp; IA', bio: 'Diseña y construye la infraestructura técnica y de automatización detrás de cada campaña, incluida esta misma web.' },
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
      headline: 'El formato del portfolio, antes que los primeros casos.',
      lede: 'Todavía no tenemos proyectos reales para mostrar acá — pero ya estamos trabajando con las primeras marcas. Así vamos a presentar cada caso apenas cerremos una entrega: qué hicimos, con qué estrategia, y qué resultado dejó.',
      previewFlag: 'Vista previa del formato — contenido de ejemplo',
    },
    tiles: [
      { key: 'tile1', status: 'Cliente', category: 'Producción', title: 'NOBRAND', meta: 'Campaña Margen — 2026' },
      { key: 'tile2', status: 'Ejemplo', category: 'Estrategia', title: 'Marca Ejemplo 02', meta: 'Campaña de lanzamiento — 2026' },
      { key: 'tile3', status: 'Ejemplo', category: 'Tecnología', title: 'Marca Ejemplo 03', meta: 'Automatización &amp; medición — 2026' },
    ],
    cta: {
      eyebrow: '¿Hablamos?',
      heading: 'Sé parte del primer caso real acá.',
      texto: 'Una primera charla no tiene costo ni compromiso. Si hay fit de los dos lados, tu proyecto puede ser el primero en reemplazar estos ejemplos.',
    },
  },
};

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
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

module.exports = async function handler(req, res) {
  // never let the browser or an edge/CDN cache this response — the content
  // (including image/video URLs) changes whenever someone saves in the
  // admin, and a stale cached copy was showing an old photo after a reload.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'GET') {
    try {
      const result = await get(CONTENT_PATH, {
        access: 'public',
        useCache: false,
        token: process.env.MEDIA_READ_WRITE_TOKEN,
      });
      if (!result || result.statusCode !== 200) return res.status(200).json(DEFAULT_CONTENT);
      const text = await new Response(result.stream).text();
      const saved = JSON.parse(text);
      const merged = Object.assign({}, DEFAULT_CONTENT, saved);
      merged.blog = Object.assign({}, DEFAULT_CONTENT.blog, saved.blog, {
        articles: normalizeArticles((saved.blog && saved.blog.articles) || DEFAULT_CONTENT.blog.articles),
      });
      return res.status(200).json(merged);
    } catch (err) {
      return res.status(200).json(DEFAULT_CONTENT);
    }
  }

  if (req.method === 'POST') {
    const sessionToken = readCookie(req, COOKIE_NAME);
    const authorized = process.env.ADMIN_TOKEN && sessionToken === process.env.ADMIN_TOKEN;
    if (!authorized) return res.status(401).json({ error: 'No autorizado' });

    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Contenido inválido' });

    try {
      await put(CONTENT_PATH, JSON.stringify(body), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.MEDIA_READ_WRITE_TOKEN,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('save content failed', err);
      return res.status(500).json({ error: 'No se pudo guardar' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};
