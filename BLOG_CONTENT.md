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

4. Signin  to the ArgoCD UI at `http://localhost:3333` using the username `admin` and the password you copied in the previous step. Click advanced and sign in. (Insecure certificate warning)


## Deploy the App of Apps

The App of Apps pattern is a way to manage multiple applications in ArgoCD. It allows you to define a parent application that contains multiple child applications which can be deployed in a given order.

We are going to deploy the CRD for the WebApp Operator, then the Operator, then the instances of the WebApp. The Operator will manage the lifecycle of the WebApp instances and the admission controller will enforce policies on the resources created by the Operator.

```bash
kubectl apply -f k8s/app-of-apps.yaml 
```

Notice the applications are now in sync in the UI. 

Lets look at the english-light WebApp instance. 

```bash
k get wa english-light -n webapps -oyaml
```


```yaml
status:
  conditions:
  - lastTransitionTime: "2025-05-09T20:14:50.121Z"
    observedGeneration: 1
    reason: Processing
    status: Pending
  - lastTransitionTime: "2025-05-09T20:14:50.142Z"
    observedGeneration: 1
    reason: Reconciled
    status: Ready
```


We can see from the `status.conditions` that it was `Pending` and then `Ready`. This means the Operator created the resources and the admission controller enforced the policies. Similarly you could look at the events by describing the resource.

First, let's see how the webapp works.

```bash
kubectl port-forward svc/english-light -n webapps 8080:80
```

Then open a browser and go to `http://localhost:8080`. You should see the webapp running see a white background with english text. If we look at the pods we see there is a single replica.

```bash
k get pods -n webapps
```

Lets update that resource to have 5 replicas instead of 1 by editing the file `k8s/webapps/english-light.yaml` and changing the replicas from 1 to 5 and change theme to `dark`. Then, check in your changes to git. 

Give the ArgoCD server a few minutes to reconcile the changes. You can see the status of the application in the ArgoCD UI. You could manually sync the application by clicking the `Sync` button in the UI but it will eventually reconcile on its own. 

```bash
> k get po -n webapps 
NAME                            READY   STATUS    RESTARTS   AGE
english-light-9c5985d8c-hn4qh   1/1     Running   0          2m27s
english-light-9c5985d8c-nfds9   1/1     Running   0          2m27s
english-light-9c5985d8c-nrfbs   1/1     Running   0          2m27s
english-light-9c5985d8c-z8lhq   1/1     Running   0          2m26s
english-light-9c5985d8c-zjp69   1/1     Running   0          2m26s
spanish-dark-5b5d5f8849-ttnq4   1/1     Running   0          13m
```

If we describe the `english-light` webapp we can see the operator has reconciled the changes again.

```bash
Events:
  Type    Reason                    Age    From           Message
  ----    ------                    ----   ----           -------
  Normal  InstanceCreatedOrUpdated  14m    english-light  Pending
  Normal  InstanceCreatedOrUpdated  14m    english-light  Reconciled
  Normal  InstanceCreatedOrUpdated  2m59s  english-light  Pending
  Normal  InstanceCreatedOrUpdated  2m59s  english-light  Reconciled
```

The Pods that the operator is deploying are going through admission control, and the MutatingWebhook is mutating the resources to assign a container security contenxt of `allowPrivilegeEscalation: false`.

```yaml
> kubectl get pod -n webapps -l pepr.dev/operator=spanish-dark -o jsonpath="{.items[0].spec.containers[*].securityContext}"
{"allowPrivilegeEscalation":false}
```

If we try to deploy a pod running with privileged mode, the admission controller will reject the request. 

```yaml
kubectl apply -f -<<EOF
apiVersion: v1
kind: Pod
metadata:
  creationTimestamp: null
  labels:
    run: testing123
  name: testing123
spec:
  containers:
  - image: nginx
    name: testing123
    resources: {}
    securityContext:
      allowPrivilegeEscalation: true
  dnsPolicy: ClusterFirst
  restartPolicy: Always
status: {}
EOF
Error from server: error when creating "STDIN": admission webhook "pepr-pepr-with-argo.pepr.dev" denied the request: Privilege escalation is disallowed
```


## Conclusion


In summary, we have shown how to harmonize Kubernetes Admission Controllers and Operators with GitOps workflows. By clearly defining the roles of each component, we can create a cloud-native architecture that is secure, automated, and declarative by delegating the responsibilities to the appropriate components.


```bash
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
