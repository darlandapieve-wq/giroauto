FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3333
# menos arenas do malloc da glibc: evita a RSS crescer em degraus com o sharp/libvips (ver src/memoria.js)
ENV MALLOC_ARENA_MAX=2
# v2.23: FFmpeg para o "Gerar vídeo" do carro (pacote do Debian)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
COPY assets ./assets
COPY extension ./extension
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings=ExperimentalWarning", "src/start.js"]
