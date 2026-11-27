package terraform.ec2_test

import rego.v1

import data.terraform.ec2

plan(type, after) := {"resource_changes": [{
	"address": sprintf("%s.test", [type]),
	"type": type,
	"change": {"actions": ["create"], "after": after},
}]}

good_instance := {
	"metadata_options": [{"http_tokens": "required", "http_put_response_hop_limit": 1}],
	"root_block_device": [{"encrypted": true}],
	"key_name": null,
}

test_hardened_instance_allowed if {
	count(ec2.deny) == 0 with input as plan("aws_instance", good_instance)
}

test_imdsv1_denied if {
	after := object.union(good_instance, {"metadata_options": [{"http_tokens": "optional", "http_put_response_hop_limit": 1}]})
	count(ec2.deny) == 1 with input as plan("aws_instance", after)
}

test_hop_limit_two_denied if {
	after := object.union(good_instance, {"metadata_options": [{"http_tokens": "required", "http_put_response_hop_limit": 2}]})
	count(ec2.deny) == 1 with input as plan("aws_instance", after)
}

test_missing_metadata_options_denied if {
	after := object.remove(good_instance, ["metadata_options"])
	count(ec2.deny) == 1 with input as plan("aws_instance", after)
}

test_unencrypted_root_denied if {
	after := object.union(good_instance, {"root_block_device": [{"encrypted": false}]})
	count(ec2.deny) == 1 with input as plan("aws_instance", after)
}

test_ssh_key_denied if {
	after := object.union(good_instance, {"key_name": "my-key"})
	count(ec2.deny) == 1 with input as plan("aws_instance", after)
}

test_egress_only_security_group_allowed if {
	count(ec2.deny) == 0 with input as plan("aws_security_group", {"ingress": [], "egress": [{"from_port": 443}]})
}

test_ingress_security_group_denied if {
	count(ec2.deny) == 1 with input as plan("aws_security_group", {"ingress": [{"from_port": 22, "cidr_blocks": ["0.0.0.0/0"]}]})
}

test_separate_ingress_rule_denied if {
	count(ec2.deny) == 1 with input as plan("aws_vpc_security_group_ingress_rule", {"from_port": 22})
}

test_legacy_ingress_rule_denied if {
	count(ec2.deny) == 1 with input as plan("aws_security_group_rule", {"type": "ingress", "from_port": 22})
}

test_legacy_egress_rule_allowed if {
	count(ec2.deny) == 0 with input as plan("aws_security_group_rule", {"type": "egress", "from_port": 443})
}

test_delete_ignored if {
	count(ec2.deny) == 0 with input as {"resource_changes": [{
		"address": "aws_instance.old",
		"type": "aws_instance",
		"change": {"actions": ["delete"], "after": null},
	}]}
}
