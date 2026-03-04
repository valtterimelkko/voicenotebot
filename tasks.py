"""
Root-level tasks module for RQ worker imports.
This file exists so RQ can import 'tasks.process_voice_note'
"""

# Import and re-export from worker module
from worker.tasks import process_voice_note

__all__ = ['process_voice_note']
