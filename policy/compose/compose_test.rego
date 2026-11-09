package compose_test

import rego.v1

import data.compose

good_app := {
	"build": ".",
	"user": "65532:65532",
	"read_only": true,
	"cap_drop": ["ALL"],
	"security_opt": ["no-new-privileges:true"],
	"ports": ["127.0.0.1:4000:4000"],
}

test_hardened_app_allowed if {
	count(compose.deny) == 0 with input as {"services": {"web": good_app}}
}

test_published_db_port_denied if {
	compose.deny["database service mongo must not publish ports"] with input as {"services": {"mongo": {"image": "mongo:4.4", "ports": ["127.0.0.1:27017:27017"]}}}
}

test_public_port_denied if {
	some msg in compose.deny with input as {"services": {"web": object.union(good_app, {"ports": ["4000:4000"]})}}
	contains(msg, "public interface")
}

test_privileged_denied if {
	compose.deny["service web must not be privileged"] with input as {"services": {"web": object.union(good_app, {"privileged": true})}}
}

test_root_app_denied if {
	compose.deny["app service web must run as a numeric non-root user"] with input as {"services": {"web": object.remove(good_app, ["user"])}}
}

test_docker_socket_denied if {
	compose.deny["service web must not mount the Docker socket"] with input as {"services": {"web": object.union(good_app, {"volumes": ["/var/run/docker.sock:/var/run/docker.sock"]})}}
}
