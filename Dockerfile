# use a stable node LTS
FROM node:18-alpine

# create app dir
WORKDIR /usr/src/app

# install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# copy source
COPY . .

# non-root user (optional)
RUN addgroup -S app && adduser -S -G app app
USER app

EXPOSE 3000 8282

# start (use NODE_ENV=production in container)
CMD ["node", "app.js"]
