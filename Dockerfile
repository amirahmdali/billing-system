FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 DB_PATH=/data/business.sqlite
COPY package.json db.js server.js ./
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
