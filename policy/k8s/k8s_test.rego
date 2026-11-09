package k8s_test

import rego.v1

import data.k8s

good_container := {
	"name": "app",
	"securityContext": {"allowPrivilegeEscalation": false, "capabilities": {"drop": ["ALL"]}},
	"resources": {"limits": {"cpu": "500m", "memory": "256Mi"}},
}

deployment(container, pod_extra) := {
	"kind": "Deployment",
	"metadata": {"name": "app"},
	"spec": {"template": {"spec": object.union(
		{"securityContext": {"runAsNonRoot": true}, "containers": [container]},
		pod_extra,
	)}},
}

test_compliant_deployment_allowed if {
	count(k8s.deny) == 0 with input as deployment(good_container, {})
}

test_privileged_denied if {
	c := object.union(good_container, {"securityContext": {"privileged": true, "allowPrivilegeEscalation": false, "capabilities": {"drop": ["ALL"]}}})
	k8s.deny["Deployment/app: container app must not be privileged"] with input as deployment(c, {})
}

test_missing_limits_denied if {
	k8s.deny["Deployment/app: container app must set a memory limit"] with input as deployment(object.remove(good_container, ["resources"]), {})
}

test_root_denied if {
	k8s.deny["Deployment/app: container app must run as non-root"] with input as deployment(good_container, {"securityContext": {"runAsNonRoot": false}})
}

test_host_network_denied if {
	k8s.deny["Deployment/app: hostNetwork is not allowed"] with input as deployment(good_container, {"hostNetwork": true})
}

test_nodeport_denied if {
	count(k8s.deny) == 1 with input as {"kind": "Service", "metadata": {"name": "app"}, "spec": {"type": "NodePort"}}
}
