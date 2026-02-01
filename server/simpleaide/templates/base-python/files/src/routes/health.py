import time
from fastapi import APIRouter

router = APIRouter()
start_time = time.time()


@router.get("/")
async def health():
    return {
        "status": "healthy",
        "uptime": time.time() - start_time
    }


@router.get("/ready")
async def ready():
    return {"ready": True}
