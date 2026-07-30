from pathlib import Path

source_path = Path(__file__).with_name("phase1_cleanup.py")
source = source_path.read_text(encoding="utf-8")
marker = '# Drivers page: drivers only. Passenger profiles now live on /app/admin/passengers.'
if marker not in source:
    raise RuntimeError("Could not find drivers cleanup marker")

prefix = source.split(marker, 1)[0]
replacement = r'''
# Drivers page: drivers only. Passenger profiles now live on /app/admin/passengers.
drivers_path = "src/routes/app.admin.drivers.tsx"
drivers = read(drivers_path)

drivers = re.sub(
    r'^\s*const \[passengers, setPassengers\] = useState<Profile\[\]>\(\[\]\);\n',
    '',
    drivers,
    count=1,
    flags=re.M,
)

# Remove the passenger-role/profile query block at the end of the admin driver loader.
drivers = re.sub(
    r'\n\s*const \{ data: passengerRoles \} = await supabase.*?(?=\n\s*\};\n\n\s*load\(\);)',
    '',
    drivers,
    count=1,
    flags=re.S,
)

# Remove any now-obsolete passenger state writes left in early-return branches.
drivers = re.sub(r'^\s*(?:if \(!cancelled\) )?setPassengers\([^\n]*\);\n', '', drivers, flags=re.M)

# Remove passenger filtering and the rendered passenger list.
drivers = re.sub(
    r'\n\s*const filteredPassengers = passengers\.filter\(\(p\) => \{.*?\n\s*\}\);',
    '',
    drivers,
    count=1,
    flags=re.S,
)
drivers = re.sub(
    r'\n\s*<h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">\s*Passengers .*?</ul>',
    '',
    drivers,
    count=1,
    flags=re.S,
)

remaining = [token for token in ("filteredPassengers", "setPassengers", "Passengers (") if token in drivers]
if remaining:
    raise RuntimeError(f"passenger content still present on drivers page: {remaining}")
write(drivers_path, drivers)

print("Phase 1 files patched successfully.")
'''

exec(compile(prefix + replacement, str(source_path), "exec"))
