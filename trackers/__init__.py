from .tcs import TCSTracker
from .leopards import LeopardsTracker
from .postex import PostExTracker
from .daraz import DarazTracker
from .dex import DEXTracker
from .trax import TraxTracker

TRACKERS = {
    "tcs": TCSTracker,
    "leopards": LeopardsTracker,
    "postex": PostExTracker,
    "daraz": DarazTracker,
    "dex": DEXTracker,
    "trax": TraxTracker,
}

def get_tracker(courier_name):
    """Get tracker instance by courier name."""
    courier = courier_name.lower().strip()
    if courier not in TRACKERS:
        raise ValueError(f"Unknown courier: {courier}. Supported: {', '.join(TRACKERS.keys())}")
    return TRACKERS[courier]()
