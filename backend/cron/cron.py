"""
Cron job for TermLens — runs on GitHub Actions (scheduled workflow).

Flow:
1. Fetch free models from OpenRouter
2. Ping each model with a minimal canary request to verify it responds
3. Discard models that fail the ping
4. Fetch current model list from Supabase
5. Remove dead models that are in Supabase but not in the healthy set
6. Add healthy models that are not yet in Supabase
"""

import os
import sys
import json
import asyncio
import httpx

# ---------------------------------------------------------------------------
# Config — read from environment (set as GitHub Actions secrets)
# ---------------------------------------------------------------------------

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

OPENROUTER_MODELS_URL = (
    "https://openrouter.ai/api/frontend/models/find"
    "?order=latency-low-to-high&q=free"
)
OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"

SUPABASE_TABLE = "models"
SUPABASE_REST = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}"

# How many models to probe concurrently (stay under rate limits)
PROBE_CONCURRENCY = 5
# Timeout per canary request (seconds)
PROBE_TIMEOUT = 12.0


# ---------------------------------------------------------------------------
# Step 1 — Fetch free models from OpenRouter
# ---------------------------------------------------------------------------

async def fetch_openrouter_models(client: httpx.AsyncClient) -> list[dict]:
    """
    Returns a list of dicts with keys: slug, name
    """
    print("→ Fetching free models from OpenRouter...")
    resp = await client.get(OPENROUTER_MODELS_URL, timeout=20.0)
    resp.raise_for_status()
    data = resp.json()

    raw = data.get("data", {}).get("models", [])
    models = []
    for m in raw:
        endpoint = m.get("endpoint") or {}
        slug = endpoint.get("model_variant_slug") or m.get("slug", "")

        name = m.get("short_name") or m.get("name", "")
        if slug:
            models.append({"slug": slug, "name": name})

    print(f"   Found {len(models)} free models on OpenRouter.")
    return models


# ---------------------------------------------------------------------------
# Step 2 — Probe each model with a canary request
# ---------------------------------------------------------------------------

async def probe_model(
    client: httpx.AsyncClient,
    model: dict,
    semaphore: asyncio.Semaphore,
) -> dict | None:
    """
    Sends a minimal 1-token request to the model.
    Returns the model dict if healthy, None if it fails.
    """
    async with semaphore:
        slug = model["slug"]
        try:
            resp = await client.post(
                OPENROUTER_CHAT_URL,
                json={
                    "model": slug,
                    "messages": [{"role": "user", "content": "Hi"}],
                    "max_tokens": 1,
                },
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "HTTP-Referer": "https://termlens.com",
                    "X-Title": "TermLens-Cron",
                    "Content-Type": "application/json",
                },
                timeout=PROBE_TIMEOUT,
            )
            if resp.status_code == 200:
                print(f"   ✓ {slug}")
                return model
            else:
                body = resp.text[:120]
                print(f"   ✗ {slug}  [{resp.status_code}] {body}")
                return None
        except Exception as e:
            print(f"   ✗ {slug}  [timeout/error] {e}")
            return None


async def probe_all_models(
    client: httpx.AsyncClient,
    models: list[dict],
) -> list[dict]:
    """
    Probes all models concurrently (bounded by PROBE_CONCURRENCY).
    Returns only the healthy ones.
    """
    if not OPENROUTER_API_KEY:
        print("⚠  OPENROUTER_API_KEY not set — skipping probes, trusting all models.")
        return models

    print(f"\n→ Probing {len(models)} models (concurrency={PROBE_CONCURRENCY})...")
    semaphore = asyncio.Semaphore(PROBE_CONCURRENCY)
    tasks = [probe_model(client, m, semaphore) for m in models]
    results = await asyncio.gather(*tasks)
    healthy = [r for r in results if r is not None]
    print(f"   {len(healthy)}/{len(models)} models are healthy.")
    return healthy


# ---------------------------------------------------------------------------
# Step 3 — Supabase helpers
# ---------------------------------------------------------------------------

def supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def fetch_supabase_models(client: httpx.AsyncClient) -> list[dict]:
    """
    Returns all rows from the Supabase `models` table.
    Each row: { id, created_at, name, slug }
    """
    print("\n→ Fetching current models from Supabase...")
    resp = await client.get(
        SUPABASE_REST,
        headers=supabase_headers(),
        params={"select": "id,name,slug"},
        timeout=15.0,
    )
    resp.raise_for_status()
    rows = resp.json()
    print(f"   Supabase has {len(rows)} models.")
    return rows


async def insert_models(client: httpx.AsyncClient, models: list[dict]) -> None:
    """
    Inserts new models into Supabase.
    models: list of { name, slug }
    """
    if not models:
        return
    print(f"\n→ Inserting {len(models)} new models into Supabase...")
    resp = await client.post(
        SUPABASE_REST,
        headers=supabase_headers(),
        json=models,
        timeout=15.0,
    )
    resp.raise_for_status()
    for m in models:
        print(f"   + {m['slug']}")


async def delete_models(client: httpx.AsyncClient, ids: list[int]) -> None:
    """
    Deletes rows from Supabase by id.
    """
    if not ids:
        return
    print(f"\n→ Removing {len(ids)} dead models from Supabase...")
    # Supabase REST: DELETE with `id=in.(1,2,3)`
    id_list = ",".join(str(i) for i in ids)
    resp = await client.delete(
        SUPABASE_REST,
        headers=supabase_headers(),
        params={"id": f"in.({id_list})"},
        timeout=15.0,
    )
    resp.raise_for_status()
    print(f"   Removed ids: {ids}")


# ---------------------------------------------------------------------------
# Step 4 — Sync logic
# ---------------------------------------------------------------------------

async def sync(client: httpx.AsyncClient, healthy: list[dict]) -> None:
    """
    Compares the healthy set against Supabase and applies the diff.
    """
    supabase_rows = await fetch_supabase_models(client)

    supabase_slugs = {row["slug"]: row for row in supabase_rows}
    healthy_slugs  = {m["slug"]: m for m in healthy}

    # Models to add: healthy but not in Supabase
    to_add = [
        {"name": m["name"], "slug": m["slug"]}
        for slug, m in healthy_slugs.items()
        if slug not in supabase_slugs
    ]

    # Models to remove: in Supabase but not healthy
    to_remove_ids = [
        row["id"]
        for slug, row in supabase_slugs.items()
        if slug not in healthy_slugs
    ]

    print(f"\n   Diff → +{len(to_add)} to add, -{len(to_remove_ids)} to remove")

    await insert_models(client, to_add)
    await delete_models(client, to_remove_ids)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    print("=" * 60)
    print("TermLens Model Cron — starting")
    print("=" * 60)

    async with httpx.AsyncClient() as client:
        # 1. Fetch
        all_models = await fetch_openrouter_models(client)
        if not all_models:
            print("No models returned from OpenRouter. Aborting.")
            sys.exit(1)

        # 2. Probe
        healthy = await probe_all_models(client, all_models)
        if not healthy:
            print("No healthy models found. Aborting to avoid wiping Supabase.")
            sys.exit(1)

        # 3. Sync
        await sync(client, healthy)

    print("\n" + "=" * 60)
    print("✅ Cron finished successfully.")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
