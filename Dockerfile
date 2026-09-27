FROM node:24-alpine

WORKDIR /app
COPY package.json server.mjs scoring.js index.html site.js site.css schedule-icons.css admin.html admin.js admin.css ./
COPY data ./data
COPY 素材 ./素材

ENV PORT=3100
EXPOSE 3100
CMD ["node", "server.mjs"]
