from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

# This is a "shape" — it tells the server what data to expect
class Report(BaseModel):
    raw_text: str

# This says: "when a GET request hits the homepage, say hello"
# You'll use this first, from your phone's browser, as the easiest possible test
@app.get("/")
def home():
    return {"message": "hello, you reached the laptop!"}

# This is the real one: when a POST request hits /reports, print it and reply
@app.post("/reports")
def receive_report(report: Report):
    print(f"GOT A REPORT: {report.raw_text}")
    return {"id": 1, "status": "received"}
