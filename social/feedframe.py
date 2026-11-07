"""Where the subject sits in the 4:5 recordings (record.mjs FEED=1, record_c.mjs FEED=1), for the
feed builds. At 540×675 the planner shows a wider view than the phone's 540×960 at the same lens, so
the tower is about 0.62× the size and sits elsewhere: push-ins aim at these points and go a little
further. Measured on the takes at the moments the films use.
"""
import re

# Take name → transform origin in the 1080×1350 frame.
ORIGIN = {
    'eclipse': (493, 448),   # the sphere and the ring
    'moon': (485, 480),      # between the moon and the antenna
    'dawn': (470, 455),      # the full moon and the sphere
    'henge': (551, 470),     # the sun down the avenue
    'klamott': (477, 448),   # the sphere over the hill
    'drone': (540, 630),
}
PUSH = 1.2  # extra scale on a photo push-in, so the tower reads as large as in the story


def feed_src(src, feed=True):
    """(src, native, take): the 4:5 recording of an eye-level or journey take, when there is one."""
    m = re.match(r'(\w+)-(ui|clean)\.mp4$', src)
    if feed and m:
        return f'{m[1]}-{m[2]}-feed.mp4', True, m[1]
    return src, False, None


def native_origin(take, origin, h=1350):
    """The origin to push in on, in the feed frame: the measured subject for a photo push-in (one that
    does not aim at the frame's centre), else the same point moved down to the 4:5 frame."""
    ox, oy = origin
    if take in ORIGIN and (ox, oy) != (540, 960):
        return ORIGIN[take]
    return ox, round(oy * h / 1920)


def native_scale(take, origin, scale):
    if take in ORIGIN and tuple(origin) != (540, 960):
        return tuple(round(s * PUSH, 3) for s in scale)
    return scale


def native_lift(take, origin, scale):
    """How far down to move a photo push-in, in px, so the subject leaves the dark scrim behind the
    titles. As far as 200 px, while the pushed-in frame still covers the top edge."""
    if take not in ORIGIN or tuple(origin) == (540, 960):
        return 0
    oy = ORIGIN[take][1]
    return max(0, min(200, int(oy * (min(scale) - 1))))
