"""Offline design checks only; never starts agents or calls the network.
Use an existing Python environment with jsonschema (Draft 2020-12).
Usage: python tools/verify_design.py [--refresh-combined] [--write-report] [--refresh-manifest] [--package ZIP]
"""
import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
try:
    from jsonschema import Draft202012Validator, FormatChecker, RefResolver
except ImportError:
    sys.exit("Use an existing Python with jsonschema; nothing is installed automatically.")
ROOT = Path(__file__).resolve().parents[1]
DATE, VERSION, CVERSION = "2026-11-14", "1.6", "1.2"
failures = []
def check(ok, message):
    if not ok:
        failures.append(message)
    return bool(ok)
def load(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8-sig"))
def sha(data):
    return hashlib.sha256(data).hexdigest()
def ids(prefix, count):
    return [f"{prefix}-{i:02d}" for i in range(1, count + 1)]
def refs(cell, prefix):
    result = []
    for match in re.finditer(rf"\b{prefix}-(\d+(?:/\d+)*)(?:[–-](?:{prefix}-)?(\d+))?", cell):
        values = [int(n) for n in match[1].split("/")]
        if match[2]:
            values = list(range(values[0], int(match[2]) + 1))
        result.extend(f"{prefix}-{n:02d}" for n in values)
    return result
def rows(text, prefix):
    result = {}
    for line in text.splitlines():
        match = re.match(rf"^\| ({prefix}-\d+) \|", line)
        if match:
            check(match[1] not in result, f"Duplicate {match[1]}")
            result[match[1]] = [s.strip() for s in line.strip().strip("|").split("|")]
    return result
def demote(text):
    output, fenced = [], False
    for line in text.splitlines():
        if line.startswith(chr(96)*3):
            fenced = not fenced
        if not fenced and re.match(r"^#{1,5} ", line):
            line = "#" + line
        output.append(line)
    return "\n".join(output).rstrip()
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--refresh-combined", action="store_true")
parser.add_argument("--refresh-manifest", action="store_true")
parser.add_argument("--write-report", action="store_true")
parser.add_argument("--package", type=Path)
a = parser.parse_args()
if a.package and (a.refresh_combined or a.write_report or a.refresh_manifest):
    sys.exit("Package verification must be read-only, after refresh/report generation.")
docs = {p.relative_to(ROOT).as_posix(): p.read_text(encoding="utf-8") for p in ROOT.rglob("*.md") if p.name != "完整方案.md"}
chapters = sorted(n for n in docs if re.match(r"^\d\d-", n))
check(len(chapters) == 12, "Expected twelve chapters")
fr, at, ca = rows(docs["01-product-architecture.md"], "FR"), rows(docs["05-delivery-acceptance.md"], "AT"), rows(docs["11-coordinator-agent.md"], "CA")
for prefix, data, count in [("FR", fr, 33), ("AT", at, 190), ("CA", ca, 60)]:
    check(set(data) == set(ids(prefix, count)), f"{prefix} count/numbering mismatch")
frmap, camap = {key: [] for key in fr}, {}
for key, cells in list(at.items()) + list(ca.items()):
    mapped = refs(cells[1], "FR")
    check(bool(mapped), f"No FR for {key}")
    for item in mapped:
        check(item in fr, f"Unknown {item} in {key}")
        if item in frmap:
            frmap[item].append(key)
    if key in ca:
        camap[key] = refs(cells[2], "AT")
        check(bool(camap[key]) and all(x in at for x in camap[key]), f"Invalid AT mapping for {key}")
check(all(frmap.values()), "Unmapped FR")
for json_file in ROOT.rglob("*.json"):
    try:
        json.loads(json_file.read_text(encoding="utf-8-sig"))
    except ValueError as exc:
        failures.append(f"Invalid JSON file {json_file.name}: {exc}")
source_defs = set(re.findall(r"^- \[([EP]\d+)\]", docs["06-evidence-decisions.md"], re.M))
tables = json_examples = 0
for name, text in docs.items():
    fenced, kind, code, width = False, None, [], None
    nums = re.findall(r"^## (\d+)\. ", text, re.M)
    check(len(nums) == len(set(nums)), f"Duplicate section number: {name}")
    for lineno, line in enumerate(text.splitlines(), 1):
        if line.startswith(chr(96)*3):
            if fenced and kind == "json":
                try:
                    json.loads("\n".join(code)); json_examples += 1
                except ValueError as exc:
                    failures.append(f"JSON example {name}:{lineno}: {exc}")
            fenced = not fenced
            kind, code, width = (line[3:].strip() if fenced else None), [], None
            continue
        if fenced:
            code.append(line); continue
        if line.startswith("|"):
            current = len(re.split(r"(?<!\\)\|", line))
            if width is None:
                width = current; tables += 1
            check(current == width, f"Table column mismatch {name}:{lineno}")
        else:
            width = None
    check(not fenced, f"Unclosed fence: {name}")
    for item in re.findall(r"\[([EP]\d+)\]", text):
        check(item in source_defs, f"Unresolved source {item} in {name}")
    for target in re.findall(r"\[[^\]\n]+\]\(([^)]+)\)", text):
        if re.match(r"^[a-zA-Z]+://", target) or target.startswith("#"):
            continue
        check(((ROOT / name).parent / target.split("#", 1)[0]).exists(), f"Unresolved link {name} -> {target}")
    for prefix, data in [("FR", fr), ("AT", at), ("CA", ca)]:
        for item in re.findall(rf"\b{prefix}-\d+\b", text):
            check(item in data, f"Unknown {item} in {name}")
schema = load("contracts/core.schema.json")
Draft202012Validator.check_schema(schema)
class OfflineResolver(RefResolver):
    # Explicit empty-base cache supports the installed resolver's URN fragment behavior.
    # Unknown/remote references always fail instead of initiating network requests.
    def resolve_remote(self, uri):
        raise RuntimeError("External schema resolution forbidden: " + uri)
validator = Draft202012Validator(schema, resolver=OfflineResolver.from_schema(schema, store={"": schema}), format_checker=FormatChecker())
wire = load("contracts/wire-examples.json")
wire_results = []
for item in wire["examples"]:
    valid = validator.is_valid(item["payload"])
    matched = check(valid == item["expected_schema_valid"], f"Schema example mismatch: {item['id']}")
    wire_results.append({"id": item["id"], "schema_valid": valid, "matches_expected": matched, "service_semantics": "NOT_RUN"})
check(len(wire_results) == 26, "Expected 26 wire examples")
pf = load("validation/protocol-fixtures.json")
cq = load("validation/coordinator-eval-corpus.json")
comp = load("validation/compatibility-matrix.json")
bm = load("validation/collaboration-benchmarks.json")
for asset, key, count in [(pf, "cases", 16), (cq, "cases", 20), (comp, "records", 4), (bm, "cases", 4)]:
    check(asset["status"] == "NOT_RUN", "Do not claim runtime verification from design checks")
    check(len(asset[key]) == count, f"Expected {count} {key}")
    check(len({x["id"] for x in asset[key]}) == count, "Duplicate fixture ID")
    for item in asset[key]:
        if key == "records":
            check(item["qualification"] == "UNVERIFIED" and item["fingerprint"] is None, "Compatibility is unverified")
            check(all(p["status"] == "NOT_RUN" and not p["evidence_refs"] for p in item["probes"]), "No measured compatibility evidence exists")
        else:
            check(item["status"] == "NOT_RUN", f"Unexecuted fixture status mismatch: {item['id']}")
        for ref in item.get("acceptance_refs", []):
            check(ref in at or ref in ca, f"Unknown acceptance ref {ref}")
for item in pf["cases"]:
    check(all(item.get(k) for k in ["setup", "steps", "fault_point", "evidence_required"]), f"Incomplete fault case {item['id']}")
    check(all(item["expected"].get(k) for k in ["db_assertions", "event_assertions", "file_assertions", "forbidden_effects"]), f"Missing fault oracle {item['id']}")
    check(item["actual"] is None, "Fault cases have not been executed")
for name, content in pf["baseline"]["file_contents"].items():
    check(sha(content.encode()) == pf["baseline"]["file_sha256"][name], f"Fixture digest mismatch {name}")
known = {x["id"] for x in cq["documents"]}
for item in cq["cases"]:
    check(set(item["visible_source_refs"]) <= known, f"Unknown quality source {item['id']}")
    check(bool(item["criteria"]) and bool(item["forbidden_conclusions_or_effects"]), f"Missing rubric {item['id']}")
    check(item["oracle_status"] == "DRAFT_REVIEW_REQUIRED" and not item["runs"], "Human oracle review/model results not executed")
check(cq["holdout"]["status"] == "NOT_CREATED", "Public samples are not hidden holdout")
combined = (f"# 群聊式 Agent 协作平台：完整方案 v{VERSION}\n\n日期：{DATE}（Asia/Tokyo）。由 README 与 01–12 分章生成，正文标题整体下移一级；共33项需求、190项AT与60项CA，全部250项产品案例NOT_RUN。contracts/validation为配套材料，随包交付；正文不是产品实测报告。\n\n" + "\n\n---\n\n".join(demote(docs[n]) for n in ["README.md"] + chapters) + "\n")
if a.refresh_combined:
    (ROOT / "完整方案.md").write_bytes(combined.encode())
combined_ok = check((ROOT / "完整方案.md").read_text(encoding="utf-8") == combined, "Combined volume mismatch")
coordinator_ok = check("# 11 管家 Agent 专项设计 v1.2" in docs["11-coordinator-agent.md"], "Coordinator single-source chapter version mismatch")
check("项目交接说明.md" in docs, "Handoff guide missing")
organization = load("organization-record.json")
check(organization["destination_root"] == "plan" and len(organization["copy_checks"]) == 28, "Migration copy inventory mismatch")
check(len(organization["source_manifest"]) == 31, "Migration source inventory mismatch")
check(all(x["status"] == "EXACT_COPY_BEFORE_LAYOUT_EDITS" for x in organization["copy_checks"]), "Unverified migration copy")
clause_defs = [
    ("private execution intersection", "02-data-contracts.md", "成员策略 ∩ 服务端执行授权 ∩ 资源 ACL"),
    ("logical single writer", "02-data-contracts.md", "跨所有 worktree 最多一个有效写入者"),
    ("unknown writer quarantine", "02-data-contracts.md", "无法证明旧写入者停止"),
    ("disclosure separate", "11-coordinator-agent.md", "内容披露与派工是两个授权"),
    ("joint configuration", "12-protocol-closure-and-validation.md", "不能把宽权限配置"),
    ("partial execution", "12-protocol-closure-and-validation.md", "failure_policy=dependency_isolation"),
    ("no automatic rollback", "12-protocol-closure-and-validation.md", "不自动 reset"),
    ("atomic wait register", "12-protocol-closure-and-validation.md", "同一数据库写事务"),
    ("continuation intent", "12-protocol-closure-and-validation.md", "唯一 continuation_inbox"),
    ("external not exactly once", "12-protocol-closure-and-validation.md", "不能宣称图节点/外部 API exactly-once"),
    ("zero model progress", "02-data-contracts.md", "进度查询零模型调用"),
    ("full handoff", "02-data-contracts.md", "完整变更集依赖"),
    ("backup closure", "02-data-contracts.md", "平台状态、所需 Git 对象/引用和受控 dirty 成果"),
    ("human oracle", "12-protocol-closure-and-validation.md", "DRAFT_REVIEW_REQUIRED"),
    ("public not holdout", "12-protocol-closure-and-validation.md", "公开样本只能做开发回归"),
    ("fairness no force unlock", "12-protocol-closure-and-validation.md", "公平性不能强抢旧写者"),
    ("four journeys", "12-protocol-closure-and-validation.md", "### UX-04")]
clause_results = [{"name": name, "file": file, "passed": check(needle in docs[file], f"Missing clause {name}")} for name, file, needle in clause_defs]
old = load("verification-report.json")
report = {"date": DATE, "timezone": "Asia/Tokyo", "design_version": VERSION, "coordinator_design_version": CVERSION,
    "scope": "Offline document/schema checks only, not product/agent/model/security/performance/user tests.", "document_checks_status": "PASS" if not failures else "FAIL",
    "requirement_count": len(fr), "platform_acceptance_case_count": len(at), "coordinator_acceptance_case_count": len(ca), "acceptance_case_count": len(at)+len(ca),
    "product_acceptance_status": "NOT_RUN", "not_run_product_acceptance_cases": list(at)+list(ca), "requirement_to_acceptance": frmap,
    "coordinator_to_platform_acceptance": camap, "defined_evidence_sources": sorted(source_defs), "sources_reread_this_revision": ["E33"], "layout_revision": "plan-layout-1", "sources_read_during_directory_reorganization": [],
    "required_clause_checks": clause_results, "document_structure": {"json_examples_parsed": json_examples, "markdown_tables": tables, "checks": "numbering,mappings,links,sources,fences,tables"},
    "schema_verification": {"dialect": "2020-12", "meta_schema_check": "PASS", "wire_examples": wire_results, "service_semantics": "NOT_RUN"},
    "materials": {"protocol_fixtures":16,"public_quality_cases":20,"compatibility_records":4,"benchmark_workloads":4,"human_oracle_review":"NOT_RUN","holdout":"NOT_CREATED","runtime_status":"NOT_RUN"},
    "combined_volume_matches_chapters": combined_ok, "coordinator_single_source_chapter_valid": coordinator_ok,
    "organization_record": "organization-record.json", "organization_status": organization["status"], "organization_cleanup_status": organization["cleanup"]["status"],
    "files": sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*") if p.is_file() and "__pycache__" not in p.parts), "failures": failures,
    "limitations": ["All 250 product cases remain NOT_RUN.","Schema/phrase checks are not semantic proof or independent audit.","This design-only validator does not execute the separate W03 reference service; its synthetic runtime evidence is outside plan. No live model/native-client/Windows isolation/product recovery/performance/user qualification is claimed.","Quality oracles need human review; public examples are not holdout.","E33 was read during the earlier v1.6 content revision; this directory reorganization did not retrieve external sources."],
    "cleanup_result": old.get("cleanup_result", {}),
    "source_retrieval_summary": {"applies_to":"prior v1.6 content revision, not this directory reorganization","official_sources_read":1,"source_ids":["E33"],"method":"Approved read-only HTTP after empty web output","all_http_200":True,"raw_page_files_persisted":False}}
if a.write_report:
    (ROOT / "verification-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
# Refresh checksums only after report/combined writes, then verify the stored bytes.
# A plain run stays read-only. Reports intentionally do not self-hash.
files = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in ROOT.rglob("*") if p.is_file() and "__pycache__" not in p.parts}
if a.refresh_manifest:
    if failures:
        check(False, "Manifest refresh refused because content checks failed")
    else:
        manifest_text = "".join(sha(data) + "  " + name + "\n" for name, data in sorted(files.items()) if name != "SHA256SUMS.txt")
        (ROOT / "SHA256SUMS.txt").write_bytes(manifest_text.encode())
        files["SHA256SUMS.txt"] = manifest_text.encode()
manifest = (ROOT / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines()
manifest_names = set()
manifest_failed = False
for line in manifest:
    if "  " not in line:
        check(False, "Malformed checksum line"); manifest_failed = True; continue
    expected, name = line.split("  ", 1)
    if not check(name not in manifest_names, f"Duplicate checksum entry {name}"):
        manifest_failed = True
    manifest_names.add(name)
    if not check(name in files and sha(files[name]) == expected, f"Manifest mismatch {name}"):
        manifest_failed = True
if not check(manifest_names == set(files) - {"SHA256SUMS.txt"}, "Manifest inventory mismatch"):
    manifest_failed = True
package_info = None
if a.package:
    check(not a.package.resolve().is_relative_to(ROOT), "ZIP must be outside plan directory")
    with zipfile.ZipFile(a.package) as archive:
        entries = archive.namelist()
        check(len(entries) == len(set(entries)) and set(entries) == set(files), "ZIP inventory mismatch")
        for name in entries:
            check(name in files and archive.read(name) == files[name], f"ZIP content mismatch {name}")
    package_info = {"entries": len(entries), "bytes": a.package.stat().st_size, "sha256": sha(a.package.read_bytes())}
print(json.dumps({"document_checks":"PASS" if not failures else "FAIL","requirements":len(fr),"AT":len(at),"CA":len(ca),"product_tests":"NOT_RUN","wire_examples_checked":len(wire_results),"json_examples":json_examples,"tables_checked":tables,"file_count":len(files),"manifest_entries":len(manifest_names),"manifest_checks":"FAIL" if manifest_failed else "PASS","organization_status":organization["status"],"package":package_info,"failures":failures},ensure_ascii=False,indent=2))
sys.exit(1 if failures else 0)
