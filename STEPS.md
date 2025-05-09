## Create a Pepr Module

```bash
npx pepr@latest init --name pepr-with-argo --description pepr-with-argo --uuid pepr-with-argo --errorBehavior reject --confirm
```

## Generating the CRD


Scaffold a CRD called `WebApp`:

```bash
npx pepr@latest crd create \
--group application \
--version v1alpha1 \
--kind WebApp \
--shortName wa \
--plural webapps \
--scope Namespaced 
```

Edit the `WebAppSpec` interface in `api/v1alpha1/webapp_types.ts` to add the following:

```typescript
export interface WebAppSpec {
  // INSERT ADDITIONAL SPEC FIELDS - desired state of cluster
  // Important: Run "npx pepr crd generate" to regenerate code after modifying this file

  /** 
   * Langauge of the web application (english or spanish)
   */
  Language: string;

  /** 
   * Number of replicas for the deployment
   */
  Replicas: number;

  /** 
   * Color theme of the web application (dark or light)
   */
  Theme: string;
}
```

Add the following to the `WebAppStatusCondition` type in the same file:

```typescript
export type WebAppStatusCondition = {
  /**
   * lastTransitionTime is the last time the condition transitioned from one status to another. This is not guaranteed to be set in happensBefore order across different conditions for a given object. It may be unset in some circumstances.
   */
  lastTransitionTime: Date;
  /**
   * reason contains a programmatic identifier indicating the reason for the condition's last transition. If this value is empty, it should be treated as "incomplete".
   */
  reason: string;
  /**
   * status of the condition, Pending, Ready, Failed
   */
  status: string;

  /**
   * observedGeneration represents the .metadata.generation that the condition was set based upon. For instance, if .metadata.generation is currently 12, but the .status.conditions[x].observedGeneration is 9, the condition is out of date with respect to the current state of the instance.
   */
  observedGeneration: number;
};
```

Generate the CRD, this will create the CRD in `crds` directory:

```bash
npx pepr@latest crd generate
```


Generate the TypeScript classes from the CRD so Pepr can use them:

```bash
npx pepr kfc crd crds/webapp.yaml capabilities/generated
```

Implement the controller, the logic is done for you. 

Deploy controller resources 

```yaml
kubectl apply -f -<<EOF
kind: WebApp
apiVersion: application.pepr.dev/v1alpha1
metadata:
  name: example-webapp
  namespace: default
spec:
  language: english
  replicas: 3
  theme: dark
EOF

kubectl apply -f -<<EOF
kind: WebApp
apiVersion: application.pepr.dev/v1alpha1
metadata:
  name: example-webapp
  namespace: default
spec:
  language: english
  replicas: 3
  theme: light
EOF

kubectl apply -f -<<EOF
kind: WebApp
apiVersion: application.pepr.dev/v1alpha1
metadata:
  name: a
  namespace: default
spec:
  language: english
  replicas: 1
  theme: dark
EOF
```
