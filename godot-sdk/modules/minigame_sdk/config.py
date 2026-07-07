def get_opts(platform):
    from SCons.Variables import BoolVariable

    # Adds a `minigame=yes|no` SCons build option (default: no).
    # Registered before can_build() is evaluated, so env["minigame"] is available there.
    return [
        BoolVariable("minigame", "Build the cross-platform (WeChat/Douyin) mini-game SDK module", False),
    ]


def can_build(env, platform):
    # Only build when explicitly requested with `minigame=yes`.
    # The native bridge only has effect on the Web platform, but the module builds
    # everywhere so GDScript written against MiniGameSDK compiles on desktop/editor
    # too (calls become no-ops).
    return env.get("minigame", False)


def configure(env):
    pass
