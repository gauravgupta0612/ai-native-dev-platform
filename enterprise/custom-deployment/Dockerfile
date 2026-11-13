# Server mode image (enterprise/scalable-architecture). Build from the repository root:
#   docker build -f enterprise/custom-deployment/Dockerfile -t ai-native-platform .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY config ./config
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/data && chown app:app /app/data
USER app
EXPOSE 8787
CMD ["node", "dist/apps/desktop-ide/server.js"]
