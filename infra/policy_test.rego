package terraform.s3_test

import rego.v1

import data.terraform.s3

plan(actions, after) := {"resource_changes": [{
	"address": "aws_s3_bucket.evidence",
	"type": "aws_s3_bucket",
	"change": {"actions": actions, "after": after},
}]}

test_direct_tag_allowed if {
	count(s3.deny) == 0 with input as plan(["create"], {"tags": {"Project": "DevSecOps-NodeGoat"}})
}

test_default_tag_allowed if {
	count(s3.deny) == 0 with input as plan(["create"], {"tags": null, "tags_all": {"Project": "DevSecOps-NodeGoat"}})
}

test_missing_tag_denied if {
	count(s3.deny) == 1 with input as plan(["create"], {"tags": {"Owner": "RonaldMontgomery"}, "tags_all": {}})
}

test_blank_tag_denied_on_update if {
	count(s3.deny) == 1 with input as plan(["update"], {"tags": {"Project": "  "}, "tags_all": {"Project": "  "}})
}

test_delete_ignored if {
	count(s3.deny) == 0 with input as plan(["delete"], null)
}
