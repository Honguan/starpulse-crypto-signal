FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY apps apps
COPY services services
COPY database database
COPY tests tests
RUN useradd --uid 10001 --create-home starpulse
USER starpulse
CMD ["uvicorn", "apps.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
