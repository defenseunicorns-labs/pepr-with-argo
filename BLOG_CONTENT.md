# Harmonizing Kubernetes Admission Controllers/Operators with GitOps Workflows

## Introduction

A clear delineation of responsibilities is essential to a successful cloud-native architecture. By intentionally structuring your infrastructure, you create harmony across the cluster—allowing purpose-built services to handle specific tasks, while your applications stay focused on delivering value to users.

In this blog post, we will explore how to harmonize Kubernetes Admission Controllers and Operators with GitOps workflows. We will discuss the benefits of this approach, when to leverage this approach and when not to.

We are going to use a WebApp Operator written in [Pepr](https://github.com/defenseunicorns/pepr) which has an admission controller to enforce global security posture and the Operator manages the lifecycle of the application and its configuration ensuring the underlying resources are deployed and configured correctly. We will use ArgoCD as our GitOps tool to manage the deployment and ordering of deployment of our webapp instances.

Since we our GitOps tooling is is focused on high level abstracts of our app, we do not have to worry about the admission controller and GitOps server fighting over the same resources. We will clearly define the boundaries of the GitOps server and when it should reconcile.

- **Role of the Operator**: Deploy and manage the lifecycle/configuration of the application, reduce human error and manual configuration. This is the automation piece. 
- **Role of Admission Controller**: Enforce policies and security controls at the cluster level, ensuring that only compliant resources are deployed. Keep configuration simple and consistent across resources. This is the security piece.
- **Role of GitOps**: Provide a single source of truth for your application and infrastructure, allowing you to manage the entire lifecycle of your application from development to production. This is the declarative piece.

## Setup ArgoCD

1. Install ArgoCD in your cluster. You can follow the [official documentation](https://argo-cd.readthedocs.io/en/stable/getting_started/) for installation instructions.

```bash
k3d cluster delete --all
k3d cluster create; 
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

kubectl -n argocd patch configmap argocd-cm --type merge -p '{
  "data": {
    "resource.customizations.health.apiextensions.k8s.io_CustomResourceDefinition": "hs = {}\nif obj.status ~= nil and obj.status.conditions ~= nil then\n  for _, condition in ipairs(obj.status.conditions) do\n    if condition.type == \"Established\" and condition.status == \"True\" then\n      hs.status = \"Healthy\"\n      hs.message = \"CRD is established\"\n      return hs\n    end\n  end\nend\nhs.status = \"Progressing\"\nhs.message = \"Waiting for CRD to be established\"\nreturn hs"
  }
}'
k rollout restart deployment -n argocd
```

2. Port-forward the argocd-server service to access the ArgoCD UI.

```bash
kubectl port-forward svc/argocd-server -n argocd 3333:80 
```

3. Get the initial admin password.

```bash
kubectl get secret argocd-initial-admin-secret -n argocd -ojsonpath="{.data.password}" | base64 -d | pbcopy
```

4. Signin  to the ArgoCD UI at `http://localhost:3333` using the username `admin` and the password you copied in the previous step.



Quick Cleanup:
```bash
k delete -f k8s/app-of-apps.yaml   
k delete po -n pepr-system --all --force && k delete -f k8s/controller
k delete -f k8s/webapps 
k delete -f k8s/crds
k delete ns webapps 
k delete applications -n argocd --all
k delete crd webapps.application.pepr.dev 

kubectl -n argocd rollout restart deployment argocd-repo-server
kubectl -n argocd rollout restart deployment argocd-application-controller

k apply -f k8s/app-of-apps.yaml 
```
