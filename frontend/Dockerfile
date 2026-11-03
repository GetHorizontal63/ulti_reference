# ── Frontend image ────────────────────────────────────────────────────────────
# Stage 1: Vite build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# VITE_BASE defaults to / for container deploys.
# VITE_ENABLE_USAU is baked in at build time (see src/utils/features.js).
ARG VITE_BASE=/
ARG VITE_ENABLE_USAU=false
ENV VITE_BASE=$VITE_BASE \
    VITE_ENABLE_USAU=$VITE_ENABLE_USAU
RUN npm run build

# Stage 2: Nginx static serve + API proxy
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
