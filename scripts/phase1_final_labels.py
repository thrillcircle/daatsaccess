from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, replacements: list[tuple[str, str]]) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise RuntimeError(f"{path}: expected one occurrence of {old!r}, found {count}")
        text = text.replace(old, new, 1)
    target.write_text(text, encoding="utf-8")


patch(
    "src/routes/app.passenger.index.tsx",
    [
        ('title: "Passenger — Access"', 'title: "Ride — Access"'),
        ('<AppShell title="Passenger" nav={nav}>', '<AppShell title="Ride" nav={nav}>'),
    ],
)

patch(
    "src/routes/app.passenger.book.index.tsx",
    [
        ('title: "Book a service — Access"', 'title: "Services — Access"'),
        ('<AppShell title="Book" nav={nav}>', '<AppShell title="Services" nav={nav}>'),
    ],
)

patch(
    "src/routes/app.passenger.bookings.tsx",
    [
        ('title: "My bookings — Access"', 'title: "My Trips — Access"'),
        ('<AppShell title="My bookings" nav={nav}>', '<AppShell title="My Trips" nav={nav}>'),
        ('<h1 className="text-xl font-semibold">My bookings</h1>', '<h1 className="text-xl font-semibold">My Trips</h1>'),
    ],
)

print("Final Phase 1 labels updated.")
