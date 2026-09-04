#!/bin/sh
# ─────────────────────────────────────────────────────────────
# Despliegue en el VPS. Hace todo:
#   - genera el .env con ADMIN_TOKEN (si falta)
#   - construye la imagen y levanta el contenedor
#   - agrega la ruta en Caddy y recarga (con HTTPS automático)
# Es idempotente: se puede correr varias veces sin romper nada.
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

DOMAIN="tinopartners.178.105.4.83.sslip.io"
CADDY="/opt/n8n/Caddyfile"
CADDY_CONTAINER="n8n-caddy-1"

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

echo "==> [1/4] Variables de entorno"
if [ ! -f .env ]; then
  echo "ADMIN_TOKEN=Tino" > .env
  echo "    .env creado con la contraseña actual del panel."
else
  echo "    .env ya existía, se respeta."
fi

echo "==> [2/4] Construyendo imagen y levantando"
$DC up -d --build

echo "==> [3/4] Configurando ruta en Caddy"
if grep -q "$DOMAIN" "$CADDY" 2>/dev/null; then
  echo "    La ruta ya estaba en el Caddyfile, no se toca."
else
  cp "$CADDY" "$CADDY.bak.$(date +%s)"
  cat >> "$CADDY" <<EOF

$DOMAIN {
        reverse_proxy tino-partners:3000
}
EOF
  echo "    Ruta agregada (backup guardado)."
fi

echo "==> [4/4] Recargando Caddy"
docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✅ LISTO"
echo "  Abrí:      https://$DOMAIN"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Estado del contenedor:"
$DC ps
