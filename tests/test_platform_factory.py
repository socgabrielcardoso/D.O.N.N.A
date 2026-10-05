import sys

from donna.app.platform.factory import create_platform_adapter
from donna.app.platform.linux import LinuxAdapter
from donna.app.platform.windows import WindowsAdapter


def test_factory_matches_host():
    adapter = create_platform_adapter()
    if sys.platform.startswith("linux"):
        assert isinstance(adapter, LinuxAdapter)
    elif sys.platform.startswith("win"):
        assert isinstance(adapter, WindowsAdapter)
