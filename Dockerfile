FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3006

COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/middleware ./middleware
COPY --from=build /app/routes ./routes
COPY --from=build /app/services ./services
COPY --from=build /app/utils ./utils
COPY --from=build /app/types ./types
COPY --from=build /app/lib ./lib
COPY --from=build /app/components/types.ts ./components/types.ts
COPY --from=build /app/tsconfig.server.json ./tsconfig.server.json

EXPOSE 3006

CMD ["npm", "start"]
