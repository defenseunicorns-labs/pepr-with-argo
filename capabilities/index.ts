import { Capability, Log, a, sdk, K8s } from "pepr";
import { WebApp, Status, Condition } from "./generated/webapp-v1alpha1";
import Deploy from "./controller/generators";

export const WebAppController = new Capability({
  name: "webapp-controller",
  description: "A Kubernetes Operator that manages WebApps",
});

const { When } = WebAppController;
const { writeEvent, containers } = sdk;

/**
 * This binding ensures that WebApps deployed in the cluster are validated and reconciled.
 *
 * The Mutate function sets the `pepr.dev/latest-admission-pass` annotation to the current date and time
 * or skips the mutation if the status is "Pending".
 *
 * The Validate function checks the spec fields of the WebApp instance:
 * - `language` must be either "english" or "spanish"
 * - `replicas` must be greater than 0
 * - `theme` must be either "dark" or "light"
 * or skips the validation if the status is "Pending".
 *
 * The Reconcile function checks if the instance is already being processed and if the generation has changed.
 * If so, it marks the instance as "Pending" and deploys the underlying resources.
 * If the deployment is successful, it updates the status to "Ready".
 * If the deployment fails, it marks the status as "Failed".
 * It writes events and updates the status to the instance to indicate the state of the reconciliation process.
 */
When(WebApp)
  .IsCreatedOrUpdated()
  .Mutate(wa => {
    // check if pending - if so pass through
    const conditions = wa.Raw.status?.conditions || [];
    if (conditions[conditions.length - 1]?.status === "Pending") {
      return;
    }
    wa.SetAnnotation("pepr.dev/latest-admission-pass", new Date().toISOString());
  })
  .Validate(wa => {
    // check if pending - if so pass through
    const conditions = wa.Raw.status?.conditions || [];
    if (conditions[conditions.length - 1]?.status === "Pending") {
      return wa.Approve();
    }

    const { language, replicas, theme } = wa.Raw.spec;
    const warnings: string[] = [];

    if (!["english", "spanish"].includes(language)) {
      warnings.push("language must be either 'english' or 'spanish'");
    }
    if (replicas < 1) {
      warnings.push("replicas must be greater than 0");
    }
    if (!["dark", "light"].includes(theme)) {
      warnings.push("theme must be either 'dark' or 'light'");
    }

    if (warnings.length > 0) {
      return wa.Deny("Spec field is incorrect", 422, warnings);
    }

    return wa.Approve();
  })
  .Reconcile(async instance => {
    // Kubernetes will change the generation of the instance when the spec changes
    const generation = instance.metadata?.generation;
    // The observedGeneration is the generation of the instance that was last processed
    const observedGeneration =
      instance.status?.conditions?.[instance.status?.conditions.length - 1].observedGeneration;

    // check if the instance is already being processed
    const latestCondition = instance.status?.conditions[instance.status?.conditions.length - 1] || {
      status: "",
      reason: "",
    };
    const isPending =
      latestCondition.status === "Pending" || latestCondition.reason === "Processing";

    // We should deploy is something in the spec changes and it is not already being processed
    const shouldDeploy = generation !== observedGeneration && !isPending;

    if (!shouldDeploy) {
      Log.debug(
        `Skipping reconcile for ${instance.metadata?.name}, generation has not changed or is pending.`,
      );
      return;
    }

    // Mark as Pending for while underlying resources are being deployed
    const conditions = getConditions(instance);
    conditions.push({
      observedGeneration: generation,
      lastTransitionTime: new Date(),
      reason: "Processing",
      status: "Pending",
    });
    // Update status to Pending
    await updateStatus(instance, { conditions });

    // Write event to indicate that the instance is being processed
    await writeEvent(
      instance,
      { message: "Pending" },
      {
        eventType: "Normal",
        eventReason: "InstanceCreatedOrUpdated",
        reportingComponent: instance.metadata.name,
        reportingInstance: instance.metadata.name,
      },
    );

    try {
      // Deploy underlying resources
      await Deploy(instance);

      // Update status to Ready
      conditions.push({
        observedGeneration: generation,
        lastTransitionTime: new Date(),
        reason: "Reconciled",
        status: "Ready",
      });

      // Update status to Ready
      await updateStatus(instance, { conditions });

      // Write event to indicate that the instance is ready
      await writeEvent(
        instance,
        { message: "Reconciled" },
        {
          eventType: "Normal",
          eventReason: "InstanceCreatedOrUpdated",
          reportingComponent: instance.metadata.name,
          reportingInstance: instance.metadata.name,
        },
      );
    } catch (err) {
      Log.error(`Deployment failed for ${instance.metadata?.name}: ${err}`);

      // Mark status as failed
      conditions.push({
        observedGeneration:
          instance.status?.conditions?.[instance.status?.conditions?.length].observedGeneration,
        lastTransitionTime: new Date(),
        reason: "Could not reconcile",
        status: "Failed",
      });

      // Update status to Failed
      await updateStatus(instance, instance.status);

      // Write event to indicate that the instance failed
      await writeEvent(
        instance,
        { message: "Failed" },
        {
          eventType: "Normal",
          eventReason: "InstanceCreatedOrUpdated",
          reportingComponent: instance.metadata.name,
          reportingInstance: instance.metadata.name,
        },
      );
    }
  });

