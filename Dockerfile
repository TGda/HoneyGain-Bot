FROM ghcr.io/puppeteer/puppeteer:21.3.8

# Directorio de la app
WORKDIR /honeygain-bot

# Evitar descarga de navegadores adicionales
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copiar dependencias primero (para aprovechar cache)
COPY package*.json ./

# Asegurar permisos y crear directorio de caché si no existe, luego instalar
RUN mkdir -p /home/pptruser/.npm/_cacache && \
    chown -R pptruser:pptruser /home/pptruser/.npm && \
    npm install --omit=dev --omit=optional

# Copiar tu código
COPY . .

# Entrypoint
CMD ["npm", "start"]
