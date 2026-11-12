# V8 QA — reproducible evidence and boundaries

**Execution environment:** Linux container, Python 3.13, SciPy/HiGHS, FastAPI TestClient, Chromium offline fixture. The user's Windows installation is NOT accessible here; `run_windows.bat` is not Windows-machine-verified.

## Executed verifications

| Group | Result |
|---|---|
| v2 underlying mathematical/data/event regressions (`upstream_tests`) | **36/36 passed** (one selected run) |
| v7 new customer/fast-forward/3D/study regressions (`test_v7_product.py`) | **9/9 passed** |
| v6 historical browser/API contracts plus live dispatch regressions | **16/16 passed** |
| v8 synchronization/auto/order/safety tests | **10/10 passed** in one run; remaining **3/3 passed** separately |
| Desktop 1440×900 offline Chromium render | Passed: Ground, Control, Customer, order form, start/pause/speed |
| Standard 1366×768 Chromium render | Passed: no document vertical/horizontal overflow |
| Mobile 390×844 Chromium render | Passed: no document vertical/horizontal overflow (mobile layout remains condensed) |
| Browser console exceptions in above fixture runs | **0** |
| ASGI routes `/v8`, static assets, `/v8/api/state`, `/v8/api/audit` etc | Passed TestClient smoke; live localhost Uvicorn health separately returned HTTP 200 |

Some long, combined historical test invocations timed out in this test container after a number of passes; do **not** interpret this as a full-suite green result. The result counts above are from completed, explicitly selected runs, not an invented single aggregate pass count. The Chromium environment blocked navigation to localhost (`ERR_BLOCKED_BY_ADMINISTRATOR`), so **browser interactions were exercised with deterministic API response fixtures**, and actual ASGI backend HTTP tests were performed separately; browser-to-server end-to-end validation remains to be performed on Windows.

## Investigated failures & fixes

- **Lock starvation at high speed:** the first v8 HTTP test at speed=100 hung when Pause competed with a CPU-saturated solver loop. Fixed by signalling stop before acquiring the UI state lock and yielding >=50ms between batches. Confirmed Pause HTTP 200 after ~1.2s at 100× target, with no 500 error.
- **Portfolio silent omission:** the inherited v7 display sliced to 30 items, hiding newly created `SYN-DEMO-*` orders in larger episodes. v8 builds the complete admitted-shipment projection and reports its coverage explicitly.
- **Approval incorrectly labeled stale to customer:** internal synthetic approval could bump snapshot version and cause v7 `STALE_REQUIRES_RECALC`. v8 customer projection prioritizes recorded decision status while explicitly keeping `carrier_confirmed=False` and unchanged estimated arrival.
- **Synthetic crew task button missing:** earlier UX treated `QUEUED_SIMULATED` as non-clickable. v8 makes it actionable, logs acknowledgement and projects it onto synthetic customer journey, not an airline milestone.
- **Outdated root test:** v6 regression had implicitly asserted `/` must always serve v6. The explicit `/v6` route is now tested; `/` correctly serves v8.

## Reality of speed

At a 100× **requested** target (50 ticks/s with the current reference-speed convention), a representative Python 3.13 sandbox run achieved approximately **4.53 actual ticks/s** on a 4-tick batch, with about 0.88 s solver wall time per batch. Each tick advances ten synthetic minutes; achieved throughput is accurately reported by the API and UI. The product does NOT pretend to have achieved 100× when it has not. Different CPUs/data sizes will produce different results.

## No invalid claims

All airline/source catalog data are generated; the OAG adapter is a schema-shaped mock. No proof of real physical-aircraft load safety, real carrier booking, customer SLA improvement, operational ROI, real-time telemetry, or commercial production-readiness has been obtained. Reproducible numerical solver tests establish only the implemented **bounded** mathematical problem and data contracts.
