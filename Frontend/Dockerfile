FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_API_URL=http://localhost:3000

ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json ./
COPY Frontend/package.json Frontend/package.json

RUN npm ci --workspace Frontend

COPY Frontend Frontend
RUN npm --prefix Frontend run build

FROM nginx:1.27-alpine AS runtime

COPY Frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/Frontend/dist /usr/share/nginx/html

EXPOSE 80
