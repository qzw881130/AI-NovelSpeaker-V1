from __future__ import annotations

import sqlite3
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
DB_PATH = DATA_DIR / "novels.db"
NOVEL_DIR = ROOT_DIR / "novel"
PROMPTS_DIR = ROOT_DIR / "prompts"
WORKFLOWS_DIR = ROOT_DIR / "workflows"
SYSTEM_PROMPT_FILE = PROMPTS_DIR / "xhz_system_prompt.txt"
SYSTEM_PROMPT_NAME = "系统提示词"
SYSTEM_PROMPT_DESC = "系统内置"
DEFAULT_SYSTEM_PROMPT_CONTENT = "请将章回文本拆分为 role_list 与 juben 的 JSON 结构。"
SYSTEM_WORKFLOW_FILE = PROMPTS_DIR / "xhz_system_workflow_api.txt"
SYSTEM_WORKFLOW_NAME = "古典小说默认工作流"
SYSTEM_WORKFLOW_DESC = "系统内置，作为 ComfyUI TTS 默认流程"
DEFAULT_SYSTEM_WORKFLOW_JSON = '{"workflow":"classic-default"}'


def db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=12.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 12000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS capture_upload_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            novel_id INTEGER NOT NULL,
            chapter_num INTEGER NOT NULL,
            chapter_title TEXT NOT NULL,
            word_count INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
        )
        """
    )
    return conn
