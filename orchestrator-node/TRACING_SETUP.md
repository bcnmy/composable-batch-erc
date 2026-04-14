# OpenTelemetry Tracing Setup

This guide covers both local development and production Grafana Cloud integration for OpenTelemetry tracing.

## 🚀 Local Development Setup

### Prerequisites
- Docker and Docker Compose
- Node.js application running

### 1. Start Observability Stack

```bash
# Start Jaeger for trace collection and UI
docker-compose -f docker-compose.observability.yml up -d

# Verify services are running
docker-compose -f docker-compose.observability.yml ps
```

### 2. Configure Application Environment

```bash
# Set OpenTelemetry environment variables
export OTEL_TRACE_ENABLED=true
export OTEL_SERVICE_NAME=mee-node
export OTEL_ENV=development
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### 3. Start Your Application

```bash
# Start your application with tracing enabled
bun run start
```

### 4. Generate Traces

Make API requests to generate traces:
```bash
# Example API calls
curl -X GET http://localhost:3000/v1/info
```

### 5. View Traces

**Jaeger UI**: http://localhost:16686
- Search for service: `mee-node`
- View trace details, spans, and timing
- Analyze latency and dependencies

## ☁️ Grafana Cloud Integration

### 1. Add Tempo Data Source

1. Go to your Grafana Cloud instance
2. **Configuration → Data Sources → Add data source**
3. **Select "Tempo"**
4. **URL**: `https://tempo-prod-us-central1.grafana.net:443` (or your Tempo endpoint)
5. **Authentication**: Use your Grafana Cloud credentials
6. **Save & Test**

### 2. Update Application Configuration

For production, update your environment variables:

```bash
# Production OpenTelemetry configuration
export OTEL_TRACE_ENABLED=true
export OTEL_SERVICE_NAME=mee-node
export OTEL_ENV=production
export OTEL_EXPORTER_OTLP_ENDPOINT=https://tempo-prod-us-central1.grafana.net:443
export OTEL_EXPORTER_OTLP_HEADERS='{"Authorization": "Basic <your-tempo-credentials>"}'
```

### 3. Import Latency Dashboard

1. **Dashboards → Import**
2. **Upload JSON**: Use `dashboards/api-performance.json`
3. **Select Tempo data source**
4. **Import**

### 4. Dashboard Features

The latency dashboard includes:
- **Request Rate** - RPS from traces
- **Latency Percentiles** - P50, P90, P99
- **Error Rate** - Error percentage
- **Business Logic Latency** - Custom operations:
  - `api.quote`
  - `api.quote-permit`
  - `api.exec`
  - `api.info`
  - `api.explorer`
  - `gasEstimator`
  - `executor`
  - `simulator`
  - `debugTraceCall`
  - `ethCall`
  - `paymentServiceProviders`
- **Service Map** - Automatic dependency visualization

## 🔧 Kubernetes Deployment

### Environment Variables

Add to your Kubernetes values files:

```yaml
# k8s/values.staging.yaml & k8s/values.prod.yaml
opentelemetry:
  enable: true
  serviceName: mee-node
  env: staging  # or production
  exporterEndpoint: "https://tempo-prod-us-central1.grafana.net:443"
  exporterHeaders: '{"Authorization": "Basic <your-credentials>"}'
```

### Deployment Template

The deployment template automatically includes OpenTelemetry environment variables when enabled.

## 🛠️ Troubleshooting

### No Traces Appearing
1. Check environment variables are set
2. Verify Jaeger is running: `docker-compose -f docker-compose.observability.yml ps`
3. Check application logs for OpenTelemetry initialization
4. Ensure API requests are being made

### Jaeger UI Not Loading
1. Check Jaeger is accessible: `curl http://localhost:16686`
2. Verify port 16686 is not blocked
3. Restart services: `docker-compose -f docker-compose.observability.yml restart`

### Grafana Cloud Issues
1. Verify Tempo data source connection
2. Check authentication credentials
3. Ensure OTLP endpoint is correct
4. Verify network connectivity to Grafana Cloud

## 📝 Notes

- **Local Development**: Uses Jaeger for trace collection and UI
- **Production**: Uses Grafana Cloud Tempo for trace storage
- **Dashboard**: Pre-configured for your specific operations
- **Versioning**: Dashboard is versioned in `dashboards/api-performance.json`
