# Crypto Fortune — Docker Deployment Guide

## Prerequisites
- Docker Desktop installed and running.

> **Note:** All host ports are remapped to avoid conflicts with an existing deployment
> on the same server (Nginx:80, Backend:3000, Postgres:5432, PgBouncer:6432, Redis:6379, PgAdmin:5050).

## Port Mapping Summary

| Service    | Container Port | Host Port      | Binding       |
|------------|---------------|----------------|---------------|
| Nginx      | 80            | **8080**       | 127.0.0.1     |
| Backend    | 3000          | **3001**       | 127.0.0.1     |
| PostgreSQL | 5432          | **5433**       | 127.0.0.1     |
| PgBouncer  | 5432          | **6433**       | 127.0.0.1     |
| Redis      | 6379          | **6380**       | 127.0.0.1     |
| PgAdmin    | 80            | **5051**       | 127.0.0.1     |

All services are bound to `127.0.0.1` — no ports are exposed publicly.

## Quick Start
1. **Start the System**
   ```bash
   docker-compose up -d --build
   ```
   This will start:
   - Nginx reverse proxy (localhost:8080)
   - Backend API (localhost:3001)
   - PostgreSQL Database (localhost:5433)
   - PgBouncer connection pooler (localhost:6433)
   - Redis cache (localhost:6380)
   - PGAdmin Interface (localhost:5051)

2. **Initialize Database**
   Since the backend runs automatically, we need to run the initialization script *inside* the container once:
   ```bash
   docker exec -it cf-backend node server/init-db.js
   ```

3. **Access Services**
   - **Frontend (via Nginx)**: [http://localhost:8080](http://localhost:8080)
   - **Backend API (direct)**: [http://localhost:3001](http://localhost:3001)
   - **Admin Panel**: [http://localhost:8080/admin/admin.html](http://localhost:8080/admin/admin.html)
   - **PGAdmin**: [http://localhost:5051](http://localhost:5051)
     - Login: `admin@cryptofortune.live` / (your PGADMIN_PASSWORD)
     - Connect to Server: Use host `postgres`, port `5432`

## Troubleshooting
- **Rebuild**: `docker-compose up -d --build`
- **Logs**: `docker-compose logs -f`
- **Stop**: `docker-compose down`
- **Clean Start**: `docker-compose down -v` (Deletes database data!)
