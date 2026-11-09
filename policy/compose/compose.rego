# Midterm gate 4 (IaC policy): Compose runtime rules for the EC2 deployment.
# Run: conftest test --policy policy/compose --namespace compose docker-compose.yml
package compose

import rego.v1

loopback_prefixes := ["127.0.0.1:", "localhost:", "[::1]:"]

is_database(svc) if contains(object.get(svc, "image", ""), "mongo")

is_app(svc) if object.get(svc, "build", null) != null

is_app(svc) if startswith(object.get(svc, "image", ""), "nodegoat")

publishes_publicly(port) if {
	is_string(port)
	count(split(port, ":")) > 1
	not startswith_any(port, loopback_prefixes)
}

publishes_publicly(port) if {
	is_string(port)
	count(split(port, ":")) == 1
}

publishes_publicly(port) if {
	is_number(port)
}

publishes_publicly(port) if {
	is_object(port)
	not object.get(port, "host_ip", "") in {"127.0.0.1", "::1"}
}

startswith_any(s, prefixes) if {
	some p in prefixes
	startswith(s, p)
}

deny contains msg if {
	some name, svc in input.services
	svc.privileged == true
	msg := sprintf("service %s must not be privileged", [name])
}

deny contains msg if {
	some name, svc in input.services
	svc.network_mode == "host"
	msg := sprintf("service %s must not use host networking", [name])
}

deny contains msg if {
	some name, svc in input.services
	is_database(svc)
	count(object.get(svc, "ports", [])) > 0
	msg := sprintf("database service %s must not publish ports", [name])
}

deny contains msg if {
	some name, svc in input.services
	some port in object.get(svc, "ports", [])
	publishes_publicly(port)
	msg := sprintf("service %s publishes %v on a public interface; bind to 127.0.0.1", [name, port])
}

deny contains msg if {
	some name, svc in input.services
	some vol in object.get(svc, "volumes", [])
	is_string(vol)
	contains(vol, "docker.sock")
	msg := sprintf("service %s must not mount the Docker socket", [name])
}

deny contains msg if {
	some name, svc in input.services
	is_app(svc)
	object.get(svc, "read_only", false) != true
	msg := sprintf("app service %s must set read_only: true", [name])
}

deny contains msg if {
	some name, svc in input.services
	is_app(svc)
	not "ALL" in object.get(svc, "cap_drop", [])
	msg := sprintf("app service %s must drop ALL capabilities", [name])
}

deny contains msg if {
	some name, svc in input.services
	is_app(svc)
	not "no-new-privileges:true" in object.get(svc, "security_opt", [])
	msg := sprintf("app service %s must set no-new-privileges:true", [name])
}

deny contains msg if {
	some name, svc in input.services
	is_app(svc)
	user := object.get(svc, "user", "")
	root_user(user)
	msg := sprintf("app service %s must run as a numeric non-root user", [name])
}

root_user(user) if user == ""

root_user(user) if startswith(sprintf("%v", [user]), "0")

root_user(user) if startswith(sprintf("%v", [user]), "root")
