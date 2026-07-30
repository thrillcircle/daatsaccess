from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).with_name("phase1_cleanup_v2.py")), run_name="__main__")

path = Path(__file__).resolve().parents[1] / "src/routes/app.driver.tsx"
text = path.read_text(encoding="utf-8")
old_start = '''    let unsub: (() => void) | undefined;
    const load = async () => {'''
new_start = '''    const load = async () => {'''
if text.count(old_start) != 1:
    raise RuntimeError(f"Expected one open-rides unsub declaration, found {text.count(old_start)}")
text = text.replace(old_start, new_start, 1)

old_end = '''    unsub = () => supabase.removeChannel(ch);
    return () => unsub?.();'''
new_end = '''    return () => {
      supabase.removeChannel(ch);
    };'''
if text.count(old_end) != 1:
    raise RuntimeError(f"Expected one open-rides cleanup block, found {text.count(old_end)}")
text = text.replace(old_end, new_end, 1)
path.write_text(text, encoding="utf-8")
print("Driver lint hotfix applied.")
