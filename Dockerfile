# 单容器：构建前端 + 安装 Python 依赖，由 uvicorn 同时提供 /api 与静态页面
# 构建：在项目根目录执行  docker build -t apple-tv-remote .
# 运行：docker run --rm -p 8765:8765 -v atv-data:/data apple-tv-remote

FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app

COPY backend/requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y build-essential \
    && apt-get autoremove -y --purge \
    && rm -rf /var/lib/apt/lists/*

COPY backend/main.py .
COPY backend/atv_web ./atv_web
COPY --from=frontend /src/frontend/dist ./static

ENV ATV_STATIC_DIR=/app/static
ENV PYATV_STORAGE=/data/pyatv.json

VOLUME ["/data"]
EXPOSE 8765

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]
