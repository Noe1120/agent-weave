"""Read-only checks for P0 design preparation; never runs clients or product tests."""

import argparse
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class P0ReadinessTests(unittest.TestCase):
    def test_generated_report_uses_portable_lf_bytes(self):
        report = (ROOT / "verification-report.json").read_bytes()
        self.assertEqual(report.count(b"\r"), 0, "Report writer must not translate LF to CRLF")
        self.assertTrue(report.endswith(b"\n"))
        self.assertIsInstance(json.loads(report.decode("utf-8")), dict)

    def text(self, relative):
        path = ROOT / relative
        self.assertTrue(path.is_file(), f"Missing design material: {relative}")
        return path.read_text(encoding="utf-8-sig")

    def load(self, relative):
        return json.loads(self.text(relative))

    def manifest(self):
        return self.load("validation/p0-probe-manifest.json")

    def pf04(self):
        cases = self.load("validation/protocol-fixtures.json")["cases"]
        return next(case for case in cases if case["id"] == "PF-04")

    def test_readme_has_one_authoritative_reading_order(self):
        text = self.text("README.md")
        self.assertIn("阅读顺序以《项目交接说明》§4.1 为唯一入口", text)
        self.assertNotIn("推荐顺序：本页 →", text)

    def test_core_unknown_fields_are_explicitly_strict(self):
        text = self.text("04-reliability-security-operations.md")
        self.assertIn("core/1.0 严格拒绝未知字段、未知版本和未知枚举", text)
        self.assertIn("其他协议仅在其显式版本协商规则允许时", text)

    def test_pf04_state_is_a_core_enum_value(self):
        schema = self.load("contracts/core.schema.json")
        states = schema["$defs"]["plan_progress"]["properties"]["lifecycle"]["enum"]
        state = self.pf04()["expected"]["db_assertions"]["plan.lifecycle"]
        self.assertIn(state, states)
        self.assertEqual(state, "stopping")

    def test_pf04_temporal_barrier_preserves_stop_requirements(self):
        case = self.pf04()
        self.assertEqual(case["fixture_revision"], "2")
        assertions = case["expected"].get("temporal_assertions", [])
        self.assertIn({
            "subject": "plan.lifecycle",
            "must_remain": "stopping",
            "until_all": [
                "inflight_permits_reconciled",
                "process_tree_and_open_handles_reconciled",
                "write_capabilities_revoked",
                "journal_and_files_reconciled",
            ],
            "forbidden_before_all": ["closed", "new_writer_epoch"],
            "after_all": "closure_requires_all_plan_obligations_reconciled",
        }, assertions)
        self.assertEqual(case["status"], "NOT_RUN")
        self.assertIsNone(case["actual"])

    def test_probe_manifest_is_non_executing_and_unauthorized(self):
        data = self.manifest()
        self.assertEqual(data["kind"], "declarative_probe_plan_not_executor")
        self.assertEqual(data["status"], "NOT_RUN")
        policy = data["execution_policy"]
        for name in ("automatic_execution", "agent_launch_authorized",
                     "model_calls_authorized", "system_changes_authorized",
                     "data_egress_authorized"):
            self.assertIs(policy[name], False, name)
        self.assertIsNone(policy["authorization_ref"])
        self.assertIsNone(policy["budget_limit"])
        self.assertEqual(data["contract_freeze_status"], "NOT_FROZEN")

    def test_probe_ids_and_dependencies_are_complete_and_acyclic(self):
        probes = self.manifest()["probes"]
        by_id = {probe["id"]: probe for probe in probes}
        self.assertEqual(len(probes), 16)
        self.assertEqual(set(by_id), {f"P0-{n:02d}" for n in range(1, 17)})
        remaining = set(by_id)
        done = set()
        while remaining:
            ready = {key for key in remaining if set(by_id[key]["depends_on"]) <= done}
            self.assertTrue(ready, f"Unknown dependency or cycle: {sorted(remaining)}")
            remaining -= ready
            done |= ready

    def test_probe_steps_oracles_and_evidence_are_not_placeholders(self):
        data = self.manifest()
        prerequisites = {item["id"] for item in data["prerequisites"]}
        for probe in data["probes"]:
            with self.subTest(probe=probe["id"]):
                for field in ("targets", "acceptance_refs", "steps", "pass_criteria",
                              "fail_or_stop_conditions", "evidence_required", "prerequisite_ids"):
                    self.assertTrue(probe[field], field)
                self.assertTrue(set(probe["prerequisite_ids"]) <= prerequisites)
                self.assertGreaterEqual(len(probe["steps"]), 3)
                self.assertEqual(probe["status"], "NOT_RUN")
                self.assertIsNone(probe["actual"])
                self.assertEqual(probe["evidence_refs"], [])
                self.assertNotRegex(json.dumps(probe, ensure_ascii=False), r"\bTODO\b|\bTBD\b")

    def test_probe_acceptance_references_exist(self):
        acceptance = self.text("05-delivery-acceptance.md") + self.text("11-coordinator-agent.md")
        known = set(re.findall(r"^\| ((?:AT|CA)-\d+) \|", acceptance, re.MULTILINE))
        for probe in self.manifest()["probes"]:
            self.assertTrue(set(probe["acceptance_refs"]) <= known, probe["id"])

    def test_all_native_joint_probes_are_mapped_without_substitution(self):
        data = self.manifest()
        compatibility = self.load("validation/compatibility-matrix.json")
        native_ids = {"COMP-1", "COMP-2", "COMP-3"}
        mapped = []
        for number, probe in enumerate(data["probes"][:11], 1):
            self.assertEqual(set(probe["targets"]), native_ids)
            self.assertEqual(set(probe["compatibility_refs"]),
                             {f"{target}-P{number}" for target in native_ids})
            mapped.extend(probe["compatibility_refs"])
        expected = {p["id"] for r in compatibility["records"][:3] for p in r["probes"]}
        self.assertEqual(set(mapped), expected)
        self.assertEqual(len(mapped), len(set(mapped)))
        targets = {target["id"]: target["product"] for target in data["targets"]}
        self.assertEqual(targets, {r["id"]: r["product"] for r in compatibility["records"]})

    def test_fingerprint_contains_all_existing_security_dimensions(self):
        data = self.manifest()
        existing = self.load("validation/compatibility-matrix.json")
        required = set(existing["records"][0]["configuration"])
        self.assertTrue(required <= set(data["fingerprint_fields"]))
        self.assertTrue(data["same_fingerprint_required"])

    def test_common_authorization_and_evidence_fields_are_defined(self):
        data = self.manifest()
        self.assertTrue({"entrypoint", "session_scope", "synthetic_dataset_digest",
                         "allowed_tools", "egress_destinations", "budget_limit",
                         "timeout", "stop_conditions", "approver", "expires_at"}
                        <= set(data["execution_authorization_fields"]))
        self.assertTrue({"fingerprint_before", "fingerprint_after", "authorization_ref",
                         "executor", "executed_at", "actual_steps", "actual_result",
                         "artifact_digests", "cost_ledger", "defects"}
                        <= set(data["common_evidence_fields"]))

    def test_runbook_covers_every_probe_and_preserves_phase_gates(self):
        text = self.text("P0-PROBE-PLAN.md")
        for probe in self.manifest()["probes"]:
            self.assertIn(probe["id"], text)
        self.assertIn("G1 未通过，不开放真实多 Agent 写代码", text)
        self.assertIn("不是客户端启动授权", text)
        self.assertIn("NOT_RUN", text)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args, test_args = parser.parse_known_args()
    ROOT = args.root.resolve()
    unittest.main(argv=[__file__, *test_args])
