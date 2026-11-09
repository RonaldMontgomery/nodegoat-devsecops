# Midterm gate 4 / Lab 8: workload rules checked in CI before anything reaches the cluster.
# Complements in-cluster enforcement (Restricted Pod Security + Kyverno).
# Run: conftest test --policy policy/k8s --namespace k8s k8s/
package k8s

import rego.v1

workload_kinds := {"Deployment", "StatefulSet", "DaemonSet", "Job", "ReplicaSet"}

pod_spec := input.spec.template.spec if input.kind in workload_kinds

pod_spec := input.spec if input.kind == "Pod"

containers contains c if {
	some c in pod_spec.containers
}

containers contains c if {
	some c in object.get(pod_spec, "initContainers", [])
}

name := sprintf("%s/%s", [input.kind, input.metadata.name])

deny contains msg if {
	some c in containers
	object.get(c, ["securityContext", "privileged"], false) == true
	msg := sprintf("%s: container %s must not be privileged", [name, c.name])
}

deny contains msg if {
	some c in containers
	object.get(c, ["securityContext", "allowPrivilegeEscalation"], true) != false
	msg := sprintf("%s: container %s must set allowPrivilegeEscalation: false", [name, c.name])
}

deny contains msg if {
	some c in containers
	not "ALL" in object.get(c, ["securityContext", "capabilities", "drop"], [])
	msg := sprintf("%s: container %s must drop ALL capabilities", [name, c.name])
}

deny contains msg if {
	some c in containers
	object.get(c, ["securityContext", "runAsNonRoot"], object.get(pod_spec, ["securityContext", "runAsNonRoot"], false)) != true
	msg := sprintf("%s: container %s must run as non-root", [name, c.name])
}

deny contains msg if {
	some c in containers
	some resource in ["cpu", "memory"]
	object.get(c, ["resources", "limits", resource], null) == null
	msg := sprintf("%s: container %s must set a %s limit", [name, c.name, resource])
}

deny contains msg if {
	some field in ["hostNetwork", "hostPID", "hostIPC"]
	object.get(pod_spec, field, false) == true
	msg := sprintf("%s: %s is not allowed", [name, field])
}

deny contains msg if {
	input.kind == "Service"
	input.spec.type in {"NodePort", "LoadBalancer"}
	msg := sprintf("%s: type %s exposes the service outside the cluster; use ClusterIP", [name, input.spec.type])
}
