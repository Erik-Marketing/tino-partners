# Imagen para correr Tino Partners en el VPS (dentro de Docker, igual que
# el resto de los proyectos en esta máquina).
FROM node:24-alpine

# ffmpeg para comprimir los videos que se suben por el panel (Alpine's
# ffmpeg ya trae libx264/AAC — verificado antes de agregar esto).
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Escucha en todas las interfaces para que Caddy lo alcance por el nombre
# del servicio en la red de Docker.
CMD ["node", "server.js"]
