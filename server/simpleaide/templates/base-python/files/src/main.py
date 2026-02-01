import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.health import router as health_router

load_dotenv()

app = FastAPI(title="{{PROJECT_NAME}}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/health", tags=["health"])


@app.get("/")
async def root():
    return {"message": "Welcome to {{PROJECT_NAME}}"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", {{PORT}}))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
