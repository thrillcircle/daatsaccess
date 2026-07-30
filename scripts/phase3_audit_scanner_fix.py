from pathlib import Path

path = Path(__file__).resolve().parent / "phase3_audit_closeout.py"
content = path.read_text(encoding="utf-8")
old = '''for relative in changed_source:
    source = read(relative)
    for table in ("fleet_vehicles", "vehicle_profiles", "vehicle_driver_assignments"):
        mutation = re.compile(
            rf'\\.from\\(["\\\']{table}["\\\']\\).*?\\.(insert|update|delete|upsert)\\s*\\(',
            re.DOTALL,
        )
        if mutation.search(source):
            raise RuntimeError(f"{relative}: direct mutation of {table} bypasses protected fleet RPCs")
'''
new = '''for relative in changed_source:
    source = read(relative)
    for table in ("fleet_vehicles", "vehicle_profiles", "vehicle_driver_assignments"):
        table_read = re.compile(rf'\\.from\\(["\\\']{table}["\\\']\\)')
        for match in table_read.finditer(source):
            statement_end = source.find(";", match.end())
            statement = source[match.end() : statement_end if statement_end >= 0 else len(source)]
            if re.search(r'\\.(insert|update|delete|upsert)\\s*\\(', statement):
                raise RuntimeError(
                    f"{relative}: direct mutation of {table} bypasses protected fleet RPCs"
                )
'''
if content.count(old) != 1:
    raise RuntimeError(f"Expected one audit scanner block, found {content.count(old)}")
path.write_text(content.replace(old, new), encoding="utf-8")
print("Narrowed the Phase 3 prohibited-write scanner to individual statements.")
