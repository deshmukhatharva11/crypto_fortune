# Build Stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies strictly
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Production Stage
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production --legacy-peer-deps

# Copy built artifacts from builder stage (if build step existed, here just copy src)
COPY --from=builder /app/server ./server
COPY --from=builder /app/contracts ./contracts
COPY --from=builder /app/admin ./admin
COPY --from=builder /app/index.html .
COPY --from=builder /app/.env.example .
# Copy other necessary files
COPY --from=builder /app/script.js .
COPY --from=builder /app/style.css .
COPY --from=builder /app/*.png .
COPY --from=builder /app/*.svg .
COPY --from=builder /app/*.ico .

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]
