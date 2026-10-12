FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
RUN bun install --production && bunx playwright@latest install chromium --with-deps
ENV PORT=4123
EXPOSE 4123
CMD ["bun", "run", "api"]
