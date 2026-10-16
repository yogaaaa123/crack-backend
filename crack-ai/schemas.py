"""
CrackPOS AI — Pydantic Schemas
DTOs for request/response API.
"""
from typing import Literal
from pydantic import BaseModel, Field

class ChatMessage(BaseModel):
    """A single message in the chat history.

    SECURITY: role is strictly typed, so arbitrary values (e.g., "system")
    cannot be injected to manipulate the AI's behavior. "model" is accepted
    as an alias of "assistant" and normalized by the caller.
    """
    role: Literal["user", "assistant", "model"] = Field(
        ...,
        description="Sender of the message: 'user' or 'assistant'. 'system' is NOT allowed.",
    )
    parts: list[str] = Field(
        ...,
        description="List of text parts in this message",
    )

class ChatRequest(BaseModel):
    """Request body for POST /chat."""
    message: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Message from user",
    )
    history: list[ChatMessage] = Field(
        default=[],
        max_length=100,
        description="Previous chat history (optional, only the last 40 are used)",
    )

class ChatResponse(BaseModel):
    """Response from POST /chat."""
    reply: str
    tools_used: list[str]
    username: str
    role: str

class ProductImageItem(BaseModel):
    """A product identified from an image."""
    name: str
    estimatedQuantity: int = 1
    confidence: str = "medium"
    suggestedPrice: float | None = None
    suggestedCategory: str | None = None

class ProductFromImageResponse(BaseModel):
    """Response from POST /ai/product-from-image."""
    products: list[ProductImageItem]

