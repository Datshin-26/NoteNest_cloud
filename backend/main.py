import json
import os
import sqlite3
from contextlib import asynccontextmanager, closing
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


PROJECT_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = Path(
    os.environ.get("CLOUDNOTES_DB_PATH", Path(__file__).with_name("cloudnotes.sqlite3"))
)
DEFAULT_CATEGORIES = ["Personal", "Work", "Study", "Ideas", "Code Projects"]


class Note(BaseModel):
    id: str
    title: str = "Untitled"
    body: str = ""
    category: str = "Personal"
    tags: list[str] = Field(default_factory=list)
    color: str = ""
    created: int
    updated: int
    pinned: bool = False
    fav: bool = False
    trashed: bool = False


class NotebookState(BaseModel):
    notes: list[Note] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=lambda: DEFAULT_CATEGORIES.copy())
    dark: bool = False


class NotebookStateResponse(NotebookState):
    initialized: bool


def initialize_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DATABASE_PATH)) as connection, connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS notebook_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                categories TEXT NOT NULL,
                dark INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                category TEXT NOT NULL,
                tags TEXT NOT NULL,
                color TEXT NOT NULL,
                created INTEGER NOT NULL,
                updated INTEGER NOT NULL,
                pinned INTEGER NOT NULL,
                fav INTEGER NOT NULL,
                trashed INTEGER NOT NULL
            )
            """
        )


def read_notebook_state() -> NotebookStateResponse:
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        connection.row_factory = sqlite3.Row
        notebook = connection.execute(
            "SELECT categories, dark FROM notebook_state WHERE id = 1"
        ).fetchone()
        notes = connection.execute(
            """
            SELECT id, title, body, category, tags, color, created, updated,
                   pinned, fav, trashed
            FROM notes ORDER BY rowid
            """
        ).fetchall()
    initialized = notebook is not None
    return NotebookStateResponse(
        notes=[
            {
                **dict(note),
                "tags": json.loads(note["tags"]),
                "pinned": bool(note["pinned"]),
                "fav": bool(note["fav"]),
                "trashed": bool(note["trashed"]),
            }
            for note in notes
        ],
        categories=json.loads(notebook["categories"]) if notebook else DEFAULT_CATEGORIES,
        dark=bool(notebook["dark"]) if notebook else False,
        initialized=initialized,
    )


def write_notebook_state(notebook: NotebookState) -> None:
    with closing(sqlite3.connect(DATABASE_PATH)) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM notes")
        connection.executemany(
            """
            INSERT INTO notes (
                id, title, body, category, tags, color, created, updated,
                pinned, fav, trashed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    note.id,
                    note.title,
                    note.body,
                    note.category,
                    json.dumps(note.tags),
                    note.color,
                    note.created,
                    note.updated,
                    note.pinned,
                    note.fav,
                    note.trashed,
                )
                for note in notebook.notes
            ],
        )
        connection.execute(
            """
            INSERT INTO notebook_state (id, categories, dark)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                categories = excluded.categories,
                dark = excluded.dark
            """,
            (json.dumps(notebook.categories), notebook.dark),
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="NoteNest API", version="1.0.0", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/state", response_model=NotebookStateResponse)
def get_state() -> NotebookStateResponse:
    return read_notebook_state()


@app.put("/api/state", response_model=NotebookState)
def put_state(notebook: NotebookState) -> NotebookState:
    write_notebook_state(notebook)
    return notebook


app.mount("/", StaticFiles(directory=PROJECT_DIR, html=True), name="frontend")
