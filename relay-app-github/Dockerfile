FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
# Railway provides PORT; app reads process.env.PORT
CMD ["node","server.js"]
