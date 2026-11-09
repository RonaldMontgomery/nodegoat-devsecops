# Lab 7 custom policy, evaluated against `terraform show -json tfplan`.
# Every S3 bucket create or update must carry a nonempty Project tag,
# set directly or inherited from provider default_tags (tags_all).
package terraform.s3

import rego.v1

bucket_changes contains rc if {
	some rc in input.resource_changes
	rc.type == "aws_s3_bucket"
	some action in rc.change.actions
	action in {"create", "update"}
}

tag_value(after, field) := value if {
	tags := object.get(after, field, null)
	is_object(tags)
	value := object.get(tags, "Project", "")
	is_string(value)
}

has_project_tag(after) if trim_space(tag_value(after, "tags")) != ""

has_project_tag(after) if trim_space(tag_value(after, "tags_all")) != ""

deny contains msg if {
	some rc in bucket_changes
	not has_project_tag(rc.change.after)
	msg := sprintf("%s must have a nonempty Project tag", [rc.address])
}
