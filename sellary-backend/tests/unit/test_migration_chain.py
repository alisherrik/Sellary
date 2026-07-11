"""Assert the ONE new migration chains off c3d4e5f6a7b8 and the dead head stays."""
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

NEW_REV = "d4e5f6a7b8c9"
LIVE_HEAD = "c3d4e5f6a7b8"
DEAD_HEAD = "20260319_0001"

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _script() -> ScriptDirectory:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(cfg)


def test_new_migration_chains_off_live_head():
    script = _script()
    rev = script.get_revision(NEW_REV)
    assert rev is not None
    assert rev.down_revision == LIVE_HEAD


def test_new_rev_is_a_head_and_dead_head_untouched():
    script = _script()
    heads = set(script.get_heads())
    # Exactly two heads: the new one (main lineage) and the untouched dead head.
    assert NEW_REV in heads
    assert DEAD_HEAD in heads
    assert LIVE_HEAD not in heads  # c3d4e5f6a7b8 is now superseded by NEW_REV
    assert len(heads) == 2
