"""Wrapper entrypoint for AgentCore Runtime CodeZip deployment."""
import sys
import os

# Add vendored dependencies to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "vendor"))

from src.main import app

if __name__ == "__main__":
    app.run()
