// Auto-generated CRD TypeScript definition
// Kind: WebApp
// Group: application
// Version: v1alpha1
// Domain: pepr.dev

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

export interface WebAppStatus {
  /*
   * Conditions describrent state
   */
  conditions?: WebAppStatusCondition[];
}

export const details = {
  plural: "webapps",
  scope: "Namespaced",
  shortName: "wa",
};

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
