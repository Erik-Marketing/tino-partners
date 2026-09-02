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
    image: { url: 'https://8re8o884kengswvt.public.blob.vercel-storage.com/marcas/nobrand/collage-02.jpg', posX: 50, posY: 50 },
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
      { tag: 'Estrategia', title: 'Cómo armar un plan de medios que no dependa de un solo canal', excerpt: 'Ideas para repartir presupuesto entre canales sin perder foco en lo que realmente mueve el negocio.' },
      { tag: 'Producción', title: 'Contenido que se adapta a cada plataforma (no al revés)', excerpt: 'Por qué el mismo video no debería verse igual en Instagram, YouTube y TikTok.' },
      { tag: 'Tecnología', title: 'Automatizar reportes sin perder el criterio humano', excerpt: 'Dónde conviene meter IA en la medición de una campaña, y dónde todavía no.' },
    ],
  },
  footer: {
    email: 'hola@tinopartners.com',
    instagram: '@tinopartners',
    ubicacion: 'Buenos Aires, Argentina',
  },
};

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

module.exports = async function handler(req, res) {
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
      return res.status(200).json(Object.assign({}, DEFAULT_CONTENT, saved));
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
