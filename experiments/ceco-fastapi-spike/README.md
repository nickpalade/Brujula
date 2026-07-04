# Ceco's hour-1 offline spike (proof-of-concept — not part of the shipped hub)

This is the throwaway FastAPI server Ceco used to prove the core offline
mechanic before touching the real backend: a phone, connected to a laptop's
WiFi hotspot with **no internet anywhere**, can send a report and get a
response back.

**The real, shipped hub backend lives in [`/server`](../../server) (Node.js /
Express) — this folder is not wired into it and is not run as part of the
app.** Kept here only as a record of the hour-1 risk spike.

## What it proved

- Laptop hotspot (access-point mode) + phone joined to it = a working local
  network with zero internet.
- A phone's browser reached `GET /` on the laptop over that network.
- A `POST /reports` from the phone/curl was received and logged on the
  laptop.

## Run it (if you want to reproduce the spike)

```bash
cd experiments/ceco-fastapi-spike
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then, with a phone connected to the laptop's hotspot, visit
`http://<laptop-hotspot-ip>:8000` in the phone's browser, or POST to
`/reports` with `{"raw_text": "..."}`.
