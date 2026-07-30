from pathlib import Path

script = Path("scripts/phase4_integrate_integrity_controls.py")
text = script.read_text()
block_start = '''
replace_once(
    admin_quote,
    ''' + "'''" + '''          <section className="rounded-2xl border bg-card p-4 shadow-sm">'''
start = text.find(block_start)
if start < 0:
    raise RuntimeError("Could not find the revision-history replacement block")
end = text.find('\n\npassenger = Path(', start)
if end < 0:
    raise RuntimeError("Could not find the end of the revision-history replacement block")
script.write_text(text[:start] + text[end:])

exec(compile(script.read_text(), str(script), "exec"), {"__name__": "__main__"})

admin_quote = Path("src/routes/app.admin.bookings.$bookingId.quote.tsx")
source = '''          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-semibold">
              <History className="h-4 w-4" />
              Revision history
            </h3>'''
replacement = '''          {selectedQuote && !selectedQuote.accepted_at && !selectedQuote.cancelled_at ? (
            <section className="rounded-2xl border border-destructive/25 p-4">
              <h3 className="font-semibold">Cancel current quote revision</h3>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="Mandatory cancellation reason"
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                />
                <Button
                  variant="destructive"
                  onClick={() => void cancelQuote()}
                  disabled={busy === "cancel" || !cancelReason.trim()}
                >
                  Cancel revision
                </Button>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border bg-card p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-semibold">
              <History className="h-4 w-4" />
              Revision history
            </h3>'''
content = admin_quote.read_text()
count = content.count(source)
if count != 1:
    raise RuntimeError(f"Expected one formatted revision-history section, found {count}")
admin_quote.write_text(content.replace(source, replacement, 1))
