# Custom policy for the EC2 deployment (infra/deploy.tf), evaluated against
# `terraform show -json tfplan` alongside the S3 tag policy.
# - instances require IMDSv2 with a hop limit of 1 (containers cannot reach
#   instance credentials; defence in depth behind the SSRF fix)
# - instance root volumes are encrypted
# - the app host accepts no inbound traffic: no ingress on its security groups,
#   no separate ingress rule resources, no SSH key pair
package terraform.ec2

import rego.v1

changed(type) := [rc |
	some rc in input.resource_changes
	rc.type == type
	some action in rc.change.actions
	action in {"create", "update"}
]

deny contains msg if {
	some rc in changed("aws_instance")
	not imdsv2_hop_limit_one(rc.change.after)
	msg := sprintf("%s must require IMDSv2 (http_tokens = required) with http_put_response_hop_limit = 1", [rc.address])
}

deny contains msg if {
	some rc in changed("aws_instance")
	not root_volume_encrypted(rc.change.after)
	msg := sprintf("%s must encrypt its root volume", [rc.address])
}

deny contains msg if {
	some rc in changed("aws_instance")
	key := object.get(rc.change.after, "key_name", null)
	is_string(key)
	key != ""
	msg := sprintf("%s must not have an SSH key pair; use SSM", [rc.address])
}

deny contains msg if {
	some type in {"aws_security_group", "aws_default_security_group"}
	some rc in changed(type)
	count(object.get(rc.change.after, "ingress", [])) > 0
	msg := sprintf("%s must not allow inbound traffic", [rc.address])
}

deny contains msg if {
	some type in {"aws_vpc_security_group_ingress_rule", "aws_security_group_rule"}
	some rc in changed(type)
	object.get(rc.change.after, "type", "ingress") == "ingress"
	msg := sprintf("%s: inbound rules are not allowed", [rc.address])
}

imdsv2_hop_limit_one(after) if {
	some opts in object.get(after, "metadata_options", [])
	opts.http_tokens == "required"
	opts.http_put_response_hop_limit == 1
}

root_volume_encrypted(after) if {
	some vol in object.get(after, "root_block_device", [])
	vol.encrypted == true
}
