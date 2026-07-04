/* ==========================================================================
    {DEBUGGING LOG FUNCTION}
========================================================================== */
export function DL(intLogType, stringLogMsg, objObject = null) {
    // Handle case where only a string is provided (defaults to type 1)
    if (typeof intLogType === "string") {
        objObject = stringLogMsg;
        stringLogMsg = intLogType;
        intLogType = 1;
    }

    // Check if debugging is enabled
    let enabled = false;
    try {
        enabled = !!game.settings.get("joes-foundry-stuff", "debugEnabled");
    } catch {}
    if (!enabled) return;

    const ts = new Date().toTimeString().split(" ")[0];
    let fileInfo = "Unknown";
    try {
        const stack = new Error().stack.split("\n");
        for (let i = 2; i < stack.length; i++) {
            const m = stack[i].match(/(\/[^)]+):(\d+):(\d+)/);
            if (m) {
                fileInfo = `${m[1].split("/").pop()}:${m[2]}`;
                break;
            }
        }
    } catch {}

    const styles = {
        1: "color: yellow; font-weight: bold;",
        2: "color: orange; font-weight: bold;",
        3: "color: red; font-weight: bold;",
        default: "color: aqua; font-weight: bold;",
    };
    const label = intLogType === 3 ? "ERROR: " : intLogType === 2 ? "WARNING: " : "";
    const prefix = "[Joe's Foundry Stuff]";
    const formatted = `[${fileInfo}] ${stringLogMsg}`;

    if (objObject !== null && objObject !== undefined) {
        console.log(`%c${prefix} [${ts}] | ${label}${formatted}`, styles[intLogType] ?? styles.default, objObject);
    } else {
        console.log(`%c${prefix} [${ts}] | ${label}${formatted}`, styles[intLogType] ?? styles.default);
    }
}

/* ==========================================================================
	{INIT SETTINGS}
========================================================================== */
Hooks.once("init", () => {

    /* ==========================================================================
        {AUIDIO AUTOLEVEL SETTIGS}
    ========================================================================== */
    game.settings.register("joes-foundry-stuff", "audioAutoMixEnabledWorld", {
		name: "Audio Auto Mix (World)",
		hint: "Forces per-sound volume when audio starts.",
		scope: "world",
		config: true,
		type: Boolean,
		default: false
	});

	game.settings.register("joes-foundry-stuff", "audioAutoMixWorldMusic", {
        name: "Audio Auto Mix (World): Music Volume",
        hint: "Forced playback volume for Music sounds (0% to 100%).",
        scope: "world",
        config: true,
        type: Number,
        default: 50,
        range: { min: 0, max: 100, step: 5 }
    });

    game.settings.register("joes-foundry-stuff", "audioAutoMixWorldEnvironment", {
        name: "Audio Auto Mix (World): Environment Volume",
        hint: "Forced playback volume for Environment sounds (0% to 100%).",
        scope: "world",
        config: true,
        type: Number,
        default: 50,
        range: { min: 0, max: 100, step: 5 }
    });

    game.settings.register("joes-foundry-stuff", "audioAutoMixWorldInterface", {
        name: "Audio Auto Mix (World): Interface Volume",
        hint: "Forced playback volume for Interface sounds (0% to 100%).",
        scope: "world",
        config: true,
        type: Number,
        default: 50,
        range: { min: 0, max: 100, step: 5 }
    });

    /* ==========================================================================
        {TIMER SETTINGS}
    ========================================================================== */
	// Register setting to store active timers
	game.settings.register("joes-foundry-stuff", "activeTimers", {
		name: "Active Timers",
		scope: "world",
		config: false,
		type: Object,
		default: {}
	});

	// Register setting to store player timer window position
	game.settings.register("joes-foundry-stuff", "playerTimerWindowPos", {
		name: "Player Timer Window Position",
		scope: "client",
		config: false,
		type: Object,
		default: null
	});

    /* ==========================================================================
        {INITIATIVE TIMER SETTINGS}
    ========================================================================== */
    game.settings.register("joes-foundry-stuff", "initiativeTimerEnabled", {
        name: "Enable Initiative Timer",
        hint: "When enabled, rolling for initiative shows a countdown overlay; any players who haven't rolled when it expires get initiative rolled for them automatically.",
        scope: "world", config: true, type: Boolean, default: false
    });

    game.settings.register("joes-foundry-stuff", "initiativeTimerSeconds", {
        name: "Initiative Timer Duration (seconds)",
        hint: "How many seconds players have to roll initiative before it's rolled for them.",
        scope: "world", config: true, type: Number, default: 30
    });

    
    /* ==========================================================================
        {CHAT ARCHIVER SETTINGS}
    ========================================================================== */
    game.settings.register("joes-foundry-stuff", "enableChatArchiver", {
		name: "Enable Chat Archiver",
		hint: "If disabled, chat messages will NOT be trimmed or archived.",
		scope: "world", config: true, type: Boolean, default: true
	});
	game.settings.register("joes-foundry-stuff", "keepCount", {
		name: "Messages to keep",
		hint: "Maximum number of NON-PINNED chat messages to keep.",
		scope: "world", config: true, type: Number, default: 100
	});
	game.settings.register("joes-foundry-stuff", "saveToJournal", {
		name: "Save deleted messages to journal",
		hint: "If enabled, deleted messages will be saved to 'Chat Archive'.",
		scope: "world", config: true, type: Boolean, default: true
	});
	
    /* ==========================================================================
        {COMBAT TURN TIMER SETTINGS}
    ========================================================================== */
    // registerMenu for Combat Timer is in combatTurnTimer.js (same init hook)
    game.settings.register("joes-foundry-stuff", "combatTurnTimerEnabled", {
        scope: "world", config: false, type: Boolean, default: false
    });
    game.settings.register("joes-foundry-stuff", "combatTurnTimerVisibility", {
        scope: "world", config: false, type: String, default: "gmonly"
    });
    game.settings.register("joes-foundry-stuff", "combatTurnTimerSarcasm", {
        scope: "world", config: false, type: Boolean, default: false
    });
    game.settings.register("joes-foundry-stuff", "combatTurnTimerLongThreshold", {
        scope: "world", config: false, type: Number, default: 5
    });
    game.settings.register("joes-foundry-stuff", "combatTurnTimerQuickThreshold", {
        scope: "world", config: false, type: Number, default: 1
    });
    game.settings.register("joes-foundry-stuff", "combatTurnTimerState", {
        scope: "world", config: false, type: Object, default: {}
    });

    /* ==========================================================================
        {DEBUG LOGGING}
    ========================================================================== */
    game.settings.register("joes-foundry-stuff", "debugEnabled", {
		name: "Enable console debugging",
		hint: "When enabled, DL(...) prints debug messages to the console.",
		scope: "world", config: true, type: Boolean, default: false
	});


	console.log("[Joe's Foundry Stuff] settings.js | settings registered.");
});


Hooks.once("init", () => {
	
});