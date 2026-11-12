# v7 verification record

- V7-specific `pytest tests/test_v7_product.py`: **9/9 passed**. Included 125 randomized no-overlap geometry checks and input/HTTP/three-perspective contract assertions.
- Runtime `audit_lab`: **22/22 checks passed**, with **4 intentionally unresolved production requirements**; data file check **10/10**.
- Browser: real headless Chromium rendering of v7 HTML/CSS/Canvas/JS, with **Python-generated API fixtures**; validated Ground Start/Step, scenario presets, Control geometry visualization and five-scenario study rendering, Customer globe, journey, and synthetic order form; **no JavaScript page errors**, mobile 390px had **no horizontal overflow**. Screenshots in `tests/v7_*.png`.
- Backend: `fast_forward(100)` processed **100/100 actual ticks** in 22.39s, 0 knowingly unsafe dispatches. Normal API state, audit, 3D preflight and customer creation verified using a real `FastAPI TestClient` request path.
- Important test-environment limitation: Chromium `page.goto('http://127.0.0.1:8787')` was blocked (`ERR_BLOCKED_BY_ADMINISTRATOR`). **Browser↔live localhost end-to-end validation was NOT performed**; HTTP backend was tested separately; v7 browser QA injected deterministic JSON responses.
- The installed legacy full test suite was partially run but exceeded execution time in this environment. **No claim that all historical 89 collected tests completed for v7**. Test coverage still needs regular CI, release-bundle Windows startup and longer stress/operational negative tests.

### Windows operator commands

```
cd "C:\Users\Zon\Downloads\RELAY_Fusion_v7"
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -q tests\test_v7_product.py
.\.venv\Scripts\python.exe launch.py
```

Open `http://127.0.0.1:8765/`. Old v6 is still available at `/v6`, old v5 at `/v5`.