/**
 * This policy ensures that Pods do not allow privilege escalation.
 *
 * The `allowPrivilegeEscalation` field in a container's security context should either be undefined
 * or set to `false` to prevent potential security vulnerabilities.
 *
 * Running containers in privileged mode disables many security mechanisms and grants extensive
 * access to host resources, which can lead to security breaches.
 *
 * @related https://repo1.dso.mil/big-bang/product/packages/kyverno-policies/-/blob/main/chart/templates/disallow-privilege-escalation.yaml
 * @related https://repo1.dso.mil/big-bang/product/packages/kyverno-policies/-/blob/main/chart/templates/disallow-privileged-containers.yaml
 */
When(a.Pod)
  .IsCreatedOrUpdated()
  .Mutate(request => {
    // Check if any containers defined in the pod do not have the `allowPrivilegeEscalation` field present. If not, include it and set to false.
    for (const container of containers(request)) {
      container.securityContext = container.securityContext || {};
      const mutateCriteria = [
        container.securityContext.allowPrivilegeEscalation === undefined,
        !container.securityContext.privileged,
        !container.securityContext.capabilities?.add?.includes("CAP_SYS_ADMIN"),
      ];
      // We are only mutating if the conditions above are all satisfied
      if (mutateCriteria.every(priv => priv === true)) {
        container.securityContext.allowPrivilegeEscalation = false;
      }
    }
  })
  .Validate(request => {
    const violations = containers(request).filter(
      // Checking if allowPrivilegeEscalation is undefined. If yes, fallback to true as the default behavior in k8s is to allow if undefined.
      // Checks the three different ways a container could escalate to admin privs
      c => (c.securityContext.allowPrivilegeEscalation ?? true) || c.securityContext.privileged,
    );

    if (violations.length) {
      return request.Deny("Privilege escalation is disallowed", 403);
    }

    return request.Approve();
  });

/**
 * Updates the status of the instance
 *
 * @param instance The instance to update
 * @param status The new status
 */
async function updateStatus(instance: WebApp, status: Status) {
  try {
    await K8s(WebApp).PatchStatus({
      metadata: {
        name: instance.metadata!.name,
        namespace: instance.metadata!.namespace,
      },
      status,
    });
  } catch (err) {
    Log.error(`Failed to update status for ${instance.metadata?.name}: ${err}`);
  }
}

/**
 * Gets the conditions of the instance
 *
 * @param instance The instance to get the conditions from
 * @returns The conditions of the instance
 */
export function getConditions(instance: WebApp): Condition[] {
  return instance.status?.conditions || [];
}
