FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy shared utilities
COPY shared/ /app/shared/

# Copy worker code
COPY worker/ /app/worker/

# Copy root-level tasks module for RQ imports
COPY tasks.py /app/tasks.py

# Install Python dependencies
COPY worker/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Set Python path
ENV PYTHONPATH=/app

# Memory limit per worker: 3GB (Whisper uses ~2GB per job)
# Run RQ worker with default queue
CMD ["rq", "worker", "--url", "redis://redis:6379", "default"]
