# use a stable node LTS
FROM node:18-alpine

# create non-root user first
RUN addgroup -S app && adduser -S -G app app

# create app dir
WORKDIR /usr/src/app

# install app dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# copy source
COPY . .

# set permissions for app user
RUN chown -R app:app /usr/src/app && \
    chmod -R 755 /usr/src/app/assets

USER app

EXPOSE 8282

# Docker metadata
LABEL org.opencontainers.image.title="Anchorr" \
      org.opencontainers.image.description="Discord bot for requesting media and Jellyfin notifications" \
      org.opencontainers.image.authors="nairdahh" \
      org.opencontainers.image.url="https://github.com/nairdahh/anchorr" \
      org.opencontainers.image.documentation="https://github.com/nairdahh/anchorr/blob/main/README.md" \
      org.opencontainers.image.source="https://github.com/nairdahh/anchorr" \
      org.opencontainers.image.version="1.2.0" \
      org.opencontainers.image.icon="https://raw.githubusercontent.com/nairdahh/anchorr/main/assets/logo.png" \
      com.example.webui="http://localhost:8282" \
      org.unraid.icon="https://raw.githubusercontent.com/nairdahh/anchorr/main/assets/logo.png" \
      webui.port="8282" \
      webui.protocol="http"

# set production mode and start app
ENV NODE_ENV=production
CMD ["node", "app.js"]
