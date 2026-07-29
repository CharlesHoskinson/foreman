#!/usr/bin/env bats

@test "ordinary pass" {
  true
}

@test "reasoned skip is auditable" {
  skip "requires fixture capability; install with fixture-setup"
}
