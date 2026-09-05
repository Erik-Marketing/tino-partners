#!/bin/sh
# ─────────────────────────────────────────────────────────────
# Despliegue en el VPS. Hace todo:
#   - genera el .env con ADMIN_TOKEN (si falta)
#   - construye la imagen y levanta el contenedor
#   - recarga Caddy (la ruta de tinopartners.com se agregó a mano una
#     sola vez, con el bloque cloudflare_only — este script solo avisa
#     si no la encuentra, nunca la agrega ni la toca)
# Es idempotente: se puede correr varias veces sin romper nada.
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

DOMAIN="tinopartners.com"
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

echo "==> [3/4] Verificando ruta en Caddy"
if grep -q "$DOMAIN" "$CADDY" 2>/dev/null; then
  echo "    La ruta ya está en el Caddyfile, no se toca."
else
  echo "    ATENCIÓN: no encontré $DOMAIN en el Caddyfile."
  echo "    Este script ya no la agrega solo (necesita el bloque"
  echo "    'import cloudflare_only' a mano) — revisar manualmente."
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
