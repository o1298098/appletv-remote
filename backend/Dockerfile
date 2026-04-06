# 仅后端、无 Web UI。完整部署（前端+后端同容器）请在仓库根目录构建：
#   docker build -t apple-tv-remote .
#
FROM python:3.12-slim-bookworm

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY atv_web ./atv_web

ENV PYATV_STORAGE=/data/pyatv.json
VOLUME ["/data"]
EXPOSE 8765

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765"]
