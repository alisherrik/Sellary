from models import PlatformSetting
from core.database import Base


def test_platform_setting_registered_on_metadata():
    assert "platform_settings" in Base.metadata.tables
    cols = Base.metadata.tables["platform_settings"].columns
    assert {"id", "key", "encrypted_value", "updated_at"} <= set(cols.keys())
    assert cols["key"].unique is True


def test_platform_setting_roundtrips_via_session(db_session):
    row = PlatformSetting(key="telegram_bot_token", encrypted_value="gAAAA...")
    db_session.add(row)
    db_session.flush()
    fetched = db_session.query(PlatformSetting).filter_by(key="telegram_bot_token").one()
    assert fetched.encrypted_value == "gAAAA..."
