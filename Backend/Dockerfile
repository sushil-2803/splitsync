FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY Backend/package.json Backend/package.json

RUN npm ci --workspace Backend

COPY Backend Backend
RUN npm --prefix Backend run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY Backend/package.json Backend/package.json
RUN npm ci --workspace Backend --omit=dev && npm cache clean --force

COPY --from=build /app/Backend/dist Backend/dist

EXPOSE 3000

CMD ["npm", "--prefix", "Backend", "run", "start"]
