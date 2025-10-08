export PROJECT_ID=ffxiv-simulation           # or your project
export REGION=asia-northeast3                # Seoul (pick what you want)
export CLUSTER=kf-gke
export NETWORK=kf-vpc
export SUBNET=kf-subnet

gcloud config set project $PROJECT_ID

gcloud services enable \
  container.googleapis.com compute.googleapis.com iam.googleapis.com \
  iap.googleapis.com cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com


gcloud compute networks create $NETWORK --subnet-mode=custom
gcloud compute networks subnets create $SUBNET \
  --network $NETWORK --region $REGION --range 10.0.0.0/20
gcloud compute routers create ${NETWORK}-cr --network $NETWORK --region $REGION
gcloud compute routers nats create ${NETWORK}-nat \
  --router ${NETWORK}-cr --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges


  gcloud container clusters create $CLUSTER \
  --region $REGION \
  --release-channel regular \
  --machine-type n2-standard-8 \
  --num-nodes 3 \
  --workload-pool=${PROJECT_ID}.svc.id.goog \
  --network $NETWORK --subnetwork $SUBNET \
  --enable-ip-alias

git clone https://github.com/kubeflow/manifests
cd manifests

# Easiest: install everything from the example kustomization
# (retries until CRDs are ready)
while ! kustomize build example | kubectl apply --server-side --force-conflicts -f -; do \
  echo "Retrying..."; sleep 20; done

  kubectl -n istio-system get svc istio-ingressgateway


kubectl -n kubeflow get cm workflow-controller-configmap -o yaml | grep -i executor


do {
    & kustomize build example | kubectl apply --server-side --force-conflicts -f -
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Retrying..."
        Start-Sleep -Seconds 20
    }
} while ($LASTEXITCODE -ne 0)