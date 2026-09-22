FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock ./
COPY prisma ./prisma

ENV HUSKY=0
RUN corepack enable \
  && corepack prepare yarn@1.22.22 --activate \
  && yarn install --frozen-lockfile \
  && yarn cache clean

COPY . .
RUN yarn build

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/main"]
