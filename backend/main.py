import os
import json
import httpx
import dotenv
import uvicorn
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

dotenv.load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

app = FastAPI(
    title="TermLens API",
    description="Backend proxy for the TermLens browser extension — forwards requests to OpenRouter so users don't need their own API key.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Extension origin is a chrome-extension:// URL
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok", "message": "TermLens API is running"}


# ---------------------------------------------------------------------------
# Chat  (streaming proxy to OpenRouter)
# ---------------------------------------------------------------------------

@app.post("/chat", tags=["Chat"])
async def chat(request: Request):
    """
    Accepts the same JSON body that the extension would send to OpenRouter
    (model, messages, max_tokens, temperature, stream) and proxies it through
    the server-side API key.  Supports both streaming (stream=true) and
    non-streaming responses.
    """
    if not OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Server-side API key is not configured. Please set OPENROUTER_API_KEY in the backend .env file.",
        )

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    # Force stream=True so we can forward SSE chunks as they arrive
    body["stream"] = True

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "chrome-extension://termlens",
        "X-Title": "TermLens",
    }

    async def stream_openrouter():
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{OPENROUTER_BASE_URL}/chat/completions",
                json=body,
                headers=headers,
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    # Emit an SSE error event so the extension can handle it
                    try:
                        err = json.loads(error_body)
                        msg = err.get("error", {}).get("message", f"OpenRouter error {response.status_code}")
                    except Exception:
                        msg = f"OpenRouter error {response.status_code}"
                    yield f"data: {json.dumps({'error': msg})}\n\n"
                    return

                async for chunk in response.aiter_bytes():
                    yield chunk

    return StreamingResponse(
        stream_openrouter(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
