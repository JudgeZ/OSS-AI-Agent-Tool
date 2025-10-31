REGISTRY ?= ghcr.io
OWNER ?= your-github-username
IMAGE_PREFIX ?= $(REGISTRY)/$(OWNER)/oss-ai-agent-tool
TAG ?= latest
PLATFORM ?= linux/amd64
SERVICES := apps/gateway-api services/orchestrator services/indexer services/memory-svc
RELEASE ?= oss-ai-agent-tool
NAMESPACE ?= oss-ai-agent-tool
HELM_CHART ?= charts/oss-ai-agent-tool

.PHONY: build push helm-install helm-kafka helm-rabbit

build:
	@set -e; \
	for service in $(SERVICES); do \
		name=$$(basename $$service); \
		image=$(IMAGE_PREFIX)/$$name:$(TAG); \
		echo "Building $$image"; \
		docker build --platform $(PLATFORM) -t $$image -f $$service/Dockerfile $$service; \
	done

push:
	@set -e; \
	for service in $(SERVICES); do \
		name=$$(basename $$service); \
		image=$(IMAGE_PREFIX)/$$name:$(TAG); \
		echo "Pushing $$image"; \
		docker push $$image; \
	done

helm-install:
	helm upgrade --install $(RELEASE) $(HELM_CHART) --namespace $(NAMESPACE) --create-namespace

helm-kafka:
	helm upgrade --install $(RELEASE) $(HELM_CHART) --namespace $(NAMESPACE) --create-namespace \
	  --set messaging.type=kafka --set kafka.enabled=true --set rabbitmq.enabled=false

helm-rabbit:
	helm upgrade --install $(RELEASE) $(HELM_CHART) --namespace $(NAMESPACE) --create-namespace \
	  --set messaging.type=rabbitmq --set kafka.enabled=false --set rabbitmq.enabled=true
