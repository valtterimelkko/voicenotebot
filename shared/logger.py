"""Structured logging configuration using structlog."""

import os
import sys
import logging
from typing import Any

import structlog
from structlog.types import EventDict, Processor


def add_correlation_id(
    logger: Any, method_name: str, event_dict: EventDict
) -> EventDict:
    """Add correlation ID to log entry if available."""
    # Correlation ID can be set via structlog contextvars
    # Use contextvars.bind_contextvars(correlation_id="some-id") in request handlers
    return event_dict


def configure_logging() -> None:
    """Configure structured JSON logging for production."""
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    
    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level, logging.INFO),
    )

    # Configure structlog processors
    # Order matters: processors are applied top to bottom
    structlog.configure(
        processors=[
            # Add log level to output
            structlog.stdlib.filter_by_level,
            # Add timestamp in ISO format
            structlog.processors.TimeStamper(fmt="iso"),
            # Add caller info (file, line)
            structlog.processors.CallsiteParameterAdder(
                [
                    structlog.processors.CallsiteParameter.FILENAME,
                    structlog.processors.CallsiteParameter.LINENO,
                ]
            ),
            # Add correlation ID support
            add_correlation_id,
            # Add standard library log level
            structlog.stdlib.add_log_level,
            # Format positional arguments
            structlog.stdlib.PositionalArgumentsFormatter(),
            # Add extra keyword arguments as "extra" field
            structlog.processors.StackInfoRenderer(),
            # Format exceptions
            structlog.processors.format_exc_info,
            # Decode unicode strings
            structlog.processors.UnicodeDecoder(),
            # Render as JSON for production, or colored for dev
            structlog.processors.JSONRenderer()
            if os.getenv("ENV", "development") == "production"
            else structlog.dev.ConsoleRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Get a structured logger instance.
    
    Args:
        name: Logger name, typically __name__ from the calling module.
              If None, uses the root logger.
    
    Returns:
        A bound logger with structured logging configured.
    
    Example:
        >>> logger = get_logger(__name__)
        >>> logger.info("voice_note_received", chat_id=12345, file_size=1024)
        {"event": "voice_note_received", "chat_id": 12345, "file_size": 1024, ...}
    """
    return structlog.get_logger(name)


# Auto-configure on import if not already configured
if not structlog.is_configured():
    configure_logging()
