from pathlib import Path

script = Path("scripts/phase4_integrate_integrity_controls.py")
text = script.read_text()
old = '<History className="h-4 w-4" /> Revision history'
new = '<History className="h-4 w-4" />\n               Revision history'
count = text.count(old)
if count != 2:
    raise RuntimeError(f"Expected two revision-history guard fragments, found {count}")
script.write_text(text.replace(old, new))

exec(compile(script.read_text(), str(script), "exec"), {"__name__": "__main__"})
