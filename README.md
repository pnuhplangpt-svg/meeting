# meeting

## Regression test (mocked E2E)

Run:

```bash
python3 scripts/run_mock_e2e.py
```

What it verifies:
- room list load
- reservation create
- reservation edit (no extra row created)
- reservation delete
- admin auth entry

The test uses an in-page mocked API (`fetch` override), so it is deterministic and does not require live Apps Script network access.
