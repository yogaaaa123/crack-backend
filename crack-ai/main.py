"""
CrackPOS AI — FastAPI Application
Main entry point for the AI service.

Endpoints:
  GET  /health       — Health check (pings database)
  POST /chat         — Chat with AI (requires JWT)

Observability:
  - Structured logging via structlog (JSON in prod, colorful in dev)
  - x-request-id tracing from NestJS backend (forwarded as X-Request-Id header)
  - All database queries logged with timing

Rate Limiting:
  - /chat endpoint: 10 requests per 60 seconds per IP
  - /health endpoint: no rate limit (unauthenticated health check)

SECURITY STARTUP:
  On boot, validates that INTERNAL_API_KEY is not the default value.
  The service will refuse to start with a weak or default key.
"""
import time
import uuid
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from auth import AuthenticatedUser, get_current_user
from config import settings
from database import close_db, init_db
from backend_client import close_backend_client
from logging_config import get_logger, setup_logging
from model_rotation import rotation
from schemas import ChatRequest, ChatResponse, ProductFromImageResponse, ProductImageItem
import ai_service
from ai_service import client

setup_logging()
logger = get_logger(__name__)

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["20/minute"],
)

def _validate_startup_security() -> None:
    """
    Validate security-critical settings on service startup.
    Refuses to start if any check fails.

    Checks performed:
    1. INTERNAL_API_KEY is not empty
    2. INTERNAL_API_KEY is not the default development value
    3. INTERNAL_API_KEY meets minimum length requirement
    4. JWT_SECRET is not using example/default values
    5. LLM_API_KEY is set
    """
    errors: list[str] = []

    if not settings.internal_api_key:
        errors.append(
            "SECURITY: INTERNAL_API_KEY is not set! "
            "Generate one with: openssl rand -hex 32"
        )
    elif settings.internal_api_key == "crack-ai-internal-key-dev":
        errors.append(
            "SECURITY: INTERNAL_API_KEY is still set to the default development value "
            "'crack-ai-internal-key-dev'! This is publicly known and exposes the service. "
            "Generate a new random key with: openssl rand -hex 32"
        )
    elif len(settings.internal_api_key) < 16:
        errors.append(
            f"SECURITY: INTERNAL_API_KEY is too short ({len(settings.internal_api_key)} chars). "
            "Minimum 16 characters required. Generate with: openssl rand -hex 32"
        )

    if settings.jwt_secret in ("super-secret-dont-share-123", "secret", "changeme", "password"):
        errors.append(
            "SECURITY: JWT_SECRET appears to be a weak/example value! "
            "Use a strong random secret matching the NestJS backend."
        )

    if not settings.llm_api_key:
        errors.append(
            "SECURITY: LLM_API_KEY is not set! "
            "Get an OpenRouter API key at: https://openrouter.ai/keys"
        )

    if errors:
        error_message = "\n🚨 SECURITY STARTUP FAILED 🚨\n" + "\n\n".join(errors)
        logger.error("Security startup validation failed", errors=errors)
        print(error_message)
        raise SystemExit(1)

    logger.info("Startup security validation passed")

async def request_id_middleware(request: Request, call_next):
    """
    Middleware that:
    1. Generates or extracts x-request-id for distributed tracing
    2. Logs every request with timing and ID

    If the NestJS backend forwards an x-request-id header, it is preserved.
    Otherwise, a new UUID is generated.

    This enables end-to-end tracing: User → NestJS → AI → DB → LLM → Response
    """

    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id

    start_time = time.time()
    logger.info(
        "Request started",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        ip=get_remote_address(request),
    )

    response = await call_next(request)

    elapsed_ms = round((time.time() - start_time) * 1000, 1)
    logger.info(
        "Request completed",
        request_id=request_id,
        status_code=response.status_code,
        elapsed_ms=elapsed_ms,
    )

    response.headers["X-Request-Id"] = request_id
    return response

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("Starting CrackPOS AI Service...")

    _validate_startup_security()

    await init_db()
    yield
    logger.info("Shutting down CrackPOS AI Service...")
    await close_db()
    await close_backend_client()

app = FastAPI(
    title="CrackPOS AI Service",
    description="AI Assistant for CrackPOS inventory system with tool-based data retrieval",
    version="1.1.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

cors_origins = [o.strip() for o in settings.cors_origins.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "X-Internal-API-Key", "X-Request-Id"],
)

app.middleware("http")(request_id_middleware)

