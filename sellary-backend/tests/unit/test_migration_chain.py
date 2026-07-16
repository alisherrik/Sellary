"""Guard the migration lineage and the Railway pin that applies it.

Railway's preDeployCommand pins an explicit revision instead of `head`, because
the repo carries a second, dead head (20260319_0001) that `head` would refuse to
resolve. That pin is easy to forget: add a migration, ship it, and the code
deploys against a database that never ran it. These tests fail loudly instead.
"""
import re
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

# An orphan branch that was never applied to production. Left alone on purpose;
# it is what forces the explicit pin below.
DEAD_HEAD = "20260319_0001"

BACKEND_DIR = Path(__file__).resolve().parents[2]
RAILWAY_TOML = BACKEND_DIR.parent / "railway.toml"


def _script() -> ScriptDirectory:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(cfg)


def _live_head() -> str:
    heads = set(_script().get_heads())
    live = heads - {DEAD_HEAD}
    assert len(live) == 1, f"expected exactly one live head, got {sorted(live)}"
    return live.pop()


def _pinned_revision() -> str:
    content = RAILWAY_TOML.read_text(encoding="utf-8")
    match = re.search(r'preDeployCommand\s*=\s*"alembic upgrade (\S+)"', content)
    assert match, "railway.toml has no `alembic upgrade <rev>` preDeployCommand"
    return match.group(1)


def test_exactly_two_heads_and_dead_head_untouched():
    heads = set(_script().get_heads())
    assert DEAD_HEAD in heads
    assert len(heads) == 2, (
        f"migration lineage forked: {sorted(heads)}. Every new migration must "
        f"chain off the live head, not create a third one."
    )


def test_railway_pin_matches_live_head():
    # If this fails, a migration was added without bumping railway.toml — the
    # deploy would ship the code and skip the schema change.
    assert _pinned_revision() == _live_head()


def test_live_head_reaches_dead_head_free_lineage():
    script = _script()
    live = _live_head()
    # Walking down from the live head must terminate, i.e. the pin really does
    # apply a complete chain rather than pointing into a detached branch.
    revisions = list(script.walk_revisions("base", live))
    assert revisions, "live head resolves to an empty lineage"
    assert DEAD_HEAD not in {rev.revision for rev in revisions}
