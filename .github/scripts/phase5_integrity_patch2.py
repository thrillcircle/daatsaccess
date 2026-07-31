from pathlib import Path


panel_path = Path("src/components/operations/DriverOperationsPanel.tsx")
panel = panel_path.read_text()

function_anchor = "\n  async function reportIncident() {"
no_show_function = '''
  async function reportNoShow(run: OperationRun) {
    setBusy(`no-show:${run.id}`);
    const { error } = await operationsDb.rpc("driver_report_no_show", {
      p_run_id: run.id,
      p_expected_run_version: run.row_version,
      p_details: "Passenger did not arrive at the confirmed pickup point.",
    });
    setBusy(null);
    if (error) toast.error(error.message);
    else {
      toast.success("Passenger no-show reported to Operations");
      await load();
    }
  }
'''
if function_anchor not in panel:
    raise SystemExit("Could not locate the incident operation anchor")
panel = panel.replace(
    function_anchor,
    "\n" + no_show_function + "  async function reportIncident() {",
    1,
)

# Passenger no-show has a dedicated protected operation and must not fall
# through the generic incident form.
panel = panel.replace('                      "passenger_no_show",\n', "", 1)

actions_anchor = '''                  {assignment.status === "acknowledged"
                    ? actions.map((target) => (
                        <Button
                          key={target}
                          variant={
                            target === "interrupted" || target === "failed"
                              ? "destructive"
                              : "outline"
                          }
                          onClick={() => void transition(run, target)}
                          disabled={busy === `transition:${run.id}`}
                        >
                          {target.replaceAll("_", " ")}
                        </Button>
                      ))
                    : null}'''
no_show_button = '''
                  {assignment.status === "acknowledged" &&
                  ["driver_arrived", "waiting"].includes(run.operational_status) ? (
                    <Button
                      variant="outline"
                      onClick={() => void reportNoShow(run)}
                      disabled={busy === `no-show:${run.id}`}
                    >
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      Passenger no-show
                    </Button>
                  ) : null}'''
if actions_anchor not in panel:
    raise SystemExit("Could not locate Driver operation actions")
panel = panel.replace(actions_anchor, actions_anchor + no_show_button, 1)
panel_path.write_text(panel)

test_path = Path("src/lib/phase5-dispatch-cancellation-integrity.test.ts")
tests = test_path.read_text()
tests = tests.replace(
    '''      "operation_run_events",
      "notification_outbox",''',
    '''      "private.operations_add_event",
      "private.operations_enqueue_notification",''',
    1,
)
test_path.write_text(tests)