@app.get("/health", tags=["Health"])
async def health_check():
    """
    Health check endpoint — no authentication required.

    Returns:
        - status: "ok" if all systems healthy
        - database: "connected" if PostgreSQL responds to SELECT 1
        - service: service identifier
        - response_time_ms: time taken to ping the database
        - llm_pool: model rotation status (available models, cooldowns)
    """
    db_status = "unknown"
    start = time.time()

    try:
        from database import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
        db_status = "connected"
    except Exception as e:
        logger.warning("Health check: database ping failed", error=str(e))
        db_status = "disconnected"

    elapsed_ms = round((time.time() - start) * 1000, 1)

    pool_status = rotation.status()
    available_count = sum(1 for m in pool_status if m["available"])

    is_healthy = db_status == "connected" and available_count > 0

    return {
        "status": "ok" if is_healthy else "degraded",
        "database": db_status,
        "service": "crack-ai",
        "response_time_ms": elapsed_ms,
        "llm_pool": {
            "total_models": len(pool_status),
            "available_models": available_count,
            "base_url": settings.llm_base_url,
            "models": pool_status,
        },
    }

@app.post(
    "/ai/product-from-image",
    response_model=ProductFromImageResponse,
    tags=["AI"],
    summary="Identify products from image (ADMIN only)",
    description="""
    ADMIN only. Upload an image of products, AI returns structured product list.
    Products are NOT created — returned as preview for admin to review and confirm.
    """,
)
@limiter.limit("5/minute")
async def product_from_image(
    request: Request,
    file: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ProductFromImageResponse:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Only ADMIN can use this feature")

    image_bytes = await file.read()
    import base64
    image_b64 = base64.b64encode(image_bytes).decode()

    response = await client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": "You identify products from images. Return ONLY valid JSON array: [{name, estimatedQuantity (int), confidence (high/medium/low), suggestedPrice (float or null), suggestedCategory (string or null)}]. If no products visible, return []."},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                {"type": "text", "text": "Identify all products visible in this image."}
            ]}
        ],
        response_format={"type": "json_object"},
        max_tokens=1024,
    )

    raw = response.choices[0].message.content or "{}"
    data = json.loads(raw)
    items = data.get("products") or data.get("items") or ([] if isinstance(data, list) else [data])
    if isinstance(items, dict):
        items = [items]

    products = [ProductImageItem(**item) for item in items]
    return ProductFromImageResponse(products=products)

@app.post(
    "/chat",
    response_model=ChatResponse,
    tags=["AI Chat"],
    summary="Chat with CrackPOS AI Assistant",
    description="""
    Send a message to the AI and receive answers based on real data from the database.

    **Rate Limit:** 10 requests per 60 seconds per IP (LLM API costs $$$)

    **Security:**
    - Requires valid JWT Bearer Token (same as NestJS backend)
    - userId and role are taken from the token, NOT from the request body
    - AI can only read data according to the logged-in user's access rights
    """,
)
@limiter.limit("10/minute")
async def chat_endpoint(
    request: Request,
    body: ChatRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> ChatResponse:
    """
    POST /chat — Main AI chat endpoint.

    SECURITY: current_user is injected from JWT by the get_current_user dependency.
    user_id and role are never taken from the request body.

    OBSERVABILITY: request_id is logged for distributed tracing.
    """
    request_id = getattr(request.state, "request_id", "unknown")

    try:
        llm_history = [
            {"role": msg.role, "parts": [{"text": part} for part in msg.parts]}
            for msg in body.history
        ]

        result = await ai_service.chat(
            message=body.message,
            history=llm_history,
            user_id=current_user.user_id,
            role=current_user.role,
            tenant_id=current_user.tenant_id,
            username=current_user.username,
            request_id=request_id,
        )

        try:
            from database import get_pool
            pool = await get_pool()
            async with pool.acquire() as conn:
                import json
                await conn.execute("""
                    INSERT INTO ai_audit_logs (user_id, username, role, tenant_id, query, tools_used, response_summary, request_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, current_user.user_id, current_user.username, current_user.role,
                    current_user.tenant_id, body.message,
                    json.dumps(result.get("tools_used", [])),
                    result.get("reply", "")[:500], request_id)
        except Exception as audit_err:
            logger.warning("Audit log insert failed", error=str(audit_err))

        return ChatResponse(
            reply=result["reply"],
            tools_used=result["tools_used"],
            username=current_user.username,
            role=current_user.role,
        )

    except Exception as e:
        logger.error(
            "Chat endpoint error",
            user=current_user.username,
            request_id=request_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI service is experiencing issues. Please try again.",
        )

